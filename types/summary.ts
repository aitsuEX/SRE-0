import type { RosterParticipant } from '@/lib/room-registry';

export interface SummaryFact {
  id?: string;
  content: string;
  confidence: string;
  source: string;
  timestamp: string;
  type?: string;
}

export interface SummaryHypothesis {
  id?: string;
  content: string;
  status?: string;
  confidence?: string;
  source?: string;
  timestamp?: string;
}

export interface SummaryDecision {
  id?: string;
  content: string;
  confidence?: string;
  source?: string;
  timestamp?: string;
}

export interface SummaryAction {
  id?: string;
  title?: string;
  content?: string;
  status?: string;
  priority?: string;
  owner?: { uid?: string; name: string; role?: string } | string;
}

export interface SummaryConflict {
  id?: string;
  description?: string;
  content?: string;
  status?: string;
}

export interface SummaryApproval {
  id?: string;
  action: string;
  target?: string | null;
  parameters?: Record<string, unknown>;
  reason: string;
  risks?: string[];
  status: string;
  decidedBy?: string | null;
  requestedAt?: string | null;
  approvedAt?: string | null;
}

export interface SummaryTimelineEvent {
  id?: string;
  timestamp: string;
  type: string;
  event_type?: string;
  description: string;
  actor: string;
  source?: string | null;
}

export interface SummaryStats {
  totalFacts: number;
  totalHypotheses: number;
  totalDecisions: number;
  totalActions: number;
  totalConflicts: number;
  totalTimelineEvents: number;
}

export interface IncidentSummaryData {
  channel: string;
  incident: {
    id?: string;
    name: string;
    description?: string;
    createdAt?: string;
  };
  phase: string;
  severity: string;
  status: string;
  generatedAt: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  participants: RosterParticipant[];
  agentActive: boolean;
  facts: SummaryFact[];
  confirmedFacts: SummaryFact[];
  hypotheses: SummaryHypothesis[];
  decisions: SummaryDecision[];
  actions: SummaryAction[];
  conflicts: SummaryConflict[];
  evidence: any[];
  approvals: SummaryApproval[];
  missingInformation: string[];
  unresolvedRisks: string[];
  timeline: SummaryTimelineEvent[];
  summary: SummaryStats;
}
