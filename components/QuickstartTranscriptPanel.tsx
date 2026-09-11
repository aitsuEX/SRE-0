'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { DEFAULT_AGENT_UID } from '@/lib/agora';

export type TranscriptMessage = {
  turn_id?: string | number;
  uid?: number;
  speakerUid?: string;
  isAgent?: boolean;
  text?: string;
  createdAt?: number;
  status?: string | number;
  isTextChat?: boolean;
};

type RosterItem = {
  uid: string;
  name: string;
  role: string;
};

export type QuickstartTranscriptPanelProps = {
  messageList: TranscriptMessage[];
  currentInProgressMessage: TranscriptMessage | null;
  agentUID: string;
  roster?: RosterItem[];
  userInfo?: { name: string; role: string };
  speakingUids?: Set<string>;
  onSendMessage?: (text: string, file?: File | null) => Promise<void> | void;
  isSending?: boolean;
};

function formatMessageTime(createdAt?: number) {
  if (!createdAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts[0].length >= 2) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0] || 'U').toUpperCase();
}

/**
 * Deterministic color palette for WhatsApp-style participant differentiation.
 * Hashed from participant UID so every participant has a stable, consistent
 * color theme across all browsers and renders.
 */
export function getParticipantColorTheme(uid: string, isAgent: boolean = false) {
  if (isAgent) {
    return {
      name: 'text-purple-600 dark:text-purple-400',
      badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
      border: 'border-l-purple-500',
      bg: 'bg-purple-500/[0.04]',
      avatar: 'bg-purple-600 text-white',
      initials: 'S0',
    };
  }

  const PALETTE = [
    {
      // 1. Burgundy / Rose
      name: 'text-rose-600 dark:text-rose-400',
      badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      border: 'border-l-rose-500',
      bg: 'bg-rose-500/[0.03]',
      avatar: 'bg-rose-600 text-white',
    },
    {
      // 2. Teal
      name: 'text-teal-600 dark:text-teal-400',
      badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
      border: 'border-l-teal-500',
      bg: 'bg-teal-500/[0.03]',
      avatar: 'bg-teal-600 text-white',
    },
    {
      // 3. Amber
      name: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      border: 'border-l-amber-500',
      bg: 'bg-amber-500/[0.03]',
      avatar: 'bg-amber-600 text-white',
    },
    {
      // 4. Indigo / Slate Blue
      name: 'text-indigo-600 dark:text-indigo-400',
      badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
      border: 'border-l-indigo-500',
      bg: 'bg-indigo-500/[0.03]',
      avatar: 'bg-indigo-600 text-white',
    },
    {
      // 5. Emerald / Forest
      name: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      border: 'border-l-emerald-500',
      bg: 'bg-emerald-500/[0.03]',
      avatar: 'bg-emerald-600 text-white',
    },
    {
      // 6. Cyan / Sky
      name: 'text-cyan-600 dark:text-cyan-400',
      badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
      border: 'border-l-cyan-500',
      bg: 'bg-cyan-500/[0.03]',
      avatar: 'bg-cyan-600 text-white',
    },
    {
      // 7. Orange / Ochre
      name: 'text-orange-600 dark:text-orange-400',
      badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
      border: 'border-l-orange-500',
      bg: 'bg-orange-500/[0.03]',
      avatar: 'bg-orange-600 text-white',
    },
    {
      // 8. Violet / Plum
      name: 'text-violet-600 dark:text-violet-400',
      badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
      border: 'border-l-violet-500',
      bg: 'bg-violet-500/[0.03]',
      avatar: 'bg-violet-600 text-white',
    },
  ];

  let hash = 0;
  const str = String(uid || '0');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}

