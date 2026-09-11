// Comprehensive Multi-User Attribution and Participant Styling Test
import {
  extractSpeakerUid,
  normalizeTranscript,
  getMessageList,
  getCurrentInProgressMessage,
  isInternalSystemInstruction,
} from './lib/conversation';
import { DEFAULT_AGENT_UID } from './lib/agora';
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
} from './components/QuickstartTranscriptPanel';

interface RosterEntry {
  uid: string;
  name: string;
  role: string;
}

// Roster in the shared War Room with 3 human participants
const sharedRoster: RosterEntry[] = [
  { uid: '1001', name: 'Addy', role: 'Incident Commander' },
  { uid: '1002', name: 'Siddy', role: 'DevOps Lead' },
  { uid: '1003', name: 'Akki', role: 'Site Reliability Engineer' },
];

function resolveParticipant(
  message: TranscriptMessage,
  roster: RosterEntry[],
  agentUID: string = String(DEFAULT_AGENT_UID),
) {
  const agentUidStr = String(agentUID);
  const defaultAgentUidStr = String(DEFAULT_AGENT_UID);

  const speakerUid = (
    message.speakerUid !== undefined
      ? String(message.speakerUid)
      : message.uid !== undefined
        ? String(message.uid)
        : ''
  ).trim();

  // 1. SRE-Zero (Agent)
  if (
    message.isAgent ||
    speakerUid === agentUidStr ||
    speakerUid === defaultAgentUidStr
  ) {
    return {
      name: 'SRE-Zero',
      role: 'AI Incident Commander',
      isAgent: true,
      speakerUid: agentUidStr,
    };
  }

  // 2. Exact match in shared room roster
  const found = roster.find((p) => String(p.uid).trim() === speakerUid);
  if (found) {
    return {
      name: found.name,
      role: found.role,
      isAgent: false,
      speakerUid,
    };
  }

  // 3. Defensive handling for unknown or unassigned UID
  if (!speakerUid || speakerUid === '0' || speakerUid === 'undefined' || speakerUid === 'null') {
    return {
      name: 'Unknown participant',
      role: 'Participant',
      isAgent: false,
      speakerUid: '0',
    };
  }

  // 4. Known Agora UID but not in local roster state yet
  return {
    name: `Unknown participant (${speakerUid})`,
    role: 'Participant',
    isAgent: false,
    speakerUid,
  };
}

console.log('====================================================');
console.log('MULTI-USER SPEAKER ATTRIBUTION & WHATSAPP DIFFERENTIATION TEST');
console.log('====================================================');

// Turn 1: Addy speaks
const addySpeech: TranscriptHelperItem<Partial<UserTranscription>> = {
  uid: '0',
  stream_id: 1001,
  turn_id: 1,
  _time: Date.now(),
  text: 'ADDY TEST: Payment API is throwing 500 errors.',
  status: TurnStatus.END,
  metadata: {
    object: MessageType.USER_TRANSCRIPTION,
    user_id: '1001',
    stream_id: 1001,
    turn_id: 1,
    text: 'ADDY TEST: Payment API is throwing 500 errors.',
  },
};

// Turn 2: Siddy speaks
const siddySpeech: TranscriptHelperItem<Partial<UserTranscription>> = {
  uid: '0',
  stream_id: 1002,
  turn_id: 2,
  _time: Date.now() + 1000,
  text: 'SIDDY TEST: Checked the load balancer; health checks failing.',
  status: TurnStatus.END,
  metadata: {
    object: MessageType.USER_TRANSCRIPTION,
    user_id: '1002',
    stream_id: 1002,
    turn_id: 2,
    text: 'SIDDY TEST: Checked the load balancer; health checks failing.',
  },
};

// Turn 3: Akki speaks
const akkiSpeech: TranscriptHelperItem<Partial<UserTranscription>> = {
  uid: '0',
  stream_id: 1003,
  turn_id: 3,
  _time: Date.now() + 2000,
  text: 'AKKI TEST: Database connection pool is maxed out.',
  status: TurnStatus.END,
  metadata: {
    object: MessageType.USER_TRANSCRIPTION,
    user_id: '1003',
    stream_id: 1003,
    turn_id: 3,
    text: 'AKKI TEST: Database connection pool is maxed out.',
  },
};

// Internal prompt injection that must be filtered out!
const internalPromptInjection: TranscriptHelperItem<Partial<AgentTranscription>> = {
  uid: '0',
  stream_id: 0,
  turn_id: 4,
  _time: Date.now() + 2500,
  text: 'Evaluate if there is an unresolved conflict, missing critical evidence...',
  status: TurnStatus.END,
  metadata: {
    object: MessageType.AGENT_TRANSCRIPTION,
    turn_id: 4,
    text: 'Evaluate if there is an unresolved conflict, missing critical evidence...',
    quiet: true,
  },
};

