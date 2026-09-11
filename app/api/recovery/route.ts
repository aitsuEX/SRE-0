import { NextRequest, NextResponse } from 'next/server';
import { checkWebsite } from '@/lib/adapters/website';
import { checkMonitoring } from '@/lib/adapters/monitoring';
import { verifyRecovery } from '@/lib/incident/recovery';
import {
  getIncidentState,
  transitionRecoveryState,
  addIncidentTimeline,
  setAiPaused,
} from '@/lib/incident/state';
import type { RecoveryEvidenceSnapshot } from '@/lib/incident/types';

export const dynamic = 'force-dynamic';

function classifyVerification(verification: Awaited<ReturnType<typeof verifyRecovery>>): {
  finalState: 'RECOVERED' | 'STILL_IMPACTED' | 'VERIFICATION_UNKNOWN';
  verificationResult: 'HEALTHY' | 'STILL_IMPACTED' | 'UNKNOWN';
} {
  if (verification.resolved) return { finalState: 'RECOVERED', verificationResult: 'HEALTHY' };
  if (verification.checksAvailable > 0) return { finalState: 'STILL_IMPACTED', verificationResult: 'STILL_IMPACTED' };
  return { finalState: 'VERIFICATION_UNKNOWN', verificationResult: 'UNKNOWN' };
}


async function snapshot(): Promise<RecoveryEvidenceSnapshot> {
  const [website, monitoring] = await Promise.all([checkWebsite(), checkMonitoring('service_health')]);
  return {
    capturedAt: new Date().toISOString(),
    websiteStatus: (website as any)?.status ?? 'UNKNOWN',
    monitoringStatus: (monitoring as any)?.status ?? 'UNKNOWN',
    detail: JSON.stringify({ website, monitoring }).slice(0, 2000),
  };
}

// GET /api/recovery?channel=<id>  — current recovery state + history
export async function GET(request: NextRequest) {
  const channel = new URL(request.url).searchParams.get('channel') || 'default';
  const state = getIncidentState(channel);
  return NextResponse.json({ recovery: state.recovery, aiPaused: state.aiPaused });
}

// POST /api/recovery
// body: { channel, action: 'recommend_rollback' | 'reported_change' | 'other_options' | 'reverify', reportedBy?, description? }
//
// This is the human-in-the-loop recovery workflow (spec sections 14-16). SRE-Zero
// NEVER performs the underlying fix itself here — this endpoint only records human
// decisions/reports and runs independent, read-only verification. "Changed" never
// directly equals "Recovered": it always routes through VERIFYING_RECOVERY first.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const channel = body.channel || 'default';
  const action = body.action || (
    body.toState === 'ROLLBACK_RECOMMENDED' ? 'recommend_rollback' :
    body.toState === 'HUMAN_REPORTED_CHANGE' ? 'reported_change' :
    body.toState === 'OTHER_OPTIONS_REQUESTED' ? 'other_options' :
    body.toState === 'VERIFYING_RECOVERY' ? 'reverify' :
    body.toState === 'AWAITING_HUMAN_DECISION' ? 'resume' :
    body.action
  );

  if (action === 'recommend_rollback') {
    const before = await snapshot();
    const result = transitionRecoveryState(channel, 'AWAITING_HUMAN_DECISION', { before });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    addIncidentTimeline(channel, {
      type: 'rollback_recommended',
      description: 'SRE-Zero recommended rollback as one possible remediation option. This is a recommendation only — no action was taken. A human must decide.',
      actor: 'sre-zero',
      source: 'SYSTEM',
    });
    return NextResponse.json({ recovery: result.recovery });
  }

  if (action === 'reported_change') {
    const currentState = getIncidentState(channel);
    const before = currentState.recovery.before || await snapshot();
    const reportedBy = body.reportedBy || 'unknown';
    const description = body.description || 'Human reported a manual change without further detail.';
    const now = new Date().toISOString();
    const step1 = transitionRecoveryState(channel, 'HUMAN_REPORTED_CHANGE', {
      before,
      humanReportedChange: { reportedBy, description, reportedAt: now },
    });
    if (!step1.ok) return NextResponse.json({ error: step1.error }, { status: 409 });
    addIncidentTimeline(channel, {
      type: 'human_reported_change',
      description: `${reportedBy} reported making a manual change: "${description}". This means a change was reported, NOT that recovery is confirmed. Verification will now run independently.`,
      actor: reportedBy,
      source: 'HUMAN',
    });

    const step2 = transitionRecoveryState(channel, 'VERIFYING_RECOVERY');
    if (!step2.ok) return NextResponse.json({ error: step2.error }, { status: 409 });

    // Independent, read-only verification — SRE-Zero does not touch the system.
    const verification = await verifyRecovery(channel);
    const after = await snapshot();
    const { finalState, verificationResult } = classifyVerification(verification);

    const step3 = transitionRecoveryState(channel, finalState as any, { after, verificationResult: verificationResult as any });
    if (!step3.ok) return NextResponse.json({ error: step3.error }, { status: 409 });

    addIncidentTimeline(channel, {
      type: 'recovery_verification_completed',
      description: `Independent verification result: ${verificationResult}. This reflects actual checks performed after the human-reported change, not an assumption.`,
      actor: 'sre-zero',
      source: 'SYSTEM',
    });

    return NextResponse.json({ recovery: step3.recovery, verification });
  }

  if (action === 'other_options') {
    const result = transitionRecoveryState(channel, 'OTHER_OPTIONS_REQUESTED');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    addIncidentTimeline(channel, {
      type: 'other_options_requested',
      description: `${body.reportedBy || 'A human'} chose to look for other options instead of the recommended remediation.`,
      actor: body.reportedBy || 'human',
      source: 'HUMAN',
    });
    const waiting = transitionRecoveryState(channel, 'WAITING_FOR_COMMAND');
    // Enter real AI restraint: stop unnecessary voice responses until a new command wakes it.
    setAiPaused(channel, true);
    addIncidentTimeline(channel, {
      type: 'ai_entered_restraint',
      description: 'SRE-Zero will not proactively speak until a new command is issued (real server-side state, not just a UI flag).',
      actor: 'sre-zero',
      source: 'SYSTEM',
    });
    return NextResponse.json({ recovery: waiting.ok ? waiting.recovery : result.recovery });
  }

  if (action === 'reverify') {
    const step = transitionRecoveryState(channel, 'VERIFYING_RECOVERY');
    if (!step.ok) return NextResponse.json({ error: step.error }, { status: 409 });
    const verification = await verifyRecovery(channel);
    const after = await snapshot();
    const { finalState, verificationResult } = classifyVerification(verification);
    const result = transitionRecoveryState(channel, finalState as any, { after, verificationResult: verificationResult as any });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ recovery: result.recovery, verification });
  }

  if (action === 'resume') {
    // Explicit human command wakes SRE-Zero from OTHER_OPTIONS restraint.
    setAiPaused(channel, false);
    const result = transitionRecoveryState(channel, 'AWAITING_HUMAN_DECISION');
    addIncidentTimeline(channel, { type: 'ai_resumed', description: 'A new human command resumed SRE-Zero from restraint.', actor: body.reportedBy || 'human', source: 'HUMAN' });
    return NextResponse.json({ recovery: result.ok ? result.recovery : getIncidentState(channel).recovery, aiPaused: false });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
