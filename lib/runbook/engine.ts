import type { IncidentState } from '@/lib/incident/types';
import type { RunbookDefinition, RunbookExecutionState, RunbookStep } from './types';

export const DEFAULT_RUNBOOKS: RunbookDefinition[] = [
  {
    id: 'payment_api_high_error_rate',
    name: 'Payment API High Error Rate',
    trigger: ['HTTP 5xx spike', 'payment requests failing', 'high error rate'],
    servicePattern: 'payment',
    steps: [
      {
        id: 'check_website',
        name: 'Verify Website Health',
        type: 'investigation',
        action: 'checkWebsite',
        description: 'Perform HTTP GET health check on primary web application endpoint.',
        requiresEvidenceType: 'WEBSITE',
        status: 'PENDING',
      },
      {
        id: 'check_monitoring',
        name: 'Query Telemetry & Monitoring',
        type: 'investigation',
        action: 'checkMonitoring',
        description: 'Fetch real error rates, CPU, and latency metrics from connected monitoring source.',
        requiresEvidenceType: 'MONITORING',
        status: 'PENDING',
      },
      {
        id: 'check_github',
        name: 'Inspect Code Deployments',
        type: 'investigation',
        action: 'checkGitHub',
        description: 'Check recent GitHub commits for deployment changes correlated with spike.',
        requiresEvidenceType: 'GITHUB',
        status: 'PENDING',
      },
      {
        id: 'review_remediation',
        name: 'Human Remediation Gate',
        type: 'human_decision',
        action: 'askHuman',
        description: 'Present evidence to incident commander for manual code fix or mitigation strategy.',
        humanApprovalRequired: true,
        status: 'PENDING',
      },
      {
        id: 'verify_recovery',
        name: 'Verify Independent Recovery',
        type: 'verification',
        action: 'checkWebsite',
        description: 'Execute post-change website and monitoring verification to confirm HEALTHY status.',
        requiresEvidenceType: 'WEBSITE',
        status: 'PENDING',
      },
    ],
  },
  {
    id: 'service_latency_outage',
    name: 'Service Degradation & High Latency',
    trigger: ['latency spike', 'slow response', 'database connection errors'],
    servicePattern: 'database',
    steps: [
      {
        id: 'query_metrics',
        name: 'Analyze System Latency',
        type: 'investigation',
        action: 'checkMonitoring',
        description: 'Examine latency and connection pool metrics.',
        requiresEvidenceType: 'MONITORING',
        status: 'PENDING',
      },
      {
        id: 'check_pagerduty',
        name: 'Inspect PagerDuty Alerts',
        type: 'investigation',
        action: 'checkPagerDuty',
        description: 'Retrieve linked PagerDuty incidents and escalation details.',
        requiresEvidenceType: 'PAGERDUTY',
        status: 'PENDING',
      },
      {
        id: 'create_jira_tracking',
        name: 'Track in Jira',
        type: 'investigation',
        action: 'createJira',
        description: 'Create or update Jira incident ticket for team visibility.',
        requiresEvidenceType: 'JIRA',
        status: 'PENDING',
      },
      {
        id: 'human_action_gate',
        name: 'Human Operational Action',
        type: 'human_decision',
        action: 'askHuman',
        description: 'Await human engineer decision and manual code/infra changes.',
        humanApprovalRequired: true,
        status: 'PENDING',
      },
      {
        id: 'verify_system_recovery',
        name: 'Confirm System Recovery',
        type: 'verification',
        action: 'verifyRecovery',
        description: 'Run independent verification checks.',
        status: 'PENDING',
      },
    ],
  },
];

export function evaluateRunbookProgress(
  state: IncidentState,
  customRunbook?: RunbookDefinition
): RunbookExecutionState {
  const runbook = customRunbook || DEFAULT_RUNBOOKS[0];
  const now = new Date().toISOString();
  const steps: RunbookStep[] = runbook.steps.map((s) => ({ ...s }));

  const hasWebsiteEvidence = state.evidence.some((e) => e.source === 'WEBSITE');
  const hasMonitoringEvidence = state.evidence.some((e) => e.source === 'MONITORING');
  const hasGitHubEvidence = state.evidence.some((e) => e.source === 'GITHUB');
  const hasPagerDutyEvidence = state.evidence.some((e) => e.source === 'PAGERDUTY');
  const hasJiraEvidence = state.evidence.some((e) => e.source === 'JIRA');
  const humanReportedChange = state.recovery?.humanReportedChange != null;
  const isRecovered = state.recovery?.state === 'RECOVERED';
  const isVerifying = state.recovery?.state === 'VERIFYING_RECOVERY';

  for (const step of steps) {
    if (step.action === 'checkWebsite' && step.id !== 'verify_recovery') {
      if (hasWebsiteEvidence) {
        step.status = 'COMPLETED';
      } else {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.action === 'checkMonitoring') {
      if (hasMonitoringEvidence) {
        step.status = 'COMPLETED';
      } else if (hasWebsiteEvidence) {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.action === 'checkGitHub') {
      if (hasGitHubEvidence) {
        step.status = 'COMPLETED';
      } else if (hasMonitoringEvidence) {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.action === 'checkPagerDuty') {
      if (hasPagerDutyEvidence) {
        step.status = 'COMPLETED';
      } else if (hasMonitoringEvidence) {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.action === 'createJira') {
      if (hasJiraEvidence) {
        step.status = 'COMPLETED';
      } else {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.type === 'human_decision') {
      if (humanReportedChange || isRecovered || isVerifying) {
        step.status = 'COMPLETED';
      } else if (hasWebsiteEvidence || hasMonitoringEvidence || hasGitHubEvidence) {
        step.status = 'IN_PROGRESS';
      }
    } else if (step.id === 'verify_recovery' || step.action === 'verifyRecovery') {
      if (isRecovered) {
        step.status = 'COMPLETED';
      } else if (isVerifying) {
        step.status = 'IN_PROGRESS';
      } else if (humanReportedChange) {
        step.status = 'IN_PROGRESS';
      } else {
        step.status = 'PENDING';
      }
    }
  }

  const activeStep = steps.find((s) => s.status === 'IN_PROGRESS') || steps.find((s) => s.status === 'PENDING') || steps[steps.length - 1];
  const remainingSteps = steps.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS');

  const activeStepName = activeStep ? activeStep.name : 'All steps completed';
  const whyPerformed = activeStep
    ? `Step '${activeStep.name}' is executing to fulfill operational runbook procedure for ${runbook.name}.`
    : 'Runbook steps fully evaluated.';
  const requiredEvidence = activeStep?.requiresEvidenceType
    ? `Requires ${activeStep.requiresEvidenceType} evidence.`
    : activeStep?.humanApprovalRequired
    ? 'Requires explicit human operational decision.'
    : 'Requires system health verification.';

  const overallStatus = isRecovered
    ? 'COMPLETED'
    : steps.some((s) => s.status === 'IN_PROGRESS')
    ? 'IN_PROGRESS'
    : 'IN_PROGRESS';

  return {
    runbookId: runbook.id,
    runbookName: runbook.name,
    activeStepId: activeStep ? activeStep.id : null,
    overallStatus,
    steps,
    startedAt: state.createdAt || now,
    updatedAt: now,
    aiExplanation: {
      activeStepName,
      whyPerformed,
      requiredEvidence,
      remainingStepsCount: remainingSteps.length,
      blockedOrSkippedSummary: steps.filter((s) => s.status === 'BLOCKED' || s.status === 'SKIPPED').map((s) => `${s.name}: ${s.status}`).join('; ') || 'None',
    },
  };
}