// Turn 5: SRE-Zero speaks
const sreZeroSpeech: TranscriptHelperItem<Partial<AgentTranscription>> = {
  uid: '123456',
  stream_id: 0,
  turn_id: 5,
  _time: Date.now() + 3000,
  text: 'SRE-ZERO: Root cause identified. Database connection pool exhaustion caused cascading 500s.',
  status: TurnStatus.END,
  metadata: {
    object: MessageType.AGENT_TRANSCRIPTION,
    user_id: '123456',
    turn_id: 5,
    text: 'SRE-ZERO: Root cause identified. Database connection pool exhaustion caused cascading 500s.',
  },
};

const rawEvents: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[] = [
  addySpeech,
  siddySpeech,
  akkiSpeech,
  internalPromptInjection,
  sreZeroSpeech,
];

// Browser A (Viewer: Addy, local client.uid = 1001)
const browserA_Normalized = normalizeTranscript(rawEvents, String(DEFAULT_AGENT_UID));
const browserA_Messages = getMessageList(browserA_Normalized, String(DEFAULT_AGENT_UID));

// Browser B (Viewer: Siddy, local client.uid = 1002)
const browserB_Normalized = normalizeTranscript(rawEvents, String(DEFAULT_AGENT_UID));
const browserB_Messages = getMessageList(browserB_Normalized, String(DEFAULT_AGENT_UID));

// Browser C (Viewer: Akki, local client.uid = 1003)
const browserC_Normalized = normalizeTranscript(rawEvents, String(DEFAULT_AGENT_UID));
const browserC_Messages = getMessageList(browserC_Normalized, String(DEFAULT_AGENT_UID));

console.log(`Total normalized messages rendered: ${browserA_Messages.length} (Expected: 4, internal prompt excluded)`);

let passed = true;

if (browserA_Messages.length !== 4) {
  console.error(`FAIL: Expected 4 messages, got ${browserA_Messages.length}. Internal prompt was not filtered!`);
  passed = false;
}

const renderForBrowser = (browserName: string, messages: typeof browserA_Messages) => {
  console.log(`\n--- ${browserName} ---`);
  return messages.map((msg) => {
    const p = resolveParticipant(msg, sharedRoster, String(DEFAULT_AGENT_UID));
    const theme = getParticipantColorTheme(p.speakerUid, p.isAgent);
    console.log(`[Turn ${msg.turn_id}] ${p.name} (${p.role}) [Theme: ${theme.name.split(' ')[0]}]`);
    console.log(`  "${msg.text}"`);
    return { name: p.name, role: p.role, text: msg.text, speakerUid: p.speakerUid, themeName: theme.name };
  });
};

const renderedA = renderForBrowser('BROWSER A (Viewer: Addy, UID 1001)', browserA_Messages);
const renderedB = renderForBrowser('BROWSER B (Viewer: Siddy, UID 1002)', browserB_Messages);
const renderedC = renderForBrowser('BROWSER C (Viewer: Akki, UID 1003)', browserC_Messages);

// Verification 1: Addy's message
if (renderedA[0].name !== 'Addy' || renderedB[0].name !== 'Addy' || renderedC[0].name !== 'Addy') {
  console.error('FAIL: Turn 1 did not render as Addy across all browsers!');
  passed = false;
}

// Verification 2: Siddy's message
if (renderedA[1].name !== 'Siddy' || renderedB[1].name !== 'Siddy' || renderedC[1].name !== 'Siddy') {
  console.error('FAIL: Turn 2 did not render as Siddy across all browsers!');
  passed = false;
}

// Verification 3: Akki's message
if (renderedA[2].name !== 'Akki' || renderedB[2].name !== 'Akki' || renderedC[2].name !== 'Akki') {
  console.error('FAIL: Turn 3 did not render as Akki across all browsers!');
  passed = false;
}

// Verification 4: SRE-Zero's message
if (renderedA[3].name !== 'SRE-Zero' || renderedB[3].name !== 'SRE-Zero' || renderedC[3].name !== 'SRE-Zero') {
  console.error('FAIL: Turn 4 did not render as SRE-Zero across all browsers!');
  passed = false;
}

// Verification 5: Color differentiation
const addyTheme = getParticipantColorTheme('1001', false);
const siddyTheme = getParticipantColorTheme('1002', false);
const akkiTheme = getParticipantColorTheme('1003', false);
const sreZeroTheme = getParticipantColorTheme('123456', true);

console.log('\n--- PARTICIPANT COLOR DIFFERENTIATION ---');
console.log('Addy Theme:', addyTheme.name);
console.log('Siddy Theme:', siddyTheme.name);
console.log('Akki Theme:', akkiTheme.name);
console.log('SRE-Zero Theme:', sreZeroTheme.name);

if (
  addyTheme.name === siddyTheme.name ||
  siddyTheme.name === akkiTheme.name ||
  addyTheme.name === akkiTheme.name
) {
  console.error('FAIL: Participants did not receive distinct color themes!');
  passed = false;
}

console.log('\n====================================================');
if (passed) {
  console.log('SUCCESS: Multi-user attribution, prompt filtering, and WhatsApp differentiation PASSED with 100% fidelity!');
} else {
  console.log('FAILURE: Tests failed.');
  process.exit(1);
}
console.log('====================================================');
