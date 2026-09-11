'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, CheckCircle2, RefreshCw, Ticket, Activity } from 'lucide-react';
import type { RecoveryState, RecoveryRecord } from '@/lib/incident/types';

export function RecoveryWorkflowPanel({ channel, currentUser }: { channel: string; currentUser: { name: string } }) {
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const [changeDescription, setChangeDescription] = useState<string>('Deploys v1.1.0-stable code fix to production.');
  const [jiraSummary, setJiraSummary] = useState<string>('Investigate Payment API High Error Rate Root Cause');
  const [loading, setLoading] = useState<boolean>(false);

  const fetchRecoveryState = useCallback(async () => {
    try {
      const res = await fetch(`/api/mcp?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = (await res.json()) as { recovery?: RecoveryRecord };
        if (data.recovery) {
          setRecovery(data.recovery);
        }
      }
    } catch (e) {
      console.error('Failed to fetch recovery state:', e);
    }
  }, [channel]);

  useEffect(() => {
    fetchRecoveryState();
    const interval = setInterval(fetchRecoveryState, 3000);
    return () => clearInterval(interval);
  }, [fetchRecoveryState]);

  const handleTransition = async (toState: RecoveryState, payload?: { description?: string; jiraSummary?: string }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          toState,
          reportedBy: currentUser.name,
          changeDescription: payload?.description || changeDescription,
          jiraSummary: payload?.jiraSummary || jiraSummary,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { recovery?: RecoveryRecord };
        if (data.recovery) setRecovery(data.recovery);
      }
    } catch (e) {
      console.error('Recovery transition error:', e);
    } finally {
      setLoading(false);
    }
  };

  const executeIndependentVerification = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          toState: 'VERIFYING_RECOVERY',
        }),
      });
      if (res.ok) {
        fetchRecoveryState();
      }
    } catch (e) {
      console.error('Verification error:', e);
    } finally {
      setLoading(false);
    }
  };

  const currentState = recovery?.state || 'INCIDENT_ACTIVE';

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-5">
      {/* Header & State Machine Badge */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <ShieldAlert className="w-5 h-5 text-primary" /> Human-in-the-Loop Recovery
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Zero automatic AI rollback. Humans perform changes; SRE-Zero independently verifies recovery.
          </p>
        </div>
        <span className="font-mono text-xs font-bold px-3 py-1 rounded bg-primary/20 text-primary border border-primary/30">
          {currentState}
        </span>
      </div>

      {/* State Action Controls */}
      <div className="bg-background/60 border border-border p-4 rounded-lg space-y-4 text-xs">
        <h4 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
          Operational Decision Controls:
        </h4>

        {currentState === 'INCIDENT_ACTIVE' && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTransition('ROLLBACK_RECOMMENDED')}
              disabled={loading}
              className="bg-amber-600 text-white font-semibold px-3 py-2 rounded flex items-center gap-1 hover:bg-amber-700 transition"
            >
              Recommend Rollback as Option
            </button>
            <button
              onClick={() => handleTransition('AWAITING_HUMAN_DECISION')}
              disabled={loading}
              className="bg-secondary text-secondary-foreground font-semibold px-3 py-2 rounded hover:bg-secondary/80 transition"
            >
              Await Human Decision
            </button>
          </div>
        )}

        {(currentState === 'ROLLBACK_RECOMMENDED' || currentState === 'AWAITING_HUMAN_DECISION' || currentState === 'STILL_IMPACTED') && (
          <div className="space-y-3">
            <div className="border-l-2 border-primary pl-3 space-y-2">
              <span className="font-semibold text-foreground block">Option 1: CHANGED (Human Manual System Fix)</span>
              <input
                type="text"
                value={changeDescription}
                onChange={(e) => setChangeDescription(e.target.value)}
                placeholder="Describe manual code/infra change performed..."
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
              />
              <button
                onClick={() => handleTransition('HUMAN_REPORTED_CHANGE', { description: changeDescription })}
                disabled={loading || !changeDescription.trim()}
                className="bg-emerald-600 text-white font-semibold px-4 py-1.5 rounded flex items-center gap-1 hover:bg-emerald-700 transition"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Report Change Complete (Trigger Verification)
              </button>
            </div>

            <div className="border-l-2 border-muted pl-3 space-y-2 pt-2 border-t border-border/50">
              <span className="font-semibold text-foreground block">Option 2: OTHER OPTIONS (Create Jira Ticket & Wait)</span>
              <input
                type="text"
                value={jiraSummary}
                onChange={(e) => setJiraSummary(e.target.value)}
                placeholder="Jira issue summary..."
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
              />
              <button
                onClick={() => handleTransition('OTHER_OPTIONS_REQUESTED', { jiraSummary })}
                disabled={loading}
                className="bg-secondary text-secondary-foreground font-semibold px-4 py-1.5 rounded flex items-center gap-1 hover:bg-secondary/80 transition"
              >
                <Ticket className="w-3.5 h-3.5" /> Create Jira & Enter WAITING_FOR_COMMAND
              </button>
            </div>
          </div>
        )}

        {currentState === 'HUMAN_REPORTED_CHANGE' && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Human reported manual change: <strong>&quot;{recovery?.humanReportedChange?.description}&quot;</strong>.
            </p>
            <button
              onClick={executeIndependentVerification}
              disabled={loading}
              className="bg-primary text-primary-foreground font-semibold px-4 py-2 rounded flex items-center gap-1.5 hover:bg-primary/90 transition shadow"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Run Independent AI Verification
            </button>
          </div>
        )}

        {currentState === 'WAITING_FOR_COMMAND' && (
          <div className="bg-amber-950/20 border border-amber-500/30 p-3 rounded text-amber-200 space-y-1">
            <span className="font-semibold block text-xs text-amber-400">SRE-Zero in WAITING_FOR_COMMAND State</span>
            <p className="text-xs">
              AI remains silent until explicitly instructed by a human commander.
            </p>
            <button
              onClick={() => handleTransition('AWAITING_HUMAN_DECISION')}
              className="bg-amber-600 text-white px-3 py-1 rounded font-semibold text-xs mt-2"
            >
              Resume Active Guidance
            </button>
          </div>
        )}
      </div>

      {/* Side-by-Side Before / After Evidence Comparison */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-primary" /> Before / After Independent Recovery Snapshots:
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* BEFORE Snapshot */}
          <div className="bg-background/80 border border-border p-3.5 rounded-lg space-y-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground block border-b border-border pb-1">
              BEFORE Human Remediation
            </span>
            {recovery?.before ? (
              <div className="space-y-1 font-mono text-[11px]">
                <div><span className="text-muted-foreground">Website HTTP:</span> <span className="text-foreground">{recovery.before.websiteStatus}</span></div>
                <div><span className="text-muted-foreground">Monitoring:</span> <span className="text-foreground">{recovery.before.monitoringStatus}</span></div>
                <div><span className="text-muted-foreground">Captured At:</span> <span className="text-foreground">{new Date(recovery.before.capturedAt).toLocaleTimeString()}</span></div>
                <div className="text-muted-foreground pt-1">{recovery.before.detail}</div>
              </div>
            ) : (
              <span className="text-muted-foreground italic block py-2">UNKNOWN (No before snapshot captured yet)</span>
            )}
          </div>

          {/* AFTER Snapshot */}
          <div className="bg-background/80 border border-border p-3.5 rounded-lg space-y-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground block border-b border-border pb-1">
              AFTER Human Remediation
            </span>
            {recovery?.after ? (
              <div className="space-y-1 font-mono text-[11px]">
                <div><span className="text-muted-foreground">Website HTTP:</span> <span className="text-foreground">{recovery.after.websiteStatus}</span></div>
                <div><span className="text-muted-foreground">Monitoring:</span> <span className="text-foreground">{recovery.after.monitoringStatus}</span></div>
                <div><span className="text-muted-foreground">Captured At:</span> <span className="text-foreground">{new Date(recovery.after.capturedAt).toLocaleTimeString()}</span></div>
                <div className="text-muted-foreground pt-1">{recovery.after.detail}</div>
              </div>
            ) : (
              <span className="text-muted-foreground italic block py-2">UNKNOWN (Pending independent verification)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
