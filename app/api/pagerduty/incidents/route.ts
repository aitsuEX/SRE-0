import { NextRequest, NextResponse } from 'next/server';
import { fetchPagerDutyIncidents } from '@/lib/adapters/pagerduty';
import { addIncidentEvidence, addIncidentTimeline, getIncidentState, persistIncidentState } from '@/lib/incident/state';

export const dynamic = 'force-dynamic';

// GET /api/pagerduty/incidents?channel=<incidentId>
//
// Real, read-only PagerDuty lookup. Never fabricates incidents. If the
// integration is not configured, or the PagerDuty API call fails, that is
// reported honestly (NOT_CONFIGURED / AUTHENTICATION_ERROR / UNAVAILABLE) and
// no evidence is recorded. Successful, non-empty results are persisted as
// evidence and mapped into the incident timeline exactly once per PagerDuty
// incident id (idempotent — re-fetching does not duplicate timeline entries).
export async function GET(request: NextRequest) {
  const channel = new URL(request.url).searchParams.get('channel') || 'default';
  const result = await fetchPagerDutyIncidents();

  if (result.status !== 'OK') {
    return NextResponse.json(result, { status: result.status === 'NOT_CONFIGURED' ? 200 : 502 });
  }

  const state = getIncidentState(channel);
  const alreadyMapped = new Set(
    state.evidence
      .filter((e) => e.source === 'PAGERDUTY')
      .map((e) => e.id),
  );

  for (const inc of result.incidents) {
    const evidenceId = `pagerduty-${inc.id}`;
    if (alreadyMapped.has(evidenceId)) continue; // idempotent: don't duplicate

    addIncidentEvidence(channel, {
      id: evidenceId,
      type: 'OBSERVATION',
      content: `PagerDuty incident #${inc.incidentNumber} "${inc.title}" — status=${inc.status}, urgency=${inc.urgency}${inc.serviceName ? `, service=${inc.serviceName}` : ''}`,
      confidence: 'CONFIRMED',
      source: 'PAGERDUTY',
      sourceUrl: inc.htmlUrl || undefined,
      recordedAt: new Date().toISOString(),
      checkedAt: result.checkedAt,
    });
    addIncidentTimeline(channel, {
      type: 'pagerduty_incident_mapped',
      description: `PagerDuty incident #${inc.incidentNumber} (${inc.status}) mapped to this incident.`,
      actor: 'sre-zero',
      source: 'PAGERDUTY',
    });
  }
  state.updatedAt = new Date().toISOString();
  persistIncidentState(channel, state);

  return NextResponse.json(result);
}
