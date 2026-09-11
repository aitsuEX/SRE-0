import { NextRequest, NextResponse } from 'next/server';
import {
  getRoster,
  addParticipant,
  removeParticipant,
  getAgentId,
  clearAgent,
  buildRosterContext,
  roomExists,
  getRoom,
} from '@/lib/room-registry';
import { buildFullSystemPrompt } from '@/lib/sre-zero-prompt';
import { AgoraClient, Area } from 'agora-agents';

// ── GET /api/roster?channel=SRE-AB12 ──
// Returns the current participant roster for a room.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel');

  if (!channel) {
    return NextResponse.json(
      { error: 'channel query parameter is required' },
      { status: 400 },
    );
  }

  const exists = roomExists(channel);
  const room = getRoom(channel);
  const roster = getRoster(channel);
  const agentId = getAgentId(channel);

  return NextResponse.json({
    exists,
    channel,
    incidentTitle: room?.incidentTitle || 'Active Incident',
    agentActive: !!agentId,
    agentId,
    participants: roster,
    count: roster.length,
  });
}


// ── POST /api/roster ──
// Body: { action: 'join' | 'leave', channel, uid, name, role }
// join: adds a participant to the roster and updates the agent's system_messages
// leave: removes a participant and updates the agent's system_messages
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, channel, uid, name, role } = body;

    if (!channel || !uid) {
      return NextResponse.json(
        { error: 'channel and uid are required' },
        { status: 400 },
      );
    }

    if (action === 'join') {
      const participant = addParticipant(
        channel,
        String(uid),
        name || 'Engineer',
        role || 'Engineer',
      );

      // Best-effort: push the updated roster into the agent's LLM context
      await updateAgentRoster(channel);

      return NextResponse.json({ ok: true, participant });
    }

    if (action === 'leave') {
      removeParticipant(channel, String(uid));

      // If the room is now empty, stop the shared agent instead of leaving
      // it running until Agora's idle timeout — and, critically, clear it
      // from the registry so a future join with the same room code starts
      // a *new* agent instead of "reusing" one that's already gone.
      const remaining = getRoster(channel);
      if (remaining.length === 0) {
        const agentId = getAgentId(channel);
        if (agentId) {
          try {
            const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
            const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
            if (appId && appCertificate) {
              const client = new AgoraClient({ area: Area.US, appId, appCertificate });
              await client.stopAgent(agentId);
            }
          } catch (error) {
            console.error(`[roster] Failed to stop agent ${agentId} for empty room ${channel}:`, error);
          } finally {
            clearAgent(channel);
          }
        }
        return NextResponse.json({ ok: true, agentStopped: !!agentId });
      }

      await updateAgentRoster(channel);
      return NextResponse.json({ ok: true, agentStopped: false });
    }

    return NextResponse.json(
      { error: 'action must be "join" or "leave"' },
      { status: 400 },
    );
  } catch (error) {
    console.error('Roster API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── Update the agent's system_messages with the current roster ──
// Uses client.agents.update() — the Agora ConvoAI REST API supports
// updating llm.system_messages at runtime without restarting the agent.
// See: https://docs.agora.io/en/api-reference/api-ref/conversational-ai/update
//
// NOTE: This is best-effort. If the agent hasn't started yet or the API
// call fails, we silently skip — the roster is still stored in memory
// and will be included in the next agent start's system prompt.
async function updateAgentRoster(channel: string): Promise<void> {
  try {
    const agentId = getAgentId(channel);
    if (!agentId) return; // agent not running yet, skip

    const rosterContext = buildRosterContext(channel);
    if (!rosterContext) return;

    // Determine whether MCP tools are available so the prompt is consistent
    // with the initial agent start. Without this, roster updates would strip
    // the tools section from the prompt.
    const hasTools = (() => {
      const raw = process.env.MCP_SERVER_URL;
      if (!raw || typeof raw !== 'string') return false;
      const lower = raw.toLowerCase();
      if (lower.includes('localhost') || lower.includes('127.0.0.1')) return false;
      try {
        const parsed = new URL(raw.trim());
        return raw.trim().startsWith('https://') && !!parsed.hostname && parsed.hostname.includes('.');
      } catch { return false; }
    })();

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) return;

    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    // Build the updated system message with the FULL system prompt + roster context.
    // Agora's update-agent-config REPLACES system_messages wholesale — so we must
    // resend the entire prompt (rules, tools, operating instructions) plus the
    // updated roster, not just the roster delta. Otherwise the agent silently loses
    // all behavioral rules and tool awareness the moment someone joins or leaves.
    const systemMessage = buildFullSystemPrompt(rosterContext, hasTools);

    // Use the Agora ConvoAI REST API to update the agent's system_messages
    // This pushes the current participant list into the LLM context at runtime.
    await client.agents.update({
      appid: appId,
      agentId,
      properties: {
        llm: {
          system_messages: [
            { role: 'system', content: systemMessage },
          ],
        },
      },
    });
  } catch (error) {
    // Silently fail — roster is stored in memory and will be picked up
    // on the next agent restart or system_messages update.
    console.error('[roster] Failed to update agent system_messages:', error);
  }
}
