import type { RTMClient } from 'agora-rtm';

export interface AgoraTokenData {
  token: string;
  uid: string;
  channel: string;
  agentId?: string;
}

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
  requester_name?: string;
  requester_role?: string;
}

export interface StopConversationRequest {
  agent_id: string;
}

export interface AgentResponse {
  agent_id: string;
  create_ts: number;
  state: string;
}

export interface AgoraRenewalTokens {
  rtcToken: string;
  rtmToken: string;
}

export interface ConversationComponentProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient | null;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
  onEndConversation: () => void;
  /** Fired after the browser has joined the RTC channel and published
   * its microphone track. The agent should only be started after this. */
  onRtcReady?: (uid: string) => void;
  roster?: Array<{ uid: string; name: string; role: string; joinedAt?: number }>;
  userInfo?: { name: string; role: string };
  onSpeakingChange?: (speakingUids: Set<string>) => void;
}

