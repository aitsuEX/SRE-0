import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, addTimelineEvent, addFact } from '@/lib/room-registry';
import { INCIDENT_CONFIG, isConfigured } from '@/src/config/incident';
import { runIncidentContext, getIncidentContext } from '@/lib/incident/context';
import { addIncidentEvidence, persistIncidentState } from '@/lib/incident/state';
import { checkMonitoring } from '@/lib/adapters/monitoring';
import { checkWebsite } from '@/lib/adapters/website';
import { checkGitHub } from '@/lib/adapters/github';
import { createJiraIssue } from '@/lib/adapters/jira';
import { fetchPagerDutyIncidents } from '@/lib/adapters/pagerduty';
import { detectConflicts, deriveMissingInformation, upsertHypothesis } from '@/lib/incident/engines';
import { requestApproval } from '@/lib/incident/actions';
import { verifyRecovery } from '@/lib/incident/recovery';
import type { ActionItem, Conflict, IncidentFact } from '@/lib/incident/types';

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});
const now = () => new Date().toISOString();

const tools = {
  check_ai_restraint: {
    description:
      'Check whether SRE-Zero is currently in a human-requested restraint/pause state for this incident. Real, persisted, server-side state — call this before speaking unprompted. If paused=true, do not proactively speak or offer help; only respond if a human directly asks SRE-Zero a question by name.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const channel = getIncidentContext() || 'default';
      const state = getIncidentState(channel);
      return {
        paused: state.aiPaused === true,
        recoveryState: state.recovery?.state,
        guidance: state.aiPaused
          ? 'Restraint is active. Stay silent unless directly addressed by name or asked a direct question.'
          : 'No restraint active. Normal operation.',
      };
    },
  },
  checkWebsite: {
    description: 'Check the configured website using a real HTTP request. Never fabricates health.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      return await checkWebsite();
    },
  },
  checkGitHub: {
    description: 'Read recent commits from the configured GitHub repository. A commit is evidence of a change, not proof of causality.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => checkGitHub(),
  },
  check_monitoring: {
    description: 'Query real configured monitoring data. No configured monitoring means UNKNOWN.',
    inputSchema: { type: 'object', properties: { metric: { type: 'string' } }, required: [] },
    handler: async (args?: { metric?: string }) => checkMonitoring(args?.metric),
  },
  record_fact: {
    description: 'Record human/tool information as fact, hypothesis, decision, action, or conflict. Unverified claims are never promoted to confirmed facts.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        type: { type: 'string', enum: ['fact', 'hypothesis', 'decision', 'action', 'conflict'] },
        confidence: { type: 'string', enum: ['confirmed', 'likely', 'unverified', 'unknown'] },
        source: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['content', 'type'],
    },
    handler: (args: { content?: string; fact?: string; type?: string; fact_type?: string; confidence?: string; source?: string; owner?: string; decision?: string; action?: string }) => {
      const channel = getIncidentContext() || 'default';
      const state = getIncidentState(channel);
      const factId = `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timestamp = now();
      const rawContent = args.content || args.fact || args.decision || args.action || '';
      const factType = ((args.type || args.fact_type || (args.decision ? 'decision' : args.action ? 'action' : 'fact')) as string).toLowerCase() as IncidentFact['type'];
      const factConfidence = (factType === 'fact' && args.confidence === 'confirmed' ? 'confirmed' : (args.confidence || 'unverified')) as IncidentFact['confidence'];
      const source = args.source || 'human';

      const fact: IncidentFact = {
        id: factId,
        content: args.owner ? `${rawContent} (Owner: ${args.owner})` : rawContent,
        confidence: factConfidence,
        source,
        type: factType,
        timestamp,
      };

      addFact(fact, channel);

      if (factType === 'hypothesis') {
        upsertHypothesis(state, rawContent, [], (args.confidence === 'likely' ? 'SUPPORTED' : 'PROPOSED'));
      } else if (factType === 'decision' || args.decision) {
        const dContent = args.decision || rawContent;
        const existingDecision = state.decisions.find((d) => d.content.toLowerCase() === dContent.toLowerCase());
        if (!existingDecision) {
          state.decisions.push({
            id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            content: dContent,
            confidence: 'confirmed',
            source,
            type: 'decision',
            timestamp,
          });
        }
      }

      if (factType === 'action' || args.action) {
        const aTitle = args.action || rawContent;
        const existingAction = state.actions.find((a) => a.title.toLowerCase() === aTitle.toLowerCase());
        if (!existingAction) {
          const actionItem: ActionItem = {
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: aTitle,
            description: aTitle,
            owner: args.owner ? { name: args.owner } : undefined,
            status: 'OPEN',
            priority: 'HIGH',
            createdAt: timestamp,
            evidenceIds: [],
            source,
          };
          state.actions.push(actionItem);
        }

        if (aTitle.toLowerCase().includes('rollback')) {
          if (!state.approvals.some((a) => a.action.toLowerCase() === 'rollback' && a.status === 'pending')) {
            requestApproval(channel, 'rollback', undefined, undefined, aTitle || 'Rollback requested by team', []);
          }
        }
      }

      if (rawContent.toLowerCase().includes('rollback') && !state.approvals.some((a) => a.action.toLowerCase() === 'rollback' && a.status === 'pending')) {
        requestApproval(channel, 'rollback', undefined, undefined, rawContent || 'Rollback requested by team', []);
      }

      if (factType === 'conflict') {
        const existingConflict = state.conflicts.find((c) => c.description.toLowerCase() === rawContent.toLowerCase());
        if (!existingConflict) {
          const conflictItem: Conflict = {
            id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            description: rawContent,
            evidenceIds: [],
            status: 'UNRESOLVED',
            createdAt: timestamp,
          };
          state.conflicts.push(conflictItem);
        }
      }

      state.missingInformation = deriveMissingInformation(state);
      state.updatedAt = timestamp;
      persistIncidentState(channel, state);
      addTimelineEvent(channel, 'fact_recorded', `${factType}: ${rawContent}`, source);
      return fact;
    },
  },
  get_incident_state: {
    description: 'Return the complete structured incident state.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => getIncidentState(),
  },
  detect_conflict: {
    description: 'Compare a human claim with real monitoring evidence and preserve both sides.',
    inputSchema: { type: 'object', properties: { claim: { type: 'string' }, metric: { type: 'string' } }, required: ['claim', 'metric'] },
    handler: async (args: { claim: string; metric: string }) => {
      const channel = getIncidentContext() || 'default';
      const state = getIncidentState(channel);
      const m = await checkMonitoring(args.metric);
      const timestamp = now();
      const e1 = {
        id: `human-${Date.now()}`,
        type: 'OBSERVATION' as const,
        content: args.claim,
        confidence: 'UNVERIFIED' as const,
        source: 'HUMAN' as const,
        recordedAt: timestamp,
      };
      addIncidentEvidence(channel, e1);
      const e2 = {
        id: `monitor-${Date.now()}`,
        type: 'OBSERVATION' as const,
        content: `Monitoring ${args.metric}: ${String(m.metrics[args.metric] ?? m.status)}`,
        confidence: m.status === 'UNKNOWN' || m.status === 'UNAVAILABLE' ? ('UNKNOWN' as const) : ('CONFIRMED' as const),
        source: 'MONITORING' as const,
        sourceUrl: m.sourceUrl,
        recordedAt: timestamp,
        checkedAt: m.checkedAt,
      };
      addIncidentEvidence(channel, e2);
      const conflicts = detectConflicts(state.evidence);
      for (const c of conflicts) {
        if (!state.conflicts.some((x) => x.id === c.id)) state.conflicts.push(c);
      }
      state.missingInformation = deriveMissingInformation(state);
      state.updatedAt = timestamp;
      return { claim: args.claim, monitoring: m, conflicts: state.conflicts };
    },
  },
  request_approval: {
    description: 'Request explicit human approval for a critical action. Approval is bound to action, target and parameters and expires.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        target: { type: 'string' },
        parameters: { type: 'object' },
        reason: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
      },
      required: ['action', 'reason'],
    },
    handler: (args: { action: string; target?: string; parameters?: Record<string, unknown>; reason: string; risks?: string[] }) => {
      const channel = getIncidentContext() || 'default';
      return requestApproval(channel, args.action, args.target, args.parameters, args.reason, args.risks || []);
    },
  },
  check_pagerduty: {
    description:
      'Retrieve real, currently open PagerDuty incidents for the configured service. Returns NOT_CONFIGURED if PagerDuty env vars are absent, or UNAVAILABLE/AUTHENTICATION_ERROR on real API failure. Never fabricates PagerDuty data.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const channel = getIncidentContext() || 'default';
      const result = await fetchPagerDutyIncidents();
      if (result.status !== 'OK') return result;

      const state = getIncidentState(channel);
      const alreadyMapped = new Set(state.evidence.filter((e) => e.source === 'PAGERDUTY').map((e) => e.id));
      for (const inc of result.incidents) {
        const evidenceId = `pagerduty-${inc.id}`;
        if (alreadyMapped.has(evidenceId)) continue;
        addIncidentEvidence(channel, {
          id: evidenceId,
          type: 'OBSERVATION',
          content: `PagerDuty incident #${inc.incidentNumber} "${inc.title}" — status=${inc.status}, urgency=${inc.urgency}${inc.serviceName ? `, service=${inc.serviceName}` : ''}`,
          confidence: 'CONFIRMED',
          source: 'PAGERDUTY',
          sourceUrl: inc.htmlUrl || undefined,
          recordedAt: now(),
          checkedAt: result.checkedAt,
        });
        addTimelineEvent(channel, 'pagerduty_incident_mapped', `PagerDuty incident #${inc.incidentNumber} (${inc.status}) mapped to this incident.`, 'sre-zero');
      }
      return result;
    },
  },
  create_jira: {
    description: 'Create a real Jira issue in the configured project using live incident state. Never invents issue keys.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Concise issue title' },
        description: { type: 'string', description: 'Optional additional notes or context' },
        priority: { type: 'string', description: 'Optional priority (e.g. Highest, High, Medium, Low)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Optional list of labels' },
      },
      required: ['summary'],
    },
    handler: async (args: { summary: string; description?: string; priority?: string; labels?: string[] }) => {
      const channel = getIncidentContext() || 'default';
      const state = getIncidentState(channel);
      const res = await createJiraIssue(args.summary, args.description, { priority: args.priority, labels: args.labels }, state);
      if (res.status === 'CREATED' && res.issueKey) {
        addIncidentEvidence(channel, {
          id: `jira-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'ACTION',
          content: `Jira issue created: ${res.issueKey} (${res.url}) - ${args.summary}`,
          confidence: 'CONFIRMED',
          source: 'JIRA',
          sourceUrl: res.url,
          recordedAt: now(),
        });
        addTimelineEvent(channel, 'jira_created', `Jira issue ${res.issueKey} created: ${args.summary}`, 'sre-zero');
        state.updatedAt = now();
      }
      return res;
    },
  },
  execute_rollback: {
    description:
      'SRE-Zero NEVER executes rollback or any production mutation. This tool exists only so the AI cannot silently "succeed" if it attempts to call it; it always returns BLOCKED and records that rollback remains a human-only action, then points to the human-reported-change + verification workflow.',
    inputSchema: { type: 'object', properties: { commit_sha: { type: 'string' }, approval_id: { type: 'string' } }, required: ['approval_id'] },
    handler: async (args: { commit_sha?: string; approval_id?: string }) => {
      const channel = getIncidentContext() || 'default';
      const state = getIncidentState(channel);
      const a = args.approval_id
        ? state.approvals.find((x) => x.id === args.approval_id)
        : state.approvals.slice().reverse().find((x) => x.action === 'rollback');

      addTimelineEvent(
        channel,
        'rollback_execution_blocked',
        `SRE-Zero was asked to execute a rollback${a ? ` (approval ${a.id})` : ''} but rollback execution is disabled by design. A human must perform the change and report it complete.`,
        'sre-zero',
      );

      return {
        status: 'BLOCKED',
        message:
          'SRE-Zero does not execute rollbacks or any production change, even when a human has approved rollback as the remediation direction. A human must perform the change themselves and then report it (e.g. via the "Changed" action) so SRE-Zero can independently verify recovery.',
        approval_id: a?.id,
      };
    },
  },
  verify_recovery: {
    description: 'Run independent real website and monitoring checks. Resolve only when the available evidence supports recovery.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => verifyRecovery(getIncidentContext() || 'default'),
  },
};

async function recordEvidence(channel: string, result: { status?: string; sourceUrl?: string; url?: string; checkedAt?: string }, source: 'WEBSITE' | 'GITHUB' | 'MONITORING') {
  const status = String(result.status || 'UNKNOWN');
  const confidence = ['UP', 'PASS', 'HEALTHY', 'SUCCESS'].includes(status) ? 'CONFIRMED' : status === 'UNKNOWN' || status === 'UNAVAILABLE' ? 'UNKNOWN' : 'UNVERIFIED';
  addIncidentEvidence(channel, {
    id: `${source.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'OBSERVATION',
    content: `${source}: ${JSON.stringify(result)}`,
    confidence: confidence as 'CONFIRMED' | 'UNVERIFIED' | 'UNKNOWN',
    source,
    sourceUrl: result.sourceUrl || result.url,
    recordedAt: now(),
    checkedAt: result.checkedAt,
  });
  const state = getIncidentState(channel);
  state.missingInformation = deriveMissingInformation(state);
  state.updatedAt = now();
  addTimelineEvent(channel, 'evidence_gathered', `${source} check returned ${status}`, 'sre-zero');
}

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, ngrok-skip-browser-warning',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const expectedAuthToken = process.env.MCP_AUTH_TOKEN?.trim();
    if (expectedAuthToken) {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      const urlToken = new URL(request.url).searchParams.get('auth_token') || new URL(request.url).searchParams.get('token') || '';
      if (token !== expectedAuthToken && urlToken !== expectedAuthToken) {
        return NextResponse.json(
          { jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized: Invalid or missing MCP_AUTH_TOKEN' } },
          { status: 401, headers: CORS_HEADERS }
        );
      }
    }

    const body = await request.json();
    if (body.method === 'initialize') {
      console.log(`[MCP:protocol] Received 'initialize' from client. Protocol version: 2024-11-05`);
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sre-zero-mcp', version: '2.0.0' },
        },
      }, { headers: CORS_HEADERS });
    }
    if (body.method === 'tools/list') {
      const toolNames = Object.keys(tools);
      console.log(`[MCP:protocol] Received 'tools/list'. Returning ${toolNames.length} callable tools: [${toolNames.join(', ')}]`);
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      }, { headers: CORS_HEADERS });
    }
    if (body.method === 'tools/call') {
      const name = body.params?.name as keyof typeof tools;
      const args = body.params?.arguments || {};
      const channel = new URL(request.url).searchParams.get('channel') || 'default';
      const tool = tools[name];
      if (!tool) {
        console.warn(`[MCP:tools/call] Tool not found: ${name}`);
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: `Tool not found: ${name}` },
        }, { headers: CORS_HEADERS });
      }

      console.log(`[MCP:tools/call] [START] Invoking tool="${name}", channel="${channel}", args=`, JSON.stringify(args));

      try {
        const result = await runIncidentContext(channel, async () => {
          const value = await (tool.handler as (args: unknown) => Promise<unknown> | unknown)(args);
          if (['checkWebsite', 'checkGitHub'].includes(String(name))) {
            await recordEvidence(channel, value as { status?: string; sourceUrl?: string; url?: string; checkedAt?: string }, (name === 'checkWebsite' ? 'WEBSITE' : 'GITHUB') as 'WEBSITE' | 'GITHUB');
          }
          if (name === 'check_monitoring') {
            await recordEvidence(channel, value as { status?: string; sourceUrl?: string; url?: string; checkedAt?: string }, 'MONITORING');
          }
          if (name === 'detect_conflict' || name === 'record_fact') {
            const s = getIncidentState(channel);
            s.missingInformation = deriveMissingInformation(s);
            const cs = detectConflicts(s.evidence);
            for (const c of cs) {
              if (!s.conflicts.some((x) => x.id === c.id)) s.conflicts.push(c);
            }
          }
          return value;
        });

        const responsePayload = { jsonrpc: '2.0', id: body.id, result: text(result) };

        if (name === 'checkWebsite') {
          const checkRes = result as any;
          console.log(`[MCP:checkWebsite] Runtime Execution Success:`, {
            toolName: 'checkWebsite',
            inputArguments: args,
            httpStatus: checkRes?.httpStatus,
            websiteStatus: checkRes?.status,
            sourceUrl: checkRes?.sourceUrl,
            responseTimeMs: checkRes?.responseTimeMs,
            toolExecutionError: checkRes?.error || null,
            responseReturnedToLLM: responsePayload.result,
          });
        } else {
          console.log(`[MCP:${name}] Runtime Execution Success:`, {
            toolName: name,
            resultPreview: typeof result === 'object' ? JSON.stringify(result).slice(0, 150) : String(result),
          });
        }

        return NextResponse.json(responsePayload, { headers: CORS_HEADERS });
      } catch (toolError) {
        console.error(`[MCP:${name}] Tool Execution Exception:`, toolError);
        return NextResponse.json(
          { jsonrpc: '2.0', id: body.id, error: { code: -32603, message: toolError instanceof Error ? toolError.message : 'Internal tool execution error' } },
          { status: 500, headers: CORS_HEADERS },
        );
      }
    }
    return NextResponse.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `Method not found: ${body.method}` } }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error(`[MCP] Request parsing error:`, error);
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function GET(request: NextRequest) {
  const channel = new URL(request.url).searchParams.get('channel') || 'default';
  const state = getIncidentState(channel);
  console.log('[mcp GET] channel:', channel, 'facts count:', state.facts?.length, 'state.facts:', state.facts);
  return NextResponse.json({
    incident: state.incident,
    phase: state.phase,
    severity: state.severity,
    status: state.status,
    participants: state.participants,
    evidence: state.evidence,
    facts: state.facts,
    hypotheses: state.hypotheses,
    conflicts: state.conflicts,
    decisions: state.decisions,
    actions: state.actions,
    approvals: state.approvals,
    timeline: state.timeline,
    missingInformation: state.missingInformation,
    unresolvedRisks: state.unresolvedRisks,
    config: {
      incidentName: INCIDENT_CONFIG.incidentName,
      websiteConfigured: isConfigured(INCIDENT_CONFIG.websiteUrl),
      githubConfigured: isConfigured(INCIDENT_CONFIG.githubRepoUrl),
      jiraConfigured: isConfigured(INCIDENT_CONFIG.jiraUrl),
      monitoringConfigured: isConfigured(INCIDENT_CONFIG.monitoringUrl),
    },
  });
}

