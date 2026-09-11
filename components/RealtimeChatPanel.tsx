'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Share2, Lock, Globe } from 'lucide-react';

interface ChatMsg {
  id: string;
  senderUid: string;
  senderName: string;
  senderRole: string;
  recipientUid?: string;
  recipientName?: string;
  content: string;
  source: string;
  scope: 'EVERYONE' | 'DIRECT';
  sharedToIncident: boolean;
  timestamp: string;
}

export function RealtimeChatPanel({ channel, currentUser }: { channel: string; currentUser: { uid: string; name: string; role: string } }) {
  const [activeTab, setActiveTab] = useState<'EVERYONE' | 'DIRECT'>('EVERYONE');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputText, setInputText] = useState('');
  const [recipientUid, setRecipientUid] = useState<string>('agent-007');
  const [recipientName, setRecipientName] = useState<string>('SRE-Zero Agent');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/incident-message?channel=${encodeURIComponent(channel)}&userUid=${encodeURIComponent(currentUser.uid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages) setMessages(data.messages);
      }
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    }
  }, [channel, currentUser.uid]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/incident-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          text: inputText.trim(),
          uid: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role,
          scope: activeTab,
          recipientUid: activeTab === 'DIRECT' ? recipientUid : undefined,
          recipientName: activeTab === 'DIRECT' ? recipientName : undefined,
        }),
      });

      if (res.ok) {
        setInputText('');
        fetchMessages();
      }
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setLoading(false);
    }
  };

  const shareWithIncident = async (msgId: string) => {
    try {
      const res = await fetch('/api/incident-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          action: 'share',
          messageId: msgId,
          name: currentUser.name,
        }),
      });
      if (res.ok) {
        fetchMessages();
      }
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  const filteredMessages = messages.filter((m) => {
    if (activeTab === 'EVERYONE') {
      return m.scope === 'EVERYONE' || m.sharedToIncident;
    }
    return m.scope === 'DIRECT';
  });

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-[520px] shadow-lg">
      {/* Header Tabs */}
      <div className="flex items-center border-b border-border bg-muted/20 px-4 py-3 justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('EVERYONE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === 'EVERYONE' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Globe className="w-3.5 h-3.5" /> EVERYONE (Public Incident)
          </button>
          <button
            onClick={() => setActiveTab('DIRECT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === 'DIRECT' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Lock className="w-3.5 h-3.5" /> DIRECT CHAT (Private)
          </button>
        </div>

        {activeTab === 'DIRECT' && (
          <div className="flex items-center gap-2">
            <select
              value={recipientUid}
              onChange={(e) => {
                const uid = e.target.value;
                setRecipientUid(uid);
                setRecipientName(uid === 'agent-007' ? 'SRE-Zero Agent' : 'Lead SRE');
              }}
              className="bg-background border border-border text-foreground text-[11px] rounded px-2 py-1 font-mono"
            >
              <option value="agent-007">To: SRE-Zero Agent</option>
              <option value="user-lead">To: Lead SRE</option>
            </select>
            <span className="text-[11px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1 font-mono">
              <Lock className="w-3 h-3" /> Communication Firewall Active
            </span>
          </div>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 font-sans text-xs">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs font-mono">
            No messages recorded in {activeTab} channel yet.
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg border space-y-1.5 ${
                msg.scope === 'DIRECT'
                  ? 'bg-amber-950/10 border-amber-500/30'
                  : msg.sharedToIncident
                  ? 'bg-emerald-950/10 border-emerald-500/30'
                  : 'bg-background/60 border-border/60'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-b border-border/30 pb-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">{msg.senderName}</span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{msg.senderRole}</span>
                  <span className="font-mono text-primary text-[10px]">
                    [{msg.sharedToIncident ? 'SHARED TO INCIDENT' : msg.source}]
                  </span>
                </div>
                <span className="font-mono text-[10px]">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>

              <p className="text-foreground text-sm font-normal leading-relaxed">{msg.content}</p>

              {/* Direct message share action */}
              {msg.scope === 'DIRECT' && !msg.sharedToIncident && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => shareWithIncident(msg.id)}
                    className="text-[11px] bg-primary/20 text-primary hover:bg-primary/30 px-2.5 py-1 rounded flex items-center gap-1 font-semibold transition"
                  >
                    <Share2 className="w-3 h-3" /> Share with Incident Evidence
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Message Input Form */}
      <form onSubmit={sendMessage} className="p-3 border-t border-border bg-muted/10 flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            activeTab === 'EVERYONE'
              ? 'Broadcast to Incident Team (Public)...'
              : `Send Private DM to ${recipientName}...`
          }
          className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
        />
        <button
          type="submit"
          disabled={loading || !inputText.trim()}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </form>
    </div>
  );
}
