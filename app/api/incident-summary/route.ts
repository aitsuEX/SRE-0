import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, getRoster, getAgentId, type Fact, type ApprovalRequest } from '@/lib/room-registry';
import type { IncidentSummaryData } from '@/types/summary';

export async function GET(request: NextRequest) {
  const channel = new URL(request.url).searchParams.get('channel') || 'default';
  const state = getIncidentState(channel);
  const timeline = state.timeline.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const startTime = timeline[0]?.timestamp || state.createdAt || new Date().toISOString();
  const endTime = timeline.at(-1)?.timestamp || state.updatedAt || new Date().toISOString();
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000) || 1,
  );

  const confirmedFacts = state.facts.filter((f) => f.type === 'fact').map(formatFact);
  const hypotheses = (state.hypotheses || []).map((h) => ({
    id: h.id,
    content: h.content,
    status: h.status,
    confidence: h.status === 'SUPPORTED' ? 'likely' : 'unverified',
    source: 'engine',
    timestamp: h.createdAt || new Date().toISOString(),
  }));
  const decisions = (state.decisions || []).map(formatFact);
  const actions = (state.actions || []).map((a) => ({
    id: a.id,
    title: a.title,
    content: a.description || a.title,
    status: a.status,
    priority: a.priority,
    owner: a.owner,
  }));
  const conflicts = (state.conflicts || []).map((c) => ({
    id: c.id,
    description: c.description,
    content: c.description,
    status: c.status,
  }));
  const approvals = (state.approvals || []).map(formatApproval);
  const formattedTimeline = timeline.map(formatTimeline);

  const report: IncidentSummaryData = {
    channel,
    incident: state.incident,
    phase: state.phase,
    severity: state.severity,
    status: state.status,
    generatedAt: new Date().toISOString(),
    startTime,
    endTime,
    durationMinutes,
    participants: getRoster(channel),
    agentActive: !!getAgentId(channel),
    facts: confirmedFacts,
    confirmedFacts,
    hypotheses,
    decisions,
    actions,
    conflicts,
    evidence: state.evidence || [],
    approvals,
    missingInformation: state.missingInformation || [],
    unresolvedRisks: state.unresolvedRisks || [],
    timeline: formattedTimeline,
    summary: {
      totalFacts: confirmedFacts.length,
      totalHypotheses: hypotheses.length,
      totalDecisions: decisions.length,
      totalActions: actions.length,
      totalConflicts: conflicts.length,
      totalTimelineEvents: formattedTimeline.length,
    },
  };

  return NextResponse.json(report);
}

function formatFact(f: Fact) {
  return {
    id: f.id,
    content: f.content,
    confidence: f.confidence,
    source: f.source,
    timestamp: f.timestamp,
    type: f.type,
  };
}

function formatApproval(a: ApprovalRequest) {
  return {
    id: a.id,
    action: a.action,
    target: a.target || null,
    parameters: a.parameters || {},
    reason: a.reason,
    risks: a.risks || [],
    status: a.status,
    decidedBy: a.decided_by || null,
    requestedAt: a.requestedAt || null,
    approvedAt: a.approvedAt || null,
  };
}

function formatTimeline(t: {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  actor?: string;
  source?: string;
  evidenceIds?: string[];
}) {
  return {
    id: t.id,
    timestamp: t.timestamp,
    type: t.type,
    event_type: t.type,
    description: t.description,
    actor: t.actor || 'sre-zero',
    source: t.source || null,
  };
}

