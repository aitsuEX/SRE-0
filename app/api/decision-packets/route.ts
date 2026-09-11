import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState } from '@/lib/incident/state';
import { createDecisionPacket, submitHumanVerdict } from '@/lib/incident/decisionpacket';
import { IncidentRepository } from '@/lib/db/repository';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel') || 'default';
    const packets = await IncidentRepository.getDecisionPackets(channel);
    return NextResponse.json({ success: true, packets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error fetching decision packets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      channel = 'default',
      action = 'create',
      title,
      problem,
      packetId,
      verdict,
      decidedBy,
      rationale,
      options,
    } = body;

    const state = getIncidentState(channel);

    if (action === 'create') {
      if (!title || !problem) {
        return NextResponse.json({ error: 'title and problem are required' }, { status: 400 });
      }
      const packet = await createDecisionPacket(channel, title, problem, options, state);
      return NextResponse.json({ success: true, packet });
    }

    if (action === 'verdict') {
      if (!packetId || !verdict || !decidedBy) {
        return NextResponse.json(
          { error: 'packetId, verdict, and decidedBy are required' },
          { status: 400 }
        );
      }
      const updated = await submitHumanVerdict(channel, packetId, verdict, decidedBy, rationale);
      if (!updated) {
        return NextResponse.json({ error: 'Decision packet not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, packet: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error processing decision packet' },
      { status: 500 }
    );
  }
}
