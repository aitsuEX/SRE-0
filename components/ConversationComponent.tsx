'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AgoraRTC, {
  useRTCClient,
  useLocalMicrophoneTrack,
  useRemoteUsers,
  useClientEvent,
  useJoin,
  usePublish,
  RemoteUser,
  UID,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  MessageSalStatus,
  MessageType,
  TurnStatus,
  TranscriptHelperMode,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from 'agora-agent-client-toolkit';
import { AgentVisualizer } from 'agora-agent-uikit';
import { MicButtonWithVisualizer } from 'agora-agent-uikit/rtc';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import {
  extractSpeakerUid,
  getCurrentInProgressMessage,
  getMessageList,
  isInternalSystemInstruction,
  logSpeakerIdentityDebug,
  mapAgentVisualizerState,
  normalizeTimestampMs,
  normalizeTranscript,
} from '@/lib/conversation';
import { MicrophoneSelector } from './MicrophoneSelector';
import {
  getConversationIssueSeverity,
  type ConnectionIssue,
} from './ConversationErrorCard';
import { ConnectionStatusPanel } from './ConnectionStatusPanel';
import { QuickstartConversationLayout } from './QuickstartConversationLayout';
import {
  QuickstartPipelineMetrics,
  type QuickstartAgentMetric,
} from './QuickstartPipelineMetrics';
import { QuickstartTranscriptPanel, type TranscriptMessage } from './QuickstartTranscriptPanel';
import type { ConversationComponentProps } from '@/types/conversation';

// Cap the displayed issues list to avoid overwhelming the UI during a cascade of errors.
const MAX_CONNECTION_ISSUES = 6;

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

// Payload shape for signaling-level errors forwarded by the agent over RTM.
// The `module` field identifies which backend subsystem (LLM / ASR / TTS) raised the error.
type RtmMessageErrorPayload = {
  object: 'message.error';
  module?: string;
  code?: number;
  message?: string;
  send_ts?: number;
};

// Payload shape for SAL (Session Abstraction Layer) registration status messages.
// VP_REGISTER_FAIL and VP_REGISTER_DUPLICATE indicate RTM channel subscription problems.
type RtmSalStatusPayload = {
  object: 'message.sal_status';
  status?: string;
  timestamp?: number;
};

// Type guard for RTM signaling-level error payloads (object: 'message.error').
function isRtmMessageErrorPayload(
  value: unknown,
): value is RtmMessageErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.error'
  );
}

// Type guard for RTM SAL status payloads (object: 'message.sal_status').
function isRtmSalStatusPayload(value: unknown): value is RtmSalStatusPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.sal_status'
  );
}

