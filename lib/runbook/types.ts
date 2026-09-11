export type RunbookStepStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'SKIPPED'
  | 'FAILED'
  | 'UNKNOWN';

export type RunbookStepType = 'investigation' | 'human_decision' | 'verification' | 'mitigation';

export interface RunbookStep {
  id: string;
  name: string;
  type: RunbookStepType;
  action: string;
  description: string;
  requiresEvidenceType?: string;
  humanApprovalRequired?: boolean;
  status: RunbookStepStatus;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  blockReason?: string;
  skipReason?: string;
}

export interface RunbookDefinition {
  id: string;
  name: string;
  trigger: string[];
  servicePattern?: string;
  steps: RunbookStep[];
}

export interface RunbookExecutionState {
  runbookId: string;
  runbookName: string;
  activeStepId: string | null;
  overallStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'FAILED';
  steps: RunbookStep[];
  startedAt: string;
  updatedAt: string;
  aiExplanation?: {
    activeStepName: string;
    whyPerformed: string;
    requiredEvidence: string;
    remainingStepsCount: number;
    blockedOrSkippedSummary?: string;
  };
}
