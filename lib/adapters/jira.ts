import { isConfigured, INCIDENT_CONFIG } from '@/src/config/incident';
import type { IncidentState } from '@/lib/incident/types';

export interface JiraCreateOptions {
  priority?: string;
  labels?: string[];
  issueType?: string;
  projectKey?: string;
}

export interface JiraCreateResult {
  status: 'CREATED' | 'NOT_CONFIGURED' | 'AUTHENTICATION_ERROR' | 'PROJECT_ERROR' | 'JIRA_API_ERROR';
  issueKey?: string;
  issueId?: string;
  url?: string;
  message?: string;
}

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function textNode(text: string, strong = false): AdfNode {
  const node: AdfNode = { type: 'text', text };
  if (strong) node.marks = [{ type: 'strong' }];
  return node;
}

function paragraphNode(nodes: AdfNode[]): AdfNode {
  return {
    type: 'paragraph',
    content: nodes.length > 0 ? nodes : [textNode(' ')],
  };
}

function headingNode(text: string, level = 3): AdfNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [textNode(text)],
  };
}

function bulletListNode(items: string[]): AdfNode {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraphNode([textNode(item)])],
    })),
  };
}

/**
 * Builds a Jira Cloud REST API v3 Atlassian Document Format (ADF) description
 * derived dynamically from the current incident state and real recorded data.
 */
