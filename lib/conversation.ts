import {
  type AgentState,
  type AgentTranscription,
  MessageType,
  TurnStatus,
  type TranscriptHelperItem,
  type UserTranscription,
} from 'agora-agent-client-toolkit';
import {
  type AgentVisualizerState,
  type IMessageListItem,
} from 'agora-agent-uikit';
import { DEFAULT_AGENT_UID } from './agora';

// Fixes compacted punctuation emitted by some TTS/ASR providers where sentence-ending
// characters run directly into the next word (e.g. "Hello.World" → "Hello. World").
export function normalizeTranscriptSpacing(text: string): string {
  return text
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .replace(/,([A-Za-z])/g, ', $1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Agora timestamps vary by source: some RTM payloads use Unix-seconds while
// RTC events use milliseconds. Values already above 1e12 are milliseconds; others need scaling.
export function normalizeTimestampMs(timestamp: number): number {
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

// Detects and filters out internal proactive instructions injected during silence prompts.
export function isInternalSystemInstruction(text?: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return (
    t.includes('evaluate if there is an unresolved conflict') ||
    t.includes('silence_config') ||
    t.includes('remain completely silent and do not speak') ||
    t.includes('evaluate whether there is an unresolved conflict') ||
    t.startsWith('evaluate if there')
  );
}

// Maps the combined (agentState + RTC connection + agent presence) signal to the
// AgentVisualizer's display states. RTC transport problems take priority over
// agent-level state to avoid showing "listening" or "talking" during a reconnect.
export function mapAgentVisualizerState(
  agentState: AgentState | null,
  isAgentConnected: boolean,
  connectionState: string,
): AgentVisualizerState {
  if (
    connectionState === 'DISCONNECTED' ||
    connectionState === 'DISCONNECTING'
  ) {
    return 'disconnected';
  }

  if (
    connectionState === 'CONNECTING' ||
    connectionState === 'RECONNECTING'
  ) {
    return 'joining';
  }

  if (!isAgentConnected) {
    return 'not-joined';
  }

  switch (agentState) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'analyzing';
    case 'speaking':
      return 'talking';
    case 'idle':
    case 'silent':
    default:
      return 'ambient';
  }
}

// ── TEMPORARY: Phase 2 runtime identity tracing ─────────────────────────────
// Gated behind NEXT_PUBLIC_DEBUG_TRANSCRIPT_IDENTITY so it's a one-line opt-in
// during a live multi-participant test and silent otherwise. Logs only
// identity-relevant fields from the raw Agora transcript event — never the
// spoken text/content — so it's safe to leave enabled during a real test
// without capturing conversation content in the console/log drain.
// Remove this block once multi-user attribution is confirmed fixed on real
// devices (Phase 19 of the fix task).
export function logSpeakerIdentityDebug(
  item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>,
): void {
  if (
    typeof process === 'undefined' ||
    process.env.NEXT_PUBLIC_DEBUG_TRANSCRIPT_IDENTITY !== 'true'
  ) {
    return;
  }
  const meta = item.metadata as Record<string, unknown> | undefined;
  // eslint-disable-next-line no-console
  console.debug('[transcript-identity]', {
    event_object: meta?.object,
    item_uid: item.uid,
    item_stream_id: item.stream_id,
    turn_id: item.turn_id,
    status: item.status,
    meta_user_id: meta?.user_id,
    meta_uid: meta?.uid,
    meta_speaker_uid: meta?.speaker_uid ?? meta?.speakerUid,
    meta_stream_id: meta?.stream_id,
    meta_quiet: meta?.quiet,
    time: item._time,
  });
}

/**
 * Extracts the true Agora speaker UID from a transcript event.
 * Never defaults to the local browser user.
 */
export function extractSpeakerUid(
  item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>,
  agentUID: string = String(DEFAULT_AGENT_UID),
): { speakerUid: string; isAgent: boolean } {
  const meta = item.metadata as any;
  const agentUidStr = String(agentUID);

  const isAgent =
    meta?.object === 'assistant.transcription' ||
    meta?.object === MessageType.AGENT_TRANSCRIPTION ||
    String(item.uid) === agentUidStr ||
    String(meta?.user_id) === agentUidStr ||
    String(meta?.uid) === agentUidStr;

  if (isAgent) {
    return { speakerUid: agentUidStr, isAgent: true };
  }

  // 1. Check metadata.user_id (standard Agora ConvoAI user.transcription field)
  const metaUserId = meta?.user_id !== undefined ? String(meta.user_id).trim() : '';
  if (metaUserId && metaUserId !== '0' && metaUserId !== 'undefined' && metaUserId !== 'null') {
    return { speakerUid: metaUserId, isAgent: false };
  }

  // 2. Check metadata.uid
  const metaUid = meta?.uid !== undefined ? String(meta.uid).trim() : '';
  if (metaUid && metaUid !== '0' && metaUid !== 'undefined' && metaUid !== 'null') {
    return { speakerUid: metaUid, isAgent: false };
  }

  // 3. Check metadata.speaker_uid / speakerUid
  const metaSpeaker = (meta?.speaker_uid ?? meta?.speakerUid) !== undefined ? String(meta.speaker_uid ?? meta.speakerUid).trim() : '';
  if (metaSpeaker && metaSpeaker !== '0' && metaSpeaker !== 'undefined' && metaSpeaker !== 'null') {
    return { speakerUid: metaSpeaker, isAgent: false };
  }

  // 4. Check metadata.stream_id / item.stream_id (Agora RTC Stream ID is the publisher's RTC UID)
  const streamId = meta?.stream_id || item.stream_id;
  if (streamId && Number(streamId) > 0 && String(streamId) !== agentUidStr) {
    return { speakerUid: String(streamId), isAgent: false };
  }

  // 5. Check item.uid if non-zero
  const itemUid = item.uid !== undefined ? String(item.uid).trim() : '';
  if (itemUid && itemUid !== '0' && itemUid !== 'undefined' && itemUid !== 'null' && itemUid !== agentUidStr) {
    return { speakerUid: itemUid, isAgent: false };
  }

  return { speakerUid: itemUid || '0', isAgent: false };
}

export type NormalizedTranscriptItem = TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>> & {
  speakerUid: string;
  isAgent: boolean;
};

export type ExtendedMessageListItem = IMessageListItem & {
  speakerUid: string;
  isAgent: boolean;
};

// Adapts a toolkit TranscriptHelperItem to the shape expected by agora-agent-uikit and QuickstartTranscriptPanel.
export function toMessageListItem(
  item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>> & {
    speakerUid?: string;
    isAgent?: boolean;
  },
  agentUID: string = String(DEFAULT_AGENT_UID),
): ExtendedMessageListItem {
  const { speakerUid, isAgent } = item.speakerUid !== undefined
    ? { speakerUid: item.speakerUid, isAgent: !!item.isAgent }
    : extractSpeakerUid(item, agentUID);

  return {
    turn_id: item.turn_id,
    uid: Number(speakerUid) || 0,
    speakerUid,
    isAgent,
    text: typeof item.text === 'string' ? item.text : '',
    status: item.status as unknown as IMessageListItem['status'],
    createdAt:
      typeof item._time === 'number'
        ? normalizeTimestampMs(item._time)
        : undefined,
  };
}

// Preserves the real speaker Agora UID across all turns without remapping to local viewer UID.
// Filters out internal proactive instructions, and supports per-turn speaker overrides.
export function normalizeTranscript(
  transcript: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[],
  agentUID: string = String(DEFAULT_AGENT_UID),
  turnSpeakerOverrides?: Map<number | string, string>,
): NormalizedTranscriptItem[] {
  return transcript
    .filter((item) => {
      // Exclude internal prompt injections and quiet turns from transcript history
      if (isInternalSystemInstruction(item.text)) return false;
      const meta = item.metadata as any;
      if (meta?.quiet === true) return false;
      if (isInternalSystemInstruction(meta?.text)) return false;
      return true;
    })
    .map((item) => {
      let { speakerUid, isAgent } = extractSpeakerUid(item, agentUID);

      // If a per-turn speaker override was captured from RTC audio streams, apply it
      if (!isAgent && turnSpeakerOverrides) {
        const turnKey = item.turn_id ?? item.stream_id;
        const override = turnSpeakerOverrides.get(turnKey);
        if (override && override !== '0' && override !== String(agentUID)) {
          speakerUid = override;
        }
      }

      const normalizedText =
        typeof item.text === 'string'
          ? normalizeTranscriptSpacing(item.text)
          : (item.text || '');

      return {
        ...item,
        uid: speakerUid,
        speakerUid,
        isAgent,
        text: normalizedText,
      };
    });
}

// Returns completed and interrupted turns for the message history list.
export function getMessageList(
  transcript: NormalizedTranscriptItem[],
  agentUID: string = String(DEFAULT_AGENT_UID),
): ExtendedMessageListItem[] {
  return transcript
    .filter((item) => item.status !== TurnStatus.IN_PROGRESS)
    .map((item) => toMessageListItem(item, agentUID));
}

// Returns the single active in-progress turn, or null when none exists.
export function getCurrentInProgressMessage(
  transcript: NormalizedTranscriptItem[],
  agentUID: string = String(DEFAULT_AGENT_UID),
): ExtendedMessageListItem | null {
  const item = transcript.find((entry) => entry.status === TurnStatus.IN_PROGRESS);
  return item ? toMessageListItem(item, agentUID) : null;
}
