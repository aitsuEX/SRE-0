'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, CheckCircle2, XCircle, Edit3 } from 'lucide-react';
import type { DecisionPacketRecord } from '@/lib/db/repository';

export function DecisionPacketPanel({ channel, currentUser }: { channel: string; currentUser: { name: string; role: string } }) {
  const [packets, setPackets] = useState<DecisionPacketRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchPackets = useCallback(async () => {
    try {
      const res = await fetch(`/api/decision-packets?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.packets) setPackets(data.packets);
      }
    } catch (e) {
      console.error('Failed to fetch decision packets:', e);
    }
  }, [channel]);

  useEffect(() => {
    fetchPackets();
    const interval = setInterval(fetchPackets, 4000);
    return () => clearInterval(interval);
  }, [fetchPackets]);

  const createDefaultPacket = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/decision-packets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          action: 'create',
          title: 'Remediation Decision Packet: Payment API High 5xx Error Rate',
          problem: 'Payment API experiencing 18.2% 5xx error rate following recent deployment v2.4.1.',
        }),
      });
      if (res.ok) fetchPackets();
    } catch (e) {
      console.error('Create packet error:', e);
    } finally {
      setLoading(false);
    }
  };

  const submitVerdict = async (packetId: string, verdict: 'APPROVE' | 'REJECT' | 'MODIFY' | 'DEFER' | 'UNKNOWN') => {
    setLoading(true);
    try {
      const res = await fetch('/api/decision-packets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          action: 'verdict',
          packetId,
          verdict,
          decidedBy: { name: currentUser.name, role: currentUser.role },
          rationale: `Human verdict ${verdict} submitted by ${currentUser.name} (${currentUser.role}).`,
        }),
      });
      if (res.ok) fetchPackets();
    } catch (e) {
      console.error('Submit verdict error:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <FileText className="w-5 h-5 text-primary" /> Structural Decision Packets & Human Verdicts
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            SRE-Zero presents options, risk, and evidence; explicit human verdict is mandatory.
          </p>
        </div>
        <button
          onClick={createDefaultPacket}
          disabled={loading}
          className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded hover:bg-primary/90 transition"
        >
          + Prepare Decision Packet
        </button>
      </div>

      {packets.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted-foreground font-mono">
          No active Decision Packets generated. Click above to prepare a Decision Packet for human review.
        </div>
      ) : (
        <div className="space-y-4">
          {packets.map((packet) => (
            <div key={packet.id} className="bg-background border border-border rounded-lg p-4 space-y-3 text-xs">
              <div className="flex items-start justify-between border-b border-border/50 pb-2">
                <div>
                  <h4 className="font-bold text-foreground text-sm">{packet.title}</h4>
                  <p className="text-muted-foreground text-xs">{packet.problem}</p>
                </div>
                <span
                  className={`font-mono text-[11px] font-bold px-2.5 py-0.5 rounded ${
                    packet.verdict === 'APPROVE'
                      ? 'bg-success/20 text-success-foreground'
                      : packet.verdict === 'REJECT'
                      ? 'bg-destructive/20 text-destructive'
                      : 'bg-amber-950/30 text-amber-400'
                  }`}
                >
                  {packet.verdict ? `VERDICT: ${packet.verdict}` : 'PENDING HUMAN VERDICT'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-muted/20 p-3 rounded font-mono">
                <div>
                  <strong className="text-foreground block">Confirmed Facts:</strong>
                  <ul className="list-disc list-inside text-muted-foreground">
                    {packet.confirmedFacts.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
                <div>
                  <strong className="text-foreground block">Supporting Evidence:</strong>
                  <ul className="list-disc list-inside text-muted-foreground">
                    {packet.supportingEvidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              </div>

              {/* Human Verdict Controls */}
              {packet.status === 'PENDING' ? (
                <div className="border-t border-border/40 pt-3 space-y-2">
                  <span className="font-semibold text-foreground block text-xs">Human Commander Verdict Required:</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => submitVerdict(packet.id, 'APPROVE')}
                      disabled={loading}
                      className="bg-emerald-600 text-white font-semibold px-3 py-1.5 rounded flex items-center gap-1 hover:bg-emerald-700 transition"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> APPROVE
                    </button>
                    <button
                      onClick={() => submitVerdict(packet.id, 'REJECT')}
                      disabled={loading}
                      className="bg-destructive text-white font-semibold px-3 py-1.5 rounded flex items-center gap-1 hover:bg-destructive/80 transition"
                    >
                      <XCircle className="w-3.5 h-3.5" /> REJECT
                    </button>
                    <button
                      onClick={() => submitVerdict(packet.id, 'MODIFY')}
                      disabled={loading}
                      className="bg-secondary text-secondary-foreground font-semibold px-3 py-1.5 rounded flex items-center gap-1 hover:bg-secondary/80 transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> MODIFY
                    </button>
                    <button
                      onClick={() => submitVerdict(packet.id, 'DEFER')}
                      disabled={loading}
                      className="bg-muted text-muted-foreground font-semibold px-3 py-1.5 rounded hover:bg-muted/80 transition"
                    >
                      DEFER
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-border/40 pt-2 text-muted-foreground text-xs flex items-center justify-between">
                  <span>Decided by: <strong>{packet.decidedBy?.name}</strong> ({packet.decidedBy?.role})</span>
                  <span className="font-mono text-[10px]">{packet.decidedAt ? new Date(packet.decidedAt).toLocaleTimeString() : ''}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
