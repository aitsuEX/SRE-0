import { NextRequest, NextResponse } from 'next/server';
import {
  AgoraClient,
  Agent,
  Area,
  DeepgramSTT,
  ExpiresIn,
  MiniMaxTTS,
  OpenAI,
} from 'agora-agents';
import { ClientStartRequest, AgentResponse } from '@/types/conversation';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import {
  createRoom,
  registerAgent,
  getAgentId,
  hasAgent,
  buildRosterContext,
  addParticipant,
} from '@/lib/room-registry';
import { GREETING, buildFullSystemPrompt } from '@/lib/sre-zero-prompt';

// agentUid identifies the AI in the RTC channel and shares its default with the client.
const agentUid = String(DEFAULT_AGENT_UID);

/** Validate that MCP_SERVER_URL is a real public HTTPS URL.
 * Rejects localhost, 127.0.0.1, bare "ngrok" text, and other placeholders
 * that Agora's cloud cannot reach. */
function isValidPublicUrl(url: string | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Must start with https:// (ngrok free tier uses https)
  if (!trimmed.startsWith('https://')) return false;
  // Reject localhost and loopback
  const lower = trimmed.toLowerCase();
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return false;
  // Reject bare placeholder words without a real domain
  if (/^(https?:\/\/)?(ngrok|ngork|placeholder|your-)/i.test(trimmed)) return false;
  // Must have a valid hostname structure after https://
  try {
    const parsed = new URL(trimmed);
    return !!parsed.hostname && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

export async function POST(request: NextRequest) {
  try {
    // --- 1. Parse request ---

    const body: ClientStartRequest = await request.json();
    const { requester_id, channel_name, requester_name, requester_role } = body;

    // Validate required env vars on first request so misconfiguration surfaces
    // with a clear error message rather than a silent failure.
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');

    if (!channel_name || !requester_id) {
      return NextResponse.json(
        { error: 'channel_name and requester_id are required' },
        { status: 400 },
      );
    }

    // --- 2. Register the participant in the room roster ---

    const name = requester_name || 'Engineer';
    const role = requester_role || 'Engineer';
    addParticipant(channel_name, requester_id, name, role);

    // --- 3. Check if an agent is already running for this channel ---
    // If so, return its ID — don't spawn a duplicate agent.

    if (hasAgent(channel_name)) {
      const existingAgentId = getAgentId(channel_name)!;
      return NextResponse.json({
        agent_id: existingAgentId,
        create_ts: Math.floor(Date.now() / 1000),
        state: 'RUNNING',
        reused: true, // signal to caller that we reused an existing agent
      } as AgentResponse & { reused: boolean });
    }

    // --- 4. Create room entry (if not already created by a join call) ---

    createRoom(channel_name, name, 'Active Incident');

    // --- 5. Build the system prompt with roster context ---

    const rosterContext = buildRosterContext(channel_name);
    // Determine whether MCP tools will be available.
    const rawMcpUrl = process.env.MCP_SERVER_URL;
    const cleanMcpUrl = typeof rawMcpUrl === 'string' ? rawMcpUrl.trim() : undefined;
    let mcpServerUrl: string | undefined = undefined;

    if (isValidPublicUrl(cleanMcpUrl)) {
      mcpServerUrl = cleanMcpUrl;
      console.log(`[invite-agent:init] MCP configuration ACTIVE. Server URL: ${mcpServerUrl}`);
      console.log(`[invite-agent:init] Available tools for session: [checkWebsite, checkGitHub, check_monitoring, record_fact, get_incident_state, detect_conflict, request_approval, create_jira, execute_rollback, verify_recovery]`);
    } else if (cleanMcpUrl) {
      console.warn(`[invite-agent:init] MCP_SERVER_URL="${cleanMcpUrl}" is not a valid public HTTPS URL (must be public https:// endpoint).`);
    } else {
      console.warn(`[invite-agent:init] No MCP_SERVER_URL configured.`);
    }

    const hasTools = !!mcpServerUrl;
    console.log(`[invite-agent:init] Prompt mode: ${hasTools ? 'TOOLS_ENABLED' : 'NO_TOOLS_SECTION'}`);
    const fullPrompt = buildFullSystemPrompt(rosterContext, hasTools);

    // --- 6. Build and start the agent ---

    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    const llmConfig = new OpenAI({
      model: 'gpt-4o-mini',
      systemMessages: [{ role: 'system', content: fullPrompt }],
      greetingMessage: GREETING,
      failureMessage: 'Please wait a moment.',
      maxHistory: 50,
      params: {
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.95,
      },
      // Only wire MCP servers if a valid public URL is verified reachable.
      ...(mcpServerUrl
        ? {
            mcpServers: [
              {
                name: 'sre-zero-tools',
                endpoint: (() => { const u = new URL(mcpServerUrl); u.searchParams.set('channel', channel_name); return u.toString(); })(),
                transport: 'streamable_http' as const,
              },
            ],
          }
        : {}),
    });

    const agent = new Agent({
      client,
      turnDetection: {
        language: 'en-US',
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 240,
              prefix_padding_ms: 300,
            },
          },
          // Semantic mode analyzes speech meaning to find natural end points,
          // avoiding interrupting mid-thought pauses while responding promptly
          // once a thought is concluded.
          end_of_speech: {
            mode: 'semantic',
            semantic_config: {
              silence_duration_ms: 700,
              max_wait_ms: 2200,
            },
          },
        },
      },
      advancedFeatures: { enable_rtm: true, enable_tools: true },
      // Filler words disabled to prevent repetitive verbal looping during tool calls.
      fillerWords: {
        enable: false,
      },
      parameters: {
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
        // ── Proactive speaking ──────────────────────────
        // Only trigger after a sustained silence (30s) and only if there
        // is an active, unresolved item requiring attention. A brief pause
        // (2-5s) leaves the agent quietly listening.
        silence_config: {
          timeout_ms: 30000,
          action: 'think',
          content:
            'If there is an urgent unapproved rollback or critical unresolved conflict requiring immediate human attention, speak at most 1 brief sentence. If there is no urgent operational action required, remain completely silent and DO NOT speak. Never generate filler phrases or repeat previously stated information.',
        },
        // ── Fast farewell / stop ────────────────────────
        // Disabled or 1s to ensure stop-conversation executes quickly without freezing.
        farewell_config: {
          graceful_enabled: false,
          graceful_timeout_seconds: 1,
        },
      },
    })
      .withStt(
        new DeepgramSTT({
          model: 'nova-3',
          language: 'en',
        }),
      )
      .withLlm(llmConfig)
      .withTts(
        new MiniMaxTTS({
          model: 'speech_2_6_turbo',
          voiceId: 'English_captivating_female1',
        }),
      );

    const session = agent.createSession({
      name: `sre-zero-${channel_name}`,
      channel: channel_name,
      agentUid,
      // '*' subscribes the agent to every uid in the channel so it transcribes
      // ALL human participants, not just the requester who happened to start
      // the session. Scoping this to [requester_id] is the root cause of the
      // multi-user transcript attribution bug: with a single-uid allowlist the
      // agent's ASR only ever produces transcription events for that one uid,
      // so every other participant's speech either never reaches the transcript
      // as its own turn or gets folded into whichever identity the normalization
      // layer falls back to (historically the room creator). See
      // docs/ai/L1/L2/invite_agent_config.md and README.md, both of which
      // already documented `remoteUids: ['*']` as the intended contract.
      remoteUids: ['*'],
      idleTimeout: 180, // 3 minutes — engineers go quiet while investigating
      expiresIn: ExpiresIn.hours(1),
      debug: true,
    });

    // ── Start the agent ──
    const agentId = await session.start();

    // Register the agent so subsequent joiners don't spawn a duplicate.
    registerAgent(channel_name, agentId);

    return NextResponse.json({
      agent_id: agentId,
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
    } as AgentResponse);
  } catch (error) {
    console.error('Error starting conversation:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start conversation',
      },
      { status: 500 },
    );
  }
}
