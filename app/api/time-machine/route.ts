import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState } from '@/lib/incident/state';
import {
  captureTimeMachineSnapshot,
  getTimeMachineHistory,
  getSnapshotAtTimestamp,
} from '@/lib/incident/timemachine';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel') || 'default';
    const timestamp = searchParams.get('timestamp');

    if (timestamp) {
      const snap = await getSnapshotAtTimestamp(channel, timestamp);
      return NextResponse.json({ success: true, snapshot: snap });
    }

    const history = await getTimeMachineHistory(channel);
    return NextResponse.json({ success: true, history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error fetching time machine data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { channel = 'default', summary = 'Manual checkpoint' } = body;
    const state = getIncidentState(channel);
    const snap = await captureTimeMachineSnapshot(channel, summary, state);
    return NextResponse.json({ success: true, snapshot: snap });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error capturing time machine snapshot' },
      { status: 500 }
    );
  }
}
