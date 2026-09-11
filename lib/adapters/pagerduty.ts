import { INCIDENT_CONFIG, isPagerDutyConfigured } from '@/src/config/incident';

/**
 * Real PagerDuty REST API v2 adapter.
 *
 * Requires server-only env vars (never exposed to the client):
 *   PAGERDUTY_API_TOKEN    - REST API token (Account/User token with read access)
 *   PAGERDUTY_SERVICE_ID   - the PagerDuty service to scope incident lookups to
 *   PAGERDUTY_API_BASE_URL - optional override, defaults to https://api.pagerduty.com
 *
 * This adapter never fabricates PagerDuty data. If credentials are missing it
 * returns NOT_CONFIGURED. If the API call fails it returns UNAVAILABLE with the
 * real error detail. It never silently converts a failure into a success.
 */

export interface PagerDutyIncidentSummary {
  id: string;
  incidentNumber: number;
  title: string;
  status: string; // triggered | acknowledged | resolved (PagerDuty's own vocabulary)
  urgency: string;
  serviceId: string;
  serviceName: string;
  createdAt: string;
  htmlUrl: string;
  escalationPolicy?: string;
  assignees: string[];
}

export type PagerDutyResult =
  | { status: 'NOT_CONFIGURED'; message: string }
  | { status: 'UNAVAILABLE'; message: string }
  | { status: 'AUTHENTICATION_ERROR'; message: string }
  | { status: 'OK'; incidents: PagerDutyIncidentSummary[]; checkedAt: string };

function authHeaders() {
  return {
    Authorization: `Token token=${INCIDENT_CONFIG.pagerDutyApiToken}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    'Content-Type': 'application/json',
  };
}

/**
 * Fetches currently open (triggered/acknowledged) PagerDuty incidents for the
 * configured service. Real network call — no invented data.
 */
export async function fetchPagerDutyIncidents(): Promise<PagerDutyResult> {
  const checkedAt = new Date().toISOString();

  if (!isPagerDutyConfigured()) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'PAGERDUTY_API_TOKEN and/or PAGERDUTY_SERVICE_ID are not set. PagerDuty integration is inactive.',
    };
  }

  const base = INCIDENT_CONFIG.pagerDutyApiBase;
  const serviceId = INCIDENT_CONFIG.pagerDutyServiceId;
  const url = `${base}/incidents?service_ids[]=${encodeURIComponent(serviceId)}&statuses[]=triggered&statuses[]=acknowledged&sort_by=created_at:desc&limit=25`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return { status: 'AUTHENTICATION_ERROR', message: `PagerDuty rejected the configured API token (HTTP ${res.status}).` };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'UNAVAILABLE', message: `PagerDuty API returned HTTP ${res.status}. ${body.slice(0, 300)}` };
    }

    const data = await res.json();
    const raw: any[] = Array.isArray(data?.incidents) ? data.incidents : [];
    const incidents: PagerDutyIncidentSummary[] = raw.map((inc) => ({
      id: String(inc.id),
      incidentNumber: Number(inc.incident_number),
      title: String(inc.title || inc.summary || 'Untitled PagerDuty incident'),
      status: String(inc.status || 'unknown'),
      urgency: String(inc.urgency || 'unknown'),
      serviceId: String(inc.service?.id || serviceId),
      serviceName: String(inc.service?.summary || ''),
      createdAt: String(inc.created_at || checkedAt),
      htmlUrl: String(inc.html_url || ''),
      escalationPolicy: inc.escalation_policy?.summary ? String(inc.escalation_policy.summary) : undefined,
      assignees: Array.isArray(inc.assignments)
        ? inc.assignments.map((a: any) => String(a?.assignee?.summary || '')).filter(Boolean)
        : [],
    }));

    return { status: 'OK', incidents, checkedAt };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'Unknown network error contacting PagerDuty.';
    return { status: 'UNAVAILABLE', message };
  }
}

/**
 * Fetches a single PagerDuty incident by ID for explicit mapping to an SRE-Zero incident.
 */
export async function fetchPagerDutyIncidentById(pagerDutyIncidentId: string): Promise<PagerDutyResult> {
  if (!isPagerDutyConfigured()) {
    return { status: 'NOT_CONFIGURED', message: 'PagerDuty is not configured.' };
  }
  const base = INCIDENT_CONFIG.pagerDutyApiBase;
  const url = `${base}/incidents/${encodeURIComponent(pagerDutyIncidentId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: authHeaders(), signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) {
      return { status: 'AUTHENTICATION_ERROR', message: `PagerDuty rejected the configured API token (HTTP ${res.status}).` };
    }
    if (res.status === 404) {
      return { status: 'UNAVAILABLE', message: `PagerDuty incident ${pagerDutyIncidentId} was not found.` };
    }
    if (!res.ok) {
      return { status: 'UNAVAILABLE', message: `PagerDuty API returned HTTP ${res.status}.` };
    }
    const data = await res.json();
    const inc = data?.incident;
    if (!inc) return { status: 'UNAVAILABLE', message: 'PagerDuty response did not contain an incident payload.' };
    return {
      status: 'OK',
      checkedAt: new Date().toISOString(),
      incidents: [
        {
          id: String(inc.id),
          incidentNumber: Number(inc.incident_number),
          title: String(inc.title || inc.summary || 'Untitled PagerDuty incident'),
          status: String(inc.status || 'unknown'),
          urgency: String(inc.urgency || 'unknown'),
          serviceId: String(inc.service?.id || ''),
          serviceName: String(inc.service?.summary || ''),
          createdAt: String(inc.created_at || new Date().toISOString()),
          htmlUrl: String(inc.html_url || ''),
          escalationPolicy: inc.escalation_policy?.summary ? String(inc.escalation_policy.summary) : undefined,
          assignees: Array.isArray(inc.assignments)
            ? inc.assignments.map((a: any) => String(a?.assignee?.summary || '')).filter(Boolean)
            : [],
        },
      ],
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'Unknown network error contacting PagerDuty.';
    return { status: 'UNAVAILABLE', message };
  }
}