export default function ConversationComponent({
  agoraData,
  rtmClient,
  onTokenWillExpire,
  onEndConversation,
  onRtcReady,
  roster = [],
  userInfo,
  onSpeakingChange,
}: ConversationComponentProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isEnabled, setIsEnabled] = useState(true);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [isConnectionDetailsOpen, setIsConnectionDetailsOpen] = useState(false);

  // Tracks granular RTC connection state for the status dot.
  // Agora states: DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | RECONNECTING
  const [connectionState, setConnectionState] = useState<string>('CONNECTING');
  const agentUID = String(DEFAULT_AGENT_UID);
  const [joinedUID, setJoinedUID] = useState<UID>(0);
  const [speakingUids, setSpeakingUids] = useState<Set<string>>(new Set());

  const [rawTranscript, setRawTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [textMessages, setTextMessages] = useState<TranscriptMessage[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<QuickstartAgentMetric[]>([]);
  const [connectionIssues, setConnectionIssues] = useState<ConnectionIssue[]>(
    [],
  );

  const [aiPaused, setAiPaused] = useState(false);

  const fetchPauseState = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai-pause?channel=${encodeURIComponent(agoraData.channel)}`);
      if (res.ok) {
        const data = await res.json();
        setAiPaused(Boolean(data.aiPaused));
      }
    } catch (e) {
      console.error('Error fetching AI pause state:', e);
    }
  }, [agoraData.channel]);

  useEffect(() => {
    fetchPauseState();
    const interval = setInterval(fetchPauseState, 3000);
    return () => clearInterval(interval);
  }, [fetchPauseState]);

  const toggleAiPause = async () => {
    const nextState = !aiPaused;
    setAiPaused(nextState);
    try {
      await fetch('/api/ai-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: agoraData.channel,
          paused: nextState,
          actor: userInfo?.name || 'human',
        }),
      });
    } catch (err) {
      console.error('Failed to toggle AI pause:', err);
    }
  };
  const addConnectionIssue = useCallback((issue: ConnectionIssue) => {
    setConnectionIssues((prev) => {
      const isDuplicate = prev.some(
        (x) =>
          x.agentUserId === issue.agentUserId &&
          x.code === issue.code &&
          x.message === issue.message &&
          Math.abs(x.timestamp - issue.timestamp) < 1500,
      );
      if (isDuplicate) return prev;
      return [issue, ...prev].slice(0, MAX_CONNECTION_ISSUES);
    });
  }, []);

  // StrictMode guard: delay `useJoin`'s ready flag until after the fake-unmount
  // cycle completes. React StrictMode fires cleanup synchronously before any
  // setTimeout callback, so the first (fake) mount's timeout is always cancelled.
  // Only the real second mount's timeout fires, meaning useJoin joins exactly once.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  const { isConnected: joinSuccess } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  // Create mic track only after the StrictMode fake-unmount cycle completes (isReady).
  // Passing `true` here creates two tracks in StrictMode — the first publishes, then
  // StrictMode cleanup closes it and the second takes over, causing a ~3s audio gap.
  // isReady uses the same setTimeout(fn,0) pattern as useJoin: StrictMode cleanup fires
  // synchronously before the timeout, so only the real second mount's timer fires.
  // Do NOT pass `isEnabled` — that ties track lifetime to mute state and breaks the Web Audio
  // graph inside MicButtonWithVisualizer. Mute uses track.setEnabled() only.
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);

  // ENABLE_AUDIO_PTS is a module-level SDK parameter (not on the client instance).
  // It must be set before publishing audio for transcript timing to be accurate.
  useEffect(() => {
    if (!client) return;
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.(
        'ENABLE_AUDIO_PTS',
        true,
      );
    } catch (error) {
      console.warn('Could not set ENABLE_AUDIO_PTS:', error);
    }
  }, [client]);

  // Track the auto-assigned RTC UID for token renewal and agent invite.
  useEffect(() => {
    if (joinSuccess && client) {
      const uid = client.uid;
      if (uid !== null && uid !== undefined) {
        setJoinedUID(uid);
      }
    }
  }, [joinSuccess, client]);

  // Initialize AgoraVoiceAI once the channel is joined.
  //
  // Gating on `isReady && joinSuccess` is critical for StrictMode safety:
  //   - `isReady` ensures we are past the initial fake-unmount cycle, so this
  //     effect only runs on the real mount (not the discarded fake one).
  //   - Once `isReady` is true, React does NOT double-invoke this effect for
  //     subsequent state changes (`joinSuccess` becoming true). That means
  //     AgoraVoiceAI.init() is called exactly once.
  useEffect(() => {
    if (!isReady || !joinSuccess) return;

    // If RTM failed to initialize, skip AgoraVoiceAI (transcript panel)
    // — the core RTC voice conversation still works without it.
    if (!rtmClient) return;

    let cancelled = false;

    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: true,
        });

        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              // Tear down only the instance created by this effect run.
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => {
          setRawTranscript([...t]);
        });
        // Agent state drives the visualizer, independent of RTC audio presence.
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) =>
          setAgentState(event.state),
        );
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => {
          setAgentMetrics((prev) => [...prev, metrics].slice(-8));
        });
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-message-error-${error.code}`,
            source: 'rtm',
            agentUserId,
            code: error.code,
            message: error.message,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // SAL status: capture raw RTM messages so message.sal_status surfaces even if higher-level events don't.
        ai.on(
          AgoraVoiceAIEvents.MESSAGE_SAL_STATUS,
          (agentUserId, salStatus) => {
            if (
              salStatus.status === MessageSalStatus.VP_REGISTER_FAIL ||
              salStatus.status === MessageSalStatus.VP_REGISTER_DUPLICATE
            ) {
              addConnectionIssue({
                id: `${Date.now()}-${agentUserId}-sal-${salStatus.status}`,
                source: 'rtm',
                agentUserId,
                code: salStatus.status,
                message: `SAL status: ${salStatus.status}`,
                timestamp: normalizeTimestampMs(salStatus.timestamp),
              });
            }
          },
        );
        // Agent error: capture raw RTM messages so message.error surfaces even if higher-level events don't.
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-agent-error-${error.code}`,
            source: 'agent',
            agentUserId,
            code: error.code,
            message: `${error.type}: ${error.message}`,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        // subscribeMessage binds the toolkit to both RTC stream messages and RTM payloads.
        ai.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.error('[AgoraVoiceAI] init failed:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  // Raw RTM parsing is kept as a fallback for signaling-level errors and SAL status.
  useEffect(() => {
    const handleRtmMessage = (event: {
      message: string | Uint8Array;
      publisher: string;
    }) => {
      const payloadText =
        typeof event.message === 'string'
          ? event.message
          : new TextDecoder().decode(event.message);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        return;
      }

      if (isRtmMessageErrorPayload(parsed)) {
        const p = parsed;
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-msg-error-${p.code ?? 'unknown'}`,
          source: 'rtm-signaling',
          agentUserId: event.publisher,
          code: p.code ?? 'unknown',
          message: `${p.module ?? 'unknown'}: ${p.message ?? 'Unknown signaling error'}`,
          timestamp: normalizeTimestampMs(p.send_ts ?? Date.now()),
        });
        return;
      }

      if (isRtmSalStatusPayload(parsed)) {
        const p = parsed;
        if (
          p.status === 'VP_REGISTER_FAIL' ||
          p.status === 'VP_REGISTER_DUPLICATE'
        ) {
          addConnectionIssue({
            id: `${Date.now()}-${event.publisher}-rtm-sal-${p.status}`,
            source: 'rtm-signaling',
            agentUserId: event.publisher,
            code: p.status,
            message: `SAL status: ${p.status}`,
            timestamp: normalizeTimestampMs(p.timestamp ?? Date.now()),
          });
        }
      }
    };

    if (!rtmClient) return;

    rtmClient.addEventListener('message', handleRtmMessage);
    return () => {
      rtmClient.removeEventListener('message', handleRtmMessage);
    };
  }, [rtmClient, addConnectionIssue]);

  const latestHumanSpeakerRef = useRef<string | null>(null);
  const [speakerMapState, setSpeakerMapState] = useState<Map<number | string, string>>(new Map());
  // Phase 2 debug tracing: log each raw transcript event's identity fields
  // exactly once (keyed by turn/stream id), gated by
  // NEXT_PUBLIC_DEBUG_TRANSCRIPT_IDENTITY. See lib/conversation.ts.
  const loggedIdentityKeysRef = useRef<Set<number | string>>(new Set());

  // Bind each turn to its speaker UID on arrival
  useEffect(() => {
    setSpeakerMapState((prevMap) => {
      let updated = false;
      const nextMap = new Map(prevMap);

      for (const item of rawTranscript) {
        const debugKey = item.turn_id ?? item.stream_id ?? JSON.stringify(item.metadata);
        if (!loggedIdentityKeysRef.current.has(debugKey)) {
          loggedIdentityKeysRef.current.add(debugKey);
          logSpeakerIdentityDebug(item);
        }

        if (isInternalSystemInstruction(item.text)) continue;
        const meta = item.metadata as any;
        if (meta?.quiet === true) continue;
        const isAgent =
          meta?.object === 'assistant.transcription' ||
          meta?.object === MessageType.AGENT_TRANSCRIPTION ||
          String(item.uid) === String(agentUID);

        const turnKey = item.turn_id ?? item.stream_id;
        if (turnKey === undefined || turnKey === null) continue;

        if (isAgent) {
          if (nextMap.get(turnKey) !== String(agentUID)) {
            nextMap.set(turnKey, String(agentUID));
            updated = true;
          }
        } else if (!nextMap.has(turnKey)) {
          const metaUid = (meta?.user_id ?? meta?.uid ?? meta?.speaker_uid ?? meta?.stream_id ?? item.stream_id);
          if (metaUid && String(metaUid) !== '0' && String(metaUid) !== 'undefined' && String(metaUid) !== String(agentUID)) {
            nextMap.set(turnKey, String(metaUid));
            updated = true;
          } else if (item.uid && item.uid !== '0' && item.uid !== 'undefined' && item.uid !== String(agentUID)) {
            nextMap.set(turnKey, String(item.uid));
            updated = true;
          } else if (latestHumanSpeakerRef.current && latestHumanSpeakerRef.current !== String(agentUID)) {
            nextMap.set(turnKey, latestHumanSpeakerRef.current);
            updated = true;
          }
        }
      }
      return updated ? nextMap : prevMap;
    });
  }, [rawTranscript, agentUID]);

  const processedSpokenTurnsRef = useRef<Set<string | number>>(new Set());

  // Sync completed spoken transcript turns to backend incident state
  useEffect(() => {
    if (!agoraData.channel) return;
    for (const item of rawTranscript) {
      if (!item.text || !item.text.trim()) continue;
      if (isInternalSystemInstruction(item.text)) continue;
      const meta = item.metadata as any;
      if (meta?.quiet === true) continue;

      const isDone =
        item.status === TurnStatus.END ||
        item.status === ('END' as unknown as TurnStatus) ||
        item.status === TurnStatus.INTERRUPTED ||
        item.status === ('INTERRUPTED' as unknown as TurnStatus);

      if (!isDone) continue;

      const turnKey = item.turn_id ?? item.stream_id;
      if (turnKey === undefined || turnKey === null) continue;
      if (processedSpokenTurnsRef.current.has(turnKey)) continue;

      processedSpokenTurnsRef.current.add(turnKey);

      const { speakerUid, isAgent } = extractSpeakerUid(item, agentUID);
      let speakerName = 'Engineer';
      let speakerRole = 'Engineer';

      if (isAgent) {
        speakerName = 'SRE-Zero';
        speakerRole = 'AI Incident Commander';
      } else {
        const match = roster.find((p) => String(p.uid) === String(speakerUid));
        if (match) {
          speakerName = match.name;
          speakerRole = match.role;
        } else if (
          String(speakerUid) === String(client?.uid) ||
          String(speakerUid) === String(joinedUID) ||
          String(speakerUid) === '0'
        ) {
          speakerName = userInfo?.name || 'Engineer';
          speakerRole = userInfo?.role || 'Engineer';
        }
      }

      fetch('/api/incident-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: agoraData.channel,
          text: item.text.trim(),
          uid: isAgent ? agentUID : speakerUid,
          name: speakerName,
          role: speakerRole,
        }),
      }).catch((err) => {
        console.warn('Failed to sync spoken transcript turn to incident state:', err);
      });
    }
  }, [rawTranscript, agoraData.channel, agentUID, roster, client?.uid, joinedUID, userInfo]);

  // Fetch existing chat history from incident-message API on room join/reconnect
  useEffect(() => {
    if (!agoraData.channel) return;
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const resp = await fetch(`/api/incident-message?channel=${encodeURIComponent(agoraData.channel)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.messages && Array.isArray(data.messages) && !cancelled) {
            setTextMessages((prev) => {
              const existingIds = new Set(prev.map((m) => String(m.turn_id)));
              const incoming = data.messages.filter((m: TranscriptMessage) => !existingIds.has(String(m.turn_id)));
              if (incoming.length === 0) return prev;
              return [...prev, ...incoming].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            });
          }
        }
      } catch (err) {
        console.warn('Failed to fetch incident message history:', err);
      }
    };
    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [agoraData.channel]);

  // Preserve real speaker Agora UIDs across all turns without remapping to local viewer UID.
  // Normalizes spacing and ensures multi-user speaker identity is preserved.
  const transcript = useMemo(() => {
    return normalizeTranscript(rawTranscript, agentUID, speakerMapState);
  }, [rawTranscript, agentUID, speakerMapState]);

  // Completed (END + INTERRUPTED) messages shown as history.
  // INTERRUPTED must be included — if the agent's first turn is cut off,
  // messageList stays empty and the first interrupted turn is never shown.
  const messageList = useMemo(() => {
    const voiceMessages = getMessageList(transcript, agentUID);
    if (textMessages.length === 0) return voiceMessages;
    return [...voiceMessages, ...textMessages].sort((a, b) => {
      const timeA = a.createdAt || 0;
      const timeB = b.createdAt || 0;
      return timeA - timeB;
    });
  }, [transcript, agentUID, textMessages]);

  const currentInProgressMessage = useMemo(() => {
    // The live partial turn renders separately from the completed history list.
    return getCurrentInProgressMessage(transcript, agentUID);
  }, [transcript, agentUID]);

  // Publish local mic once the track exists; usePublish waits for RTC connection.
  usePublish([localMicrophoneTrack]);

  // ── Notify parent that RTC is ready (joined + mic published) ──
  // The agent must not be started until after the browser has:
  //   1. Requested microphone permission
  //   2. Joined the Agora RTC channel
  //   3. Published the microphone track
  // This effect fires onRtcReady exactly once when both conditions are met.
  const rtcReadyFired = useRef(false);
  useEffect(() => {
    if (joinSuccess && localMicrophoneTrack && !rtcReadyFired.current) {
      rtcReadyFired.current = true;
      const uid = client?.uid;
      if (uid !== null && uid !== undefined) {
        onRtcReady?.(String(uid));
      }
    }
  }, [joinSuccess, localMicrophoneTrack, client, onRtcReady]);

  // ── Browser autoplay policy: unlock audio on first user gesture ──
  // Chrome blocks audio playback until the user interacts with the page.
  // The "Create War Room" button click counts as a gesture, but if there's
  // a delay before the agent's first audio arrives, the AudioContext may
  // be suspended. This creates a silent dummy oscillator on join to unlock
  // the Web Audio graph, then immediately stops it.
  useEffect(() => {
    if (!joinSuccess || !client) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0; // silent
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.01);
      // Close after a tick to free the context
      setTimeout(() => ctx.close().catch(() => {}), 100);
    } catch {
      // ignore — not all browsers support this
    }
  }, [joinSuccess, client]);

  useClientEvent(client, 'user-joined', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(true);
  });

  useClientEvent(client, 'user-left', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(false);
  });

  // Sync isAgentConnected with remoteUsers (covers cases where user-joined/left are missed)
  useEffect(() => {
    const isAgentInRemoteUsers = remoteUsers.some(
      (user) => user.uid.toString() === agentUID,
    );
    setIsAgentConnected(isAgentInRemoteUsers);
  }, [remoteUsers, agentUID]);

  useClientEvent(client, 'connection-state-change', (curState) => {
    setConnectionState(curState);
  });

  const connectionSeverity = useMemo<'normal' | 'warning' | 'error'>(() => {
    // RTC transport problems take precedence; otherwise derive severity from captured issues.
    if (
      connectionState === 'DISCONNECTED' ||
      connectionState === 'DISCONNECTING'
    ) {
      return 'error';
    }
    if (
      connectionState === 'CONNECTING' ||
      connectionState === 'RECONNECTING'
    ) {
      return 'warning';
    }
    if (connectionIssues.length === 0) {
      return 'normal';
    }
    return connectionIssues.some(
      (issue) => getConversationIssueSeverity(issue) === 'error',
    )
      ? 'error'
      : 'warning';
  }, [connectionState, connectionIssues]);

  const visualizerState = useMemo(
    () =>
      mapAgentVisualizerState(agentState, isAgentConnected, connectionState),
    [agentState, isAgentConnected, connectionState],
  );

  // ── Audio Volume Indicator & Speaker Tracking ──
  useEffect(() => {
    if (!client) return;
    try {
      client.enableAudioVolumeIndicator();
    } catch (e) {
      console.warn('Could not enable audio volume indicator:', e);
    }

    const handleVolumeIndicator = (volumes: Array<{ uid: UID; level: number }>) => {
      const active = new Set<string>();
      let topHumanUid: string | null = null;
      let topHumanLevel = 5;

      for (const v of volumes) {
        if (v.level > 5) {
          const uidStr = v.uid === 0 ? String(client.uid) : String(v.uid);
          active.add(uidStr);
          if (uidStr !== agentUID && uidStr !== String(DEFAULT_AGENT_UID) && v.level > topHumanLevel) {
            topHumanUid = uidStr;
            topHumanLevel = v.level;
          }
        }
      }
      if (topHumanUid) {
        latestHumanSpeakerRef.current = topHumanUid;
      }
      if (agentState === AgentState.SPEAKING || visualizerState === 'talking') {
        active.add(agentUID);
      }
      setSpeakingUids(active);
      onSpeakingChange?.(active);
    };

    client.on('volume-indicator', handleVolumeIndicator);
    return () => {
      client.off('volume-indicator', handleVolumeIndicator);
    };
  }, [client, agentState, visualizerState, agentUID, onSpeakingChange]);

  /**
   * Mute/unmute via track.setEnabled() only — usePublish owns publish state.
   * If we also unpublish in the toggle, usePublish and the button fight each other
   * and break the MicButtonWithVisualizer Web Audio graph.
   */
  const handleMicToggle = useCallback(async () => {
    const next = !isEnabled;
    const track = localMicrophoneTrack;
    if (!track) {
      setIsEnabled(next);
      return;
    }
    try {
      await track.setEnabled(next);
      setIsEnabled(next);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [isEnabled, localMicrophoneTrack]);

  const handleTokenWillExpire = useCallback(async () => {
    if (!onTokenWillExpire || !joinedUID) return;
    try {
      // RTC and RTM renew independently, but the quickstart fetches both in one request.
      const { rtcToken, rtmToken } = await onTokenWillExpire(
        joinedUID.toString(),
      );
      await client?.renewToken(rtcToken);
      if (rtmClient) {
        await rtmClient.renewToken(rtmToken);
      }
    } catch (error) {
      console.error('Failed to renew Agora token:', error);
    }
  }, [client, onTokenWillExpire, joinedUID, rtmClient]);

  // Listen for text chat messages over RTM
  useEffect(() => {
    if (!rtmClient) return;
    const handleRtmMessage = (event: { message?: string | Uint8Array; publisher?: string }) => {
      try {
        let raw = '';
        if (typeof event.message === 'string') {
          raw = event.message;
        } else if (event.message instanceof Uint8Array) {
          raw = new TextDecoder().decode(event.message);
        } else if (event.message && typeof event.message === 'object' && 'buffer' in (event.message as unknown as { buffer: unknown })) {
          raw = new TextDecoder().decode(event.message as unknown as Uint8Array);
        }
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data?.type === 'text_chat' && data.message) {
          setTextMessages((prev) => {
            if (prev.some((m) => String(m.turn_id) === String(data.message.turn_id))) {
              return prev;
            }
            return [...prev, data.message];
          });
        }
      } catch (err) {
        console.debug('Non-JSON or unhandled RTM message:', err);
      }
    };
    rtmClient.addEventListener('message', handleRtmMessage);
    return () => {
      rtmClient.removeEventListener('message', handleRtmMessage);
    };
  }, [rtmClient]);

  const handleSendMessage = useCallback(
    async (text: string, file?: File | null) => {
      const channel = agoraData.channel;
      const uid = joinedUID || agoraData.uid;
      const name = userInfo?.name || 'Engineer';
      const role = userInfo?.role || 'Engineer';
      const now = Date.now();

      setIsSendingMessage(true);
      try {
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('channel', channel);
          formData.append('uid', String(uid));
          formData.append('name', name);
          formData.append('role', role);
          await fetch('/api/attachments', {
            method: 'POST',
            body: formData,
          });
        }

        if (text.trim()) {
          const newMsg: TranscriptMessage = {
            turn_id: `text-${now}-${Math.random().toString(36).slice(2, 6)}`,
            uid: Number(uid) || 0,
            speakerUid: String(uid),
            isAgent: false,
            text: text.trim(),
            createdAt: now,
            status: 'END',
            isTextChat: true,
          };
          setTextMessages((prev) => [...prev, newMsg]);

          await fetch('/api/incident-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channel,
              text: text.trim(),
              uid: String(uid),
              name,
              role,
            }),
          });

          if (rtmClient) {
            try {
              await rtmClient.publish(
                channel,
                JSON.stringify({
                  type: 'text_chat',
                  message: newMsg,
                  name,
                  role,
                }),
                { channelType: 'MESSAGE', customType: 'text_chat' },
              );
            } catch (err) {
              console.warn('Failed to publish text chat over RTM:', err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to send text message or attachment:', err);
      } finally {
        setIsSendingMessage(false);
      }
    },
    [agoraData.channel, agoraData.uid, joinedUID, userInfo, rtmClient],
  );

  const handleEndConversation = useCallback(async () => {
    onEndConversation();
  }, [onEndConversation]);

  return (
    <QuickstartConversationLayout
      statusPanel={
        <ConnectionStatusPanel
          connectionState={connectionState}
          connectionSeverity={connectionSeverity}
          connectionIssues={connectionIssues}
          isOpen={isConnectionDetailsOpen}
          onToggle={() => setIsConnectionDetailsOpen((open) => !open)}
        />
      }
      pipelineMetrics={<QuickstartPipelineMetrics metrics={agentMetrics} />}
      transcriptPanel={
        <QuickstartTranscriptPanel
          messageList={messageList}
          currentInProgressMessage={currentInProgressMessage}
          agentUID={agentUID}
          roster={roster}
          userInfo={userInfo}
          speakingUids={speakingUids}
          onSendMessage={handleSendMessage}
          isSending={isSendingMessage}
        />
      }
      visualizer={
        <div
          className="relative flex h-full min-h-[20rem] w-full max-w-4xl items-center justify-center"
          role="region"
          aria-label="AI agent status visualization"
        >
          <AgentVisualizer state={visualizerState} size="lg" />
          {remoteUsers.map((user) => (
            <div key={user.uid} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
              <RemoteUser user={user} playAudio={true} />
            </div>
          ))}
        </div>
      }
      controls={
        <div
          className="mx-auto flex w-fit items-center gap-3 rounded-full border border-border bg-card/80 px-4 py-2 backdrop-blur-md shadow-lg"
          role="group"
          aria-label="Audio controls"
        >
          <div className="conversation-mic-host flex items-center justify-center">
            <MicButtonWithVisualizer
              isEnabled={isEnabled}
              setIsEnabled={setIsEnabled}
              track={localMicrophoneTrack}
              onToggle={handleMicToggle}
              className="overflow-visible"
              aria-label={isEnabled ? 'Mute microphone' : 'Unmute microphone'}
              enabledColor="hsl(var(--primary))"
              disabledColor="hsl(var(--destructive))"
            />
          </div>
          <MicrophoneSelector localMicrophoneTrack={localMicrophoneTrack} />
          <button
            type="button"
            onClick={toggleAiPause}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition ${
              aiPaused
                ? 'bg-amber-600 text-white shadow-md animate-pulse hover:bg-amber-700'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border'
            }`}
            title={
              aiPaused
                ? 'SRE-Zero AI speech is currently paused. Click to resume.'
                : 'Pause SRE-Zero unprompted speech while maintaining Agora audio connection and transcription.'
            }
          >
            <span className={`w-2 h-2 rounded-full ${aiPaused ? 'bg-amber-300' : 'bg-emerald-400'}`} />
            {aiPaused ? 'Resume SRE-Zero' : 'Pause SRE-Zero'}
          </button>
        </div>
      }
      onEndConversation={handleEndConversation}
    />
  );
}

