import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, setAiPaused, addIncidentTimeline } from '@/lib/incident/state';

export const dynamic = 'force-dynamic';

// Real, server-side, per-incident AI pause state — NOT a frontend-only flag.
// Pausing never terminates the incident, destroys the room, or clears any
// state/chat/transcript; it only signals that SRE-Zero should not speak
// unnecessarily while humans are working.

// GET /api/ai-pause?channel=<id>
export async function GET(request: NextRequest) {
  const channel = new URL(request.url).searchParams.get('channel') || 'default';
  const state = getIncidentState(channel);
  return NextResponse.json({ aiPaused: state.aiPaused });
}

// POST /api/ai-pause  { channel, paused: boolean, actor? }
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const channel = body.channel || 'default';
  const paused = Boolean(body.paused);
  const actor = body.actor || 'human';

  setAiPaused(channel, paused);
  addIncidentTimeline(channel, {
    type: paused ? 'ai_paused' : 'ai_resumed',
    description: paused
      ? `${actor} paused SRE-Zero. Incident, chat, transcript, and persistence continue; SRE-Zero will not speak unnecessarily until resumed.`
      : `${actor} resumed SRE-Zero.`,
    actor,
    source: 'HUMAN',
  });

  return NextResponse.json({ aiPaused: paused });
}
