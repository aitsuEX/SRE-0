import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, addTimelineEvent } from '@/lib/room-registry';
import { persistIncidentState } from '@/lib/incident/state';

// POST /api/approvals  { id: string, decision: 'approved' | 'rejected', decidedBy?: string, channel?: string }
//
// Human-in-the-loop gate: The agent can only execute rollback with a matching approved request.
// Rejecting it (or leaving it pending) blocks execution.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, decision, decidedBy, channel } = body as {
      id?: string;
      decision?: 'approved' | 'rejected';
      decidedBy?: string;
      channel?: string;
    };

    if (!id || (decision !== 'approved' && decision !== 'rejected')) {
      return NextResponse.json(
        { error: 'id and decision ("approved" | "rejected") are required' },
        { status: 400 },
      );
    }

    const currentChannel = channel || 'default';
    const state = getIncidentState(currentChannel);
    const approval = state.approvals.find((a) => a.id === id);
    if (!approval) {
      return NextResponse.json({ error: `Approval ${id} not found` }, { status: 404 });
    }

    if (approval.expiresAt && Date.now() >= Date.parse(approval.expiresAt)) {
      approval.status = 'expired';
      state.updatedAt = new Date().toISOString();
      persistIncidentState(currentChannel, state);
      return NextResponse.json({ error: 'This approval has expired and cannot be decided.' }, { status: 409 });
    }

    approval.status = decision;
    approval.approvedAt = decision === 'approved' ? new Date().toISOString() : undefined;
    approval.decided_by = decidedBy || 'human (UI)';
    state.updatedAt = new Date().toISOString();
    persistIncidentState(currentChannel, state);

    addTimelineEvent(
      currentChannel,
      decision === 'approved' ? 'approval_granted' : 'approval_rejected',
      `${approval.action} was ${decision.toUpperCase()} by ${approval.decided_by}`,
      approval.decided_by,
    );

    // SRE-Zero never executes rollback/remediation itself. Approving a rollback
    // recommendation records the human's decision only; the human is expected to
    // perform the actual change outside this system and then report it (e.g. via
    // a "Changed" action), which is what should trigger independent verification.
    // We do NOT claim "rollback_executed" here, and we do NOT auto-verify recovery,
    // since nothing has actually changed yet at the moment of approval.
    let recoveryResult = null;
    if (decision === 'approved' && approval.action.toLowerCase() === 'rollback') {
      addTimelineEvent(
        currentChannel,
        'remediation_approved',
        `Rollback was APPROVED as the remediation to pursue under gate ${approval.id}${approval.target ? ` targeting ${approval.target}` : ''}. SRE-Zero has not executed anything; a human must perform the change and report it before recovery can be verified.`,
        approval.decided_by,
      );
    }

    return NextResponse.json({ ok: true, approval, recovery: recoveryResult });
  } catch (error) {
    console.error('Approvals API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

