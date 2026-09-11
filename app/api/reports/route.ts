import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState } from '@/lib/incident/state';
import { generateIncidentReports } from '@/lib/reports/generator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel') || 'default';
    const state = getIncidentState(channel);
    const reports = await generateIncidentReports(channel, state);

    return NextResponse.json({
      success: true,
      channel,
      reports,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error generating reports' },
      { status: 500 }
    );
  }
}