export function QuickstartTranscriptPanel({
  messageList,
  currentInProgressMessage,
  agentUID,
  roster = [],
  speakingUids = new Set(),
  onSendMessage,
  isSending = false,
}: QuickstartTranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const messages = useMemo(
    () =>
      currentInProgressMessage
        ? [...messageList, currentInProgressMessage]
        : messageList,
    [currentInProgressMessage, messageList],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !selectedFile) || isSending) return;

    const textToSend = inputText;
    const fileToSend = selectedFile;
    setInputText('');
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (onSendMessage) {
      await onSendMessage(textToSend, fileToSend);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
  };

  const resolveParticipant = (message: TranscriptMessage) => {
    const agentUidStr = String(agentUID);
    const defaultAgentUidStr = String(DEFAULT_AGENT_UID);

    // Determine exact speaker identifier
    const speakerUid = (
      message.speakerUid !== undefined
        ? String(message.speakerUid)
        : message.uid !== undefined
          ? String(message.uid)
          : ''
    ).trim();

    // 1. SRE-Zero (AI Incident Commander)
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

    // 3. Defensive handling for unknown or unassigned UID (NEVER assign to local browser user!)
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
  };

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border bg-card/60"
      aria-label="Transcription panel"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="font-serif text-sm font-medium text-foreground">Transcript</h2>
          <p className="text-xs text-muted-foreground">Live voice & text turns</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Start speaking or type a message below.
          </div>
        ) : (
          messages.map((message, index) => {
            const isLatestInProgress =
              currentInProgressMessage && index === messages.length - 1;
            const { name, role, isAgent, speakerUid } = resolveParticipant(message);
            const isSpeaking =
              speakingUids.has(speakerUid) ||
              (message.uid !== undefined && speakingUids.has(String(message.uid)));
            const text = message.text?.trim();
            const time = formatMessageTime(message.createdAt);
            const theme = getParticipantColorTheme(speakerUid, isAgent);

            return (
              <article
                key={`${message.turn_id ?? message.uid ?? speakerUid}-${index}`}
                className="flex items-start gap-2.5 w-full"
              >
                {/* Participant Initials Avatar */}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tracking-wider shadow-xs ${
                    isAgent ? 'bg-purple-600 text-white' : theme.avatar
                  }`}
                  title={`${name} (${role})`}
                >
                  {isAgent ? 'S0' : getInitials(name)}
                </div>

                {/* Message Content Container */}
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-semibold ${theme.name}`}>
                      {name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {role}{time ? ` \u00B7 ${time}` : ''}
                      {message.isTextChat && (
                        <span className="ml-1.5 rounded-xs bg-muted px-1 py-0.2 text-[9px] uppercase tracking-wider text-muted-foreground">
                          Text
                        </span>
                      )}
                    </span>
                    {isSpeaking && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Speaking
                      </span>
                    )}
                  </div>
                  <div
                    className={`max-w-full whitespace-pre-wrap rounded-md border-l-2 border-y border-r px-3 py-2 text-sm leading-6 border-border ${
                      theme.border
                    } ${theme.bg} text-foreground ${
                      isLatestInProgress ? 'ring-1 ring-primary/30 border-primary/40' : ''
                    }`}
                  >
                    {text || '...'}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* ── Text Composer & File Attachment Dock ── */}
      {onSendMessage && (
        <form
          onSubmit={handleFormSubmit}
          className="shrink-0 border-t border-border bg-card p-3 space-y-2"
        >
          {/* Selected File Attachment Pill */}
          {selectedFile && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-sm">&#x1F4CE;</span>
                <span className="truncate font-medium">{selectedFile.name}</span>
                <span className="text-[10px] text-primary/70">({formatBytes(selectedFile.size)})</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="text-primary hover:text-primary/70 text-sm font-bold leading-none"
                title="Remove attachment"
              >
                &times;
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Hidden native file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              id="war-room-file-input"
            />

            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              title="Attach log or file"
              aria-label="Attach file"
            >
              <span className="text-base leading-none">&#x1F4CE;</span>
            </button>

            {/* Text Input Bar */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message..."
              disabled={isSending}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={(!inputText.trim() && !selectedFile) || isSending}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
