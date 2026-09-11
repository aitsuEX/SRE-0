export type EvidenceConfidence = 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED' | 'UNKNOWN';
export type EvidenceSource = 'HUMAN' | 'WEBSITE' | 'GITHUB' | 'TESTSPRITE' | 'MONITORING' | 'JIRA' | 'PAGERDUTY' | 'ROLLBACK' | 'SYSTEM';
export type IncidentPhase = 'DETECTED' | 'TRIAGING' | 'INVESTIGATING' | 'MITIGATION' | 'RECOVERY' | 'MONITORING' | 'RESOLVED';
export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4' | 'UNKNOWN';

export interface Evidence {
  id: string;
  type: 'OBSERVATION' | 'FACT' | 'HYPOTHESIS' | 'DECISION' | 'ACTION' | 'CONFLICT';
  content: string;
  confidence: EvidenceConfidence;
  source: EvidenceSource;
  sourceUrl?: string;
  actorId?: string;
  actorName?: string;
  observedAt?: string;
  recordedAt: string;
  checkedAt?: string;
  freshness?: 'FRESH' | 'STALE' | 'UNKNOWN';
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface Hypothesis {
  id: string;
  content: string;
  status: 'PROPOSED' | 'INVESTIGATING' | 'SUPPORTED' | 'REFUTED' | 'CONFIRMED';
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Conflict {
  id: string;
  description: string;
  evidenceIds: string[];
  status: 'UNRESOLVED' | 'RESOLVED';
  createdAt: string;
  resolvedAt?: string;
}

export interface ActionItem {
  id: string;
  title: string;
  description?: string;
  owner?: { uid?: string; name: string; role?: string };
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dueAt?: string;
  evidenceIds: string[];
  source: string;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  target?: string;
  parameters?: Record<string, unknown>;
  reason: string;
  risks: string[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAt: string;
  approvedAt?: string;
  expiresAt?: string;
  decided_by?: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  actor?: string;
  source?: string;
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface IncidentMetadata {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export type RecoveryState =
  | 'INCIDENT_ACTIVE'
  | 'ROLLBACK_RECOMMENDED'
  | 'AWAITING_HUMAN_DECISION'
  | 'HUMAN_REPORTED_CHANGE'
  | 'VERIFYING_RECOVERY'
  | 'RECOVERED'
  | 'STILL_IMPACTED'
  | 'VERIFICATION_UNKNOWN'
  | 'OTHER_OPTIONS_REQUESTED'
  | 'JIRA_PROVIDED'
  | 'WAITING_FOR_COMMAND';

export interface RecoveryEvidenceSnapshot {
  capturedAt: string;
  websiteStatus: string;
  monitoringStatus: string;
  detail: string;
}

export interface RecoveryRecord {
  state: RecoveryState;
  updatedAt: string;
  before?: RecoveryEvidenceSnapshot;
  humanReportedChange?: { reportedBy: string; description: string; reportedAt: string };
  after?: RecoveryEvidenceSnapshot;
  verificationResult?: 'HEALTHY' | 'STILL_IMPACTED' | 'UNKNOWN';
  history: Array<{ state: RecoveryState; at: string }>;
}

export interface IncidentFact { id:string; content:string; confidence:'confirmed'|'likely'|'unverified'|'unknown'; source:string; type:'fact'|'hypothesis'|'decision'|'action'|'conflict'; timestamp:string; }

export interface IncidentState {
  incident: IncidentMetadata;
  phase: IncidentPhase;
  severity: IncidentSeverity;
  status: 'ACTIVE' | 'RESOLVED';
  participants: Array<{ uid: string; name: string; role: string; joinedAt: number }>;
  evidence: Evidence[];
  facts: IncidentFact[];
  hypotheses: Hypothesis[];
  conflicts: Conflict[];
  decisions: IncidentFact[];
  actions: ActionItem[];
  approvals: ApprovalRequest[];
  timeline: TimelineEvent[];
  missingInformation: string[];
  unresolvedRisks: string[];
  investigations: Array<{ id: string; question: string; evidenceIds: string[]; conclusion?: string; createdAt: string }>;
  recovery: RecoveryRecord;
  aiPaused: boolean;
  createdAt: string;
  updatedAt: string;
}