export function buildJiraAdfDescription(
  state?: IncidentState,
  customDescription?: string,
): { type: string; version: number; content: AdfNode[] } {
  const content: AdfNode[] = [];

  // Incident Overview
  if (state) {
    content.push(headingNode(`Incident: ${state.incident.name || 'Active Incident'}`, 2));
    content.push(
      paragraphNode([
        textNode('Status: ', true),
        textNode(`${state.status} | `),
        textNode('Severity: ', true),
        textNode(`${state.severity} | `),
        textNode('Phase: ', true),
        textNode(`${state.phase}`),
      ]),
    );
  }

  if (customDescription?.trim()) {
    content.push(headingNode('Notes / Description', 3));
    content.push(paragraphNode([textNode(customDescription.trim())]));
  }

  if (state) {
    // Confirmed facts
    content.push(headingNode('Confirmed Facts', 3));
    const confirmedFacts = state.facts
      .filter((f) => f.confidence === 'confirmed' || f.type === 'fact')
      .map((f) => `[${f.source || 'Fact'}] ${f.content}`);
    if (confirmedFacts.length > 0) {
      content.push(bulletListNode(confirmedFacts));
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Hypotheses
    content.push(headingNode('Hypotheses', 3));
    if (state.hypotheses.length > 0) {
      content.push(
        bulletListNode(
          state.hypotheses.map((h) => `[${h.status}] ${h.content}`),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Conflicts
    content.push(headingNode('Conflicts', 3));
    if (state.conflicts.length > 0) {
      content.push(
        bulletListNode(
          state.conflicts.map((c) => `[${c.status}] ${c.description}`),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Missing Information
    content.push(headingNode('Missing Information', 3));
    if (state.missingInformation.length > 0) {
      content.push(bulletListNode(state.missingInformation));
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Actions
    content.push(headingNode('Actions', 3));
    if (state.actions.length > 0) {
      content.push(
        bulletListNode(
          state.actions.map(
            (a) =>
              `[${a.status}] ${a.title}${a.owner?.name ? ` (Owner: ${a.owner.name})` : ''}`,
          ),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Decisions
    content.push(headingNode('Decisions', 3));
    if (state.decisions.length > 0) {
      content.push(
        bulletListNode(
          state.decisions.map((d) => `${d.content} (Source: ${d.source})`),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Unresolved Risks
    content.push(headingNode('Unresolved Risks', 3));
    if (state.unresolvedRisks.length > 0) {
      content.push(bulletListNode(state.unresolvedRisks));
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Recent Evidence
    content.push(headingNode('Evidence', 3));
    if (state.evidence.length > 0) {
      content.push(
        bulletListNode(
          state.evidence
            .slice(-10)
            .map((e) => `[${e.source} | ${e.confidence}] ${e.content}`),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }

    // Timeline
    content.push(headingNode('Timeline', 3));
    if (state.timeline.length > 0) {
      content.push(
        bulletListNode(
          state.timeline
            .slice(-10)
            .map((t) => `[${t.timestamp}] ${t.type}: ${t.description}`),
        ),
      );
    } else {
      content.push(paragraphNode([textNode('None recorded.')]));
    }
  }

  if (content.length === 0) {
    content.push(paragraphNode([textNode('SRE-Zero incident ticket.')]));
  }

  return {
    type: 'doc',
    version: 1,
    content,
  };
}

/**
 * Creates a real Jira issue in Jira Cloud using REST API v3.
 * Server-side only: never exposes API tokens or credentials.
 */
export async function createJiraIssue(
  summary: string,
  description?: string,
  options?: JiraCreateOptions,
  incidentState?: IncidentState,
): Promise<JiraCreateResult> {
  const jiraUrl = (process.env.INCIDENT_JIRA_URL || INCIDENT_CONFIG.jiraUrl || '').trim().replace(/\/$/, '');
  const projectKey = (options?.projectKey || process.env.INCIDENT_JIRA_PROJECT_KEY || '').trim().toUpperCase();
  const email = (process.env.INCIDENT_JIRA_EMAIL || '').trim();
  const apiToken = (process.env.INCIDENT_JIRA_API_TOKEN || '').trim();

  // Validate configuration
  if (!jiraUrl || !isConfigured(jiraUrl) || !projectKey || !email || !apiToken) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'Jira integration is not configured. Missing Jira URL, project key, email, or API token.',
    };
  }

  const issueTypeName = options?.issueType || 'Task';
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
  const adfDescription = buildJiraAdfDescription(incidentState, description);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: summary.trim(),
    description: adfDescription,
    issuetype: { name: issueTypeName },
  };

  if (options?.labels && options.labels.length > 0) {
    fields.labels = options.labels;
  }

  if (options?.priority) {
    fields.priority = { name: options.priority };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${jiraUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'SRE-Zero/1.0',
      },
      body: JSON.stringify({ fields }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 201) {
      const data = await response.json() as { id: string; key: string; self: string };
      const browseUrl = `${jiraUrl}/browse/${data.key}`;
      return {
        status: 'CREATED',
        issueKey: data.key,
        issueId: data.id,
        url: browseUrl,
      };
    }

    let errorDetail = '';
    try {
      const errJson = await response.json() as { errorMessages?: string[]; errors?: Record<string, string> };
      const msgs = [...(errJson.errorMessages || []), ...Object.entries(errJson.errors || {}).map(([k, v]) => `${k}: ${v}`)];
      errorDetail = msgs.join('; ') || `HTTP ${response.status}`;
    } catch {
      errorDetail = `HTTP ${response.status}`;
    }

    const isAuthOrPermission =
      response.status === 401 ||
      response.status === 403 ||
      errorDetail.toLowerCase().includes('permission') ||
      errorDetail.includes('无权') ||
      errorDetail.toLowerCase().includes('unauthorized') ||
      errorDetail.toLowerCase().includes('forbidden') ||
      errorDetail.toLowerCase().includes('authenticate');

    if (isAuthOrPermission) {
      return {
        status: 'AUTHENTICATION_ERROR',
        message: `Jira authentication or permission error: ${errorDetail}`,
      };
    }

    if (response.status === 400 && (errorDetail.toLowerCase().includes('project') || errorDetail.toLowerCase().includes('issuetype'))) {
      return {
        status: 'PROJECT_ERROR',
        message: `Jira project or issue type error: ${errorDetail}`,
      };
    }

    return {
      status: 'JIRA_API_ERROR',
      message: `Jira API error (${response.status}): ${errorDetail}`,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'JIRA_API_ERROR',
      message: isTimeout ? 'Jira request timed out.' : (error instanceof Error ? error.message : 'Unknown network error'),
    };
  }
}
