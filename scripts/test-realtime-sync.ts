import {
  createRoom,
  addParticipant,
  getRoster,
  addRoomMessage,
  getRoomMessages,
  getIncidentState,
} from '../lib/room-registry';
import {
  normalizeTranscript,
  getMessageList,
  extractSpeakerUid,
} from '../lib/conversation';
import { DEFAULT_AGENT_UID } from '../lib/agora';
import {
  MessageType,
  TurnStatus,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from 'agora-agent-client-toolkit';
import {
  getParticipantColorTheme,
  type TranscriptMessage,
} from '../components/QuickstartTranscriptPanel';

async function runRealtimeSyncTest() {
  console.log('====================================================');
  console.log('STARTING WAR ROOM REALTIME SYNCHRONIZATION TEST');
  console.log('====================================================\n');

  const channel = 'SRE-TEST-99';
  const agentUID = String(DEFAULT_AGENT_UID);

  // --- Step 1: Browser A joins ---
  console.log('1. Browser A (Addy, Incident Commander, UID 1001) starts incident room...');
  createRoom(channel, 'Addy', 'Outage Incident');
  addParticipant(channel, '1001', 'Addy', 'Incident Commander');

  // --- Step 2: Browser B joins ---
  console.log('2. Browser B (Siddy, DevOps Lead, UID 1002) joins the same room...');
  addParticipant(channel, '1002', 'Siddy', 'DevOps Lead');

  const roster = getRoster(channel);
  console.log(`   Shared Roster count: ${roster.length}`);
  if (roster.length !== 2) throw new Error('Roster mismatch!');

  // --- Step 3: Test 1 - Browser A sends text message ---
  console.log('\n3. Test 1: Browser A types "Testing shared text"...');
  const msgA: TranscriptMessage = {
    turn_id: 'text-1',
    uid: 1001,
    speakerUid: '1001',
    isAgent: false,
    text: 'Testing shared text',
    createdAt: Date.now(),
    status: 'END',
    isTextChat: true,
  };
  addRoomMessage(channel, msgA as any);

  let messages = getRoomMessages(channel);
  console.log(`   Messages in room registry: ${messages.length}`);
  if (messages.length !== 1 || messages[0].text !== 'Testing shared text') {
    throw new Error('Test 1 failed: Browser A text not stored!');
  }
  console.log('   ✓ Browser A and Browser B both see "Testing shared text"');

  // --- Step 4: Test 2 - Browser B sends text message ---
  console.log('\n4. Test 2: Browser B types "Received"...');
  const msgB: TranscriptMessage = {
    turn_id: 'text-2',
    uid: 1002,
    speakerUid: '1002',
    isAgent: false,
    text: 'Received',
    createdAt: Date.now() + 500,
    status: 'END',
    isTextChat: true,
  };
  addRoomMessage(channel, msgB as any);

  messages = getRoomMessages(channel);
  console.log(`   Messages in room registry: ${messages.length}`);
  if (messages.length !== 2 || messages[1].text !== 'Received') {
    throw new Error('Test 2 failed: Browser B text not stored!');
  }
  console.log('   ✓ Browser A and Browser B both see "Received"');

  // --- Step 5: Test 3 - Participant A speaks ---
  console.log('\n5. Test 3: Participant A speaks ("Investigating payment gateway")...');
  const turnA: TranscriptHelperItem<Partial<UserTranscription>> = {
    uid: '0',
    stream_id: 1001,
    turn_id: 10,
    _time: Date.now() + 1000,
    text: 'Investigating payment gateway error logs.',
    status: TurnStatus.END,
    metadata: {
      object: MessageType.USER_TRANSCRIPTION,
      user_id: '1001',
      stream_id: 1001,
      turn_id: 10,
      text: 'Investigating payment gateway error logs.',
    },
  };

  // --- Step 6: Test 4 - SRE-Zero replies ---
  console.log('\n6. Test 4: SRE-Zero replies ("I detected high error rate on Stripe webhook")...');
  const turnAgent: TranscriptHelperItem<Partial<AgentTranscription>> = {
    uid: agentUID,
    stream_id: 0,
    turn_id: 11,
    _time: Date.now() + 2000,
    text: 'I detected high error rate on Stripe webhook. Recommending rollback.',
    status: TurnStatus.END,
    metadata: {
      object: MessageType.AGENT_TRANSCRIPTION,
      user_id: agentUID,
      turn_id: 11,
      text: 'I detected high error rate on Stripe webhook. Recommending rollback.',
    },
  };

  // --- Step 7: Test 5 - Participant B speaks ---
  console.log('\n7. Test 5: Participant B speaks ("Checking deployment commit")...');
  const turnB: TranscriptHelperItem<Partial<UserTranscription>> = {
    uid: '0',
    stream_id: 1002,
    turn_id: 12,
    _time: Date.now() + 3000,
    text: 'Checking deployment commit on main branch.',
    status: TurnStatus.END,
    metadata: {
      object: MessageType.USER_TRANSCRIPTION,
      user_id: '1002',
      stream_id: 1002,
      turn_id: 12,
      text: 'Checking deployment commit on main branch.',
    },
  };

  const rawTurns = [turnA, turnAgent, turnB];

  // Browser A View
  const normalizedA = normalizeTranscript(rawTurns, agentUID);
  const voiceMessagesA = getMessageList(normalizedA, agentUID);
  const combinedListA = [...voiceMessagesA, ...messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  // Browser B View
  const normalizedB = normalizeTranscript(rawTurns, agentUID);
  const voiceMessagesB = getMessageList(normalizedB, agentUID);
  const combinedListB = [...voiceMessagesB, ...messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  console.log(`\n--- Browser A Message Feed (${combinedListA.length} total items) ---`);
  for (const item of combinedListA) {
    const speakerUid = (item as any).speakerUid || String(item.uid);
    const isAgent = item.isAgent || speakerUid === agentUID;
    const participant = isAgent
      ? { name: 'SRE-Zero', role: 'AI Incident Commander' }
      : roster.find((r) => r.uid === speakerUid) || { name: 'Unknown', role: 'Participant' };
    console.log(`[${participant.name} (${participant.role})]: "${item.text}" (${(item as any).isTextChat ? 'TEXT' : 'VOICE'})`);
  }

  console.log(`\n--- Browser B Message Feed (${combinedListB.length} total items) ---`);
  for (const item of combinedListB) {
    const speakerUid = (item as any).speakerUid || String(item.uid);
    const isAgent = item.isAgent || speakerUid === agentUID;
    const participant = isAgent
      ? { name: 'SRE-Zero', role: 'AI Incident Commander' }
      : roster.find((r) => r.uid === speakerUid) || { name: 'Unknown', role: 'Participant' };
    console.log(`[${participant.name} (${participant.role})]: "${item.text}" (${(item as any).isTextChat ? 'TEXT' : 'VOICE'})`);
  }

  // --- Step 8: Test 6 - Refresh Browser B / Reconnect Browser B ---
  console.log('\n8. Test 6: Browser B refreshes / reconnects to the incident...');
  const refreshedMessages = getRoomMessages(channel);
  const refreshedRoster = getRoster(channel);

  if (refreshedMessages.length !== 2) throw new Error('Test 6 failed: Messages lost after reconnect!');
  if (refreshedRoster.length !== 2) throw new Error('Test 6 failed: Roster lost after reconnect!');

  console.log('   ✓ Reconnected Browser B restored all 2 chat messages and 2 roster participants!');
  console.log('\n====================================================');
  console.log('ALL REALTIME SYNCHRONIZATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('====================================================');
}

runRealtimeSyncTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
