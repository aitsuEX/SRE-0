import { NextRequest, NextResponse } from 'next/server';
import { getIncidentState, addRoomMessage, getRoomMessages } from '@/lib/room-registry';
import { addIncidentEvidence, persistIncidentState } from '@/lib/incident/state';
import { deriveMissingInformation, upsertHypothesis, detectConflicts } from '@/lib/incident/engines';
import { requestApproval } from '@/lib/incident/actions';
import { IncidentRepository, type IncidentMessageRecord } from '@/lib/db/repository';
import type { ActionItem, IncidentFact } from '@/lib/incident/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channel = searchParams.get('channel');
    const userUid = searchParams.get('userUid') || undefined;

    if (!channel) {
      return NextResponse.json({ error: 'channel is required' }, { status: 400 });
    }

    const cleanChannel = channel.trim();
    const repoMessages = await IncidentRepository.getMessages(cleanChannel, userUid);
    const roomMessages = getRoomMessages(cleanChannel);

    return NextResponse.json({ success: true, messages: repoMessages, roomMessages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error retrieving messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      channel,
      text,
      uid,
      name,
      role,
      scope = 'EVERYONE',
      recipientUid,
      recipientName,
      action = 'send',
      messageId,
    } = body as {
      channel?: string;
      text?: string;
      uid?: string | number;
      name?: string;
      role?: string;
      scope?: 'EVERYONE' | 'DIRECT';
      recipientUid?: string;
      recipientName?: string;
      action?: 'send' | 'share';
      messageId?: string;
    };

    if (!channel) {
      return NextResponse.json({ error: 'channel is required' }, { status: 400 });
    }

    const cleanChannel = channel.trim();
    const speakerName = name || 'Engineer';
    const speakerRole = role || 'Engineer';
    const speakerUid = String(uid || '0');
    const timestamp = new Date().toISOString();
    const state = getIncidentState(cleanChannel);

    // --- Action: Share direct message to incident ---
    if (action === 'share' && messageId) {
      const shared = await IncidentRepository.shareDirectMessageToIncident(
        cleanChannel,
        messageId,
        speakerName
      );
      if (!shared) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }

      // Add to incident evidence now that user explicitly shared it
      addIncidentEvidence(cleanChannel, {
        id: `shared-dm-${Date.now()}`,
        type: 'OBSERVATION',
        content: `[DIRECT CHAT SHARED BY ${speakerName}] ${shared.senderName} (${shared.senderRole}) -> ${shared.recipientName || 'Direct'}: "${shared.content}"`,
        confidence: 'CONFIRMED',
        source: 'HUMAN',
        actorId: shared.senderUid,
        actorName: shared.senderName,
        recordedAt: shared.timestamp,
      });

      return NextResponse.json({ success: true, sharedMessage: shared });
    }

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const cleanText = text.trim();
    const isDirect = scope === 'DIRECT';
    const sourceLabel = isDirect
      ? 'DIRECT_CHAT'
      : speakerUid === '0' || speakerName === 'SRE-Zero'
      ? 'SRE-ZERO'
      : 'CHAT_EVERYONE';

    // Store in persistent repository
    const msgRecord: IncidentMessageRecord = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel: cleanChannel,
      senderUid: speakerUid,
      senderName: speakerName,
      senderRole: speakerRole,
      recipientUid,
      recipientName,
      content: cleanText,
      source: sourceLabel,
      scope: isDirect ? 'DIRECT' : 'EVERYONE',
      sharedToIncident: false,
      timestamp,
    };

    await IncidentRepository.saveMessage(cleanChannel, msgRecord);

    // DIRECT MESSAGES ARE PRIVACY-PROTECTED:
    // They MUST NOT automatically become incident evidence or affect public state unless explicitly shared.
    if (isDirect) {
      return NextResponse.json({ success: true, message: msgRecord, isDirect: true });
    }

    // --- PUBLIC MESSAGE PROCESSING ---
    const lower = cleanText.toLowerCase();

    // 1. Rollback request gate
    if (/(?:prepare\s+(?:the\s+)?rollback|let's\s+roll\s*back|request\s+rollback|initiate\s+rollback|rollback\s+required|approve\s+rollback|start\s+rollback|rollback)/i.test(lower)) {
      const hasPending = state.approvals.some((a) => a.action.toLowerCase() === 'rollback' && a.status === 'pending');
      if (!hasPending) {
        const approvalReq = requestApproval(cleanChannel, 'rollback', 'main-branch', {}, cleanText, ['service disruption during rollout', 'potential data inconsistency']);
        if (!state.approvals.some((a) => a.id === approvalReq.id)) {
          state.approvals.push(approvalReq);
        }
      }
      const actionItem: ActionItem = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: cleanText,
        description: cleanText,
        owner: { uid: speakerUid, name: speakerName, role: speakerRole },
        status: 'OPEN',
        priority: 'CRITICAL',
        createdAt: timestamp,
        evidenceIds: [],
        source: speakerName,
      };
      state.actions.push(actionItem);
    }
    // 2. Action Items
    else if (/(?:i'll\s|i\s+will|let\s+me|please\s+check|investigate|assign\s+to|assigned\s+to|action:|task:|we\s+should|let's\s+check)/i.test(lower)) {
      const actionItem: ActionItem = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: cleanText,
        description: cleanText,
        owner: { uid: speakerUid, name: speakerName, role: speakerRole },
        status: 'OPEN',
        priority: 'HIGH',
        createdAt: timestamp,
        evidenceIds: [],
        source: speakerName,
      };
      state.actions.push(actionItem);
    }
    // 3. Hypotheses
    else if (/(?:maybe|suspect|hypothesis|could\s+be|might\s+be|theory|probably|caused\s+by|due\s+to|i\s+think|think|believe|guess|my\s+guess|seems\s+like|looks\s+like\s+it\s+could)/i.test(lower)) {
      upsertHypothesis(state, cleanText, [], 'PROPOSED');
      const fact: IncidentFact = {
        id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: cleanText,
        confidence: 'unverified',
        source: speakerName,
        type: 'hypothesis',
        timestamp,
      };
      if (!state.facts.some((f) => f.content.toLowerCase() === fact.content.toLowerCase())) {
        state.facts.push(fact);
      }
    }
    // 4. Decisions
    else if (/(?:we\s+decided|agreed\s+to|decision:|let's\s+proceed|approved\s+to|agreed\s+on)/i.test(lower)) {
      const decision: IncidentFact = {
        id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: cleanText,
        confidence: 'confirmed',
        source: speakerName,
        type: 'decision',
        timestamp,
      };
      if (!state.decisions.some((d) => d.content.toLowerCase() === decision.content.toLowerCase())) {
        state.decisions.push(decision);
      }
      if (!state.facts.some((f) => f.content.toLowerCase() === decision.content.toLowerCase())) {
        state.facts.push(decision);
      }
    }
    // 5. Facts / Observations
    else if (/(?:error|500|502|503|5xx|outage|down|failed|failing|failure|crash|overloaded|latency|cpu|unknown|confirmed|impact|elevated|healthy|looks\s+healthy|up|normal|ok|fine|running|operational|recovered)/i.test(lower)) {
      const isHealthyReport = /(?:healthy|looks\s+healthy|up|normal|ok|fine|running|operational|recovered)/i.test(lower);
      const fact: IncidentFact = {
        id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: cleanText,
        confidence: isHealthyReport ? 'likely' : 'unverified',
        source: speakerName,
        type: 'fact',
        timestamp,
      };
      if (!state.facts.some((f) => f.content.toLowerCase() === fact.content.toLowerCase())) {
        state.facts.push(fact);
      }
    }

    // Public message evidence
    const msgEvidence = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'OBSERVATION' as const,
      content: `${speakerName} (${speakerRole}): ${cleanText}`,
      confidence: 'UNVERIFIED' as const,
      source: 'HUMAN' as const,
      actorId: speakerUid,
      actorName: speakerName,
      recordedAt: timestamp,
    };
    if (!state.evidence.some((e) => e.content.toLowerCase() === msgEvidence.content.toLowerCase())) {
      state.evidence.push(msgEvidence);
    }

    const conflicts = detectConflicts(state.evidence);
    for (const c of conflicts) {
      if (!state.conflicts.some((x) => x.id === c.id || x.description === c.description)) {
        state.conflicts.push(c);
      }
    }

    state.missingInformation = deriveMissingInformation(state);
    if (state.phase === 'DETECTED' || !state.phase) {
      state.phase = 'INVESTIGATING';
    }
    state.updatedAt = timestamp;
    persistIncidentState(cleanChannel, state);

    const roomPayload = {
      id: msgRecord.id,
      turn_id: msgRecord.id,
      uid: Number(speakerUid) || 0,
      speakerUid,
      isAgent: false,
      text: cleanText,
      createdAt: Date.now(),
      status: 'END',
      isTextChat: true,
      name: speakerName,
      role: speakerRole,
    };
    addRoomMessage(cleanChannel, roomPayload);

    return NextResponse.json({
      success: true,
      message: msgRecord,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error processing message' },
      { status: 500 }
    );
  }
}
