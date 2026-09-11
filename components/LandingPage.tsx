'use client';

import { useState, useRef, Suspense, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { RTMClient } from 'agora-rtm';
import type {
  AgoraTokenData,
  ClientStartRequest,
  AgentResponse,
  AgoraRenewalTokens,
} from '../types/conversation';
import type { IncidentSummaryData } from '@/types/summary';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { ErrorBoundary } from './ErrorBoundary';
import { LoadingSkeleton } from './LoadingSkeleton';
import { OperationalHeatmap } from './OperationalHeatmap';
import { AdaptiveRunbookPanel } from './AdaptiveRunbookPanel';
import { RealtimeChatPanel } from './RealtimeChatPanel';
import { RecoveryWorkflowPanel } from './RecoveryWorkflowPanel';
import { IncidentTimeMachine } from './IncidentTimeMachine';
import { DecisionPacketPanel } from './DecisionPacketPanel';
import { FinalReportModal } from './FinalReportModal';

// Dynamically import the ConversationComponent with ssr disabled
const ConversationComponent = dynamic(() => import('./ConversationComponent'), {
  ssr: false,
});

// Dynamically import AgoraRTCProvider (browser-only).
const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } =
      await import('agora-rtc-react');
    return {
      default: function AgoraProviders({
        children,
      }: {
        children: React.ReactNode;
      }) {
        const clientRef = useRef<ReturnType<
          typeof AgoraRTC.createClient
        > | null>(null);
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({
            mode: 'rtc',
            codec: 'vp8',
          });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>
            {children}
          </AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

// ── Types ──────────────────────────────────────────────

interface IncidentFact {
  id: string;
  content: string;
  type: string;
  confidence: string;
  source: string;
  timestamp: string;
}

interface RosterParticipant {
  uid: string;
  name: string;
  role: string;
  joinedAt: number;
}

const ROLE_OPTIONS = ['Engineer', 'SRE', 'Support', 'Business', 'Manager'];

const ROLE_COLORS: Record<string, string> = {
  Engineer: 'bg-primary/15 text-primary',
  SRE: 'bg-success/15 text-success',
  Support: 'bg-warning/20 text-warning-foreground',
  Business: 'bg-accent/25 text-accent-foreground',
  Manager: 'bg-destructive/15 text-destructive',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Incident state sidebar component ─────────────────

function IncidentSidebar({ channel }: { channel: string }) {
  type State = { incident?:{name:string}; phase?:string; severity?:string; status?:string; evidence:any[]; facts:IncidentFact[]; hypotheses:any[]; conflicts:any[]; decisions:IncidentFact[]; actions:any[]; approvals:any[]; timeline:any[]; missingInformation:string[]; unresolvedRisks:string[]; config:any };
  const [state,setState]=useState<State>({evidence:[],facts:[],hypotheses:[],conflicts:[],decisions:[],actions:[],approvals:[],timeline:[],missingInformation:[],unresolvedRisks:[],config:null});
  const [decidingId,setDecidingId]=useState<string|null>(null);
  const fetchState=useCallback(async()=>{try{const r=await fetch(`/api/mcp?channel=${encodeURIComponent(channel)}`,{cache:'no-store'});if(r.ok)setState(await r.json());}catch{}},[channel]);
  useEffect(()=>{fetchState();const i=setInterval(fetchState,2000);return()=>clearInterval(i)},[fetchState]);
  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setDecidingId(id);
    try {
      const r = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, channel }),
      });
      if (r.ok) await fetchState();
    } finally {
      setDecidingId(null);
    }
  };
  const pending = (state.approvals || []).filter((a: any) => String(a.status || '').toLowerCase() === 'pending');



  // Each epistemic section gets a restrained semantic accent (a dot + a hairline
  // rule), never a colored card — the hierarchy comes from typography and color,
  // not decoration.
  const section = (title: string, items: any[], dotCls: string, empty: string) => (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
      </div>
      {items?.length ? (
        <div className="space-y-2.5">
          {items.slice(-6).reverse().map((x: any, idx: number) => {
            const owner = typeof x.owner === 'object' && x.owner ? x.owner.name : typeof x.owner === 'string' ? x.owner : '';
            const metaParts = [owner ? `Owner: ${owner}` : '', x.source, x.status, x.confidence].filter(Boolean);
            return (
              <div key={x.id || x.timestamp || idx} className="border-l border-sidebar-border pl-3">
                <p className="text-[13px] leading-snug text-sidebar-foreground">{x.content || x.description || x.title}</p>
                {metaParts.length > 0 && (
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/40">{metaParts.join(' · ')}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="pl-3 text-[13px] text-sidebar-foreground/35">{empty}</p>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground overflow-hidden">
      <div className="px-5 py-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between gap-2">
          <span className="font-serif text-[15px] font-medium leading-tight text-sidebar-foreground">{state.incident?.name || 'Incident'}</span>
          <span className="shrink-0 rounded-sm border border-sidebar-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">{state.phase || 'DETECTED'}</span>
        </div>
        <div className="mt-1.5 text-[11px] uppercase tracking-wide text-sidebar-foreground/45">Severity {state.severity || 'UNKNOWN'} &middot; {state.status || 'ACTIVE'}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {pending.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning">Approval required</span>
            </div>
            <div className="space-y-2">
              {pending.map((a: any) => (
                <div key={a.id} className="rounded-sm border border-warning/25 bg-warning/[0.07] p-2.5">
                  <p className="text-[13px] font-medium text-sidebar-foreground">{a.action}</p>
                  <p className="mt-0.5 text-[11px] text-sidebar-foreground/55">{a.reason}</p>
                  {a.target && <p className="text-[10px] text-sidebar-foreground/40">Target: {a.target}</p>}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => decide(a.id, 'approved')} disabled={decidingId === a.id} className="rounded-sm bg-success/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-success disabled:opacity-50">Approve</button>
                    <button onClick={() => decide(a.id, 'rejected')} disabled={decidingId === a.id} className="rounded-sm bg-destructive/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {section('Confirmed facts', state.facts.filter((f: IncidentFact) => !f.type || f.type === 'fact'), 'bg-success', 'No confirmed facts yet.')}
        {section('Hypotheses', state.hypotheses, 'bg-warning', 'No active hypotheses yet.')}
        {section('Missing information', state.missingInformation.map((x: string, i: number) => ({ id: `m-${i}`, content: x, status: 'UNKNOWN' })), 'bg-sidebar-foreground/30', 'No missing information identified.')}
        {section('Conflicts', state.conflicts, 'bg-destructive', 'No unresolved conflicts.')}
        {section('Decisions', state.decisions, 'bg-primary', 'No decisions recorded.')}
        {section('Actions', state.actions, 'bg-accent', 'No actions recorded.')}
        {state.evidence.length > 0 && section('Evidence', state.evidence, 'bg-sidebar-foreground/30', 'No evidence collected.')}
        {section('Timeline', state.timeline, 'bg-sidebar-foreground/30', 'No timeline events yet.')}
      </div>
    </div>
  );
}

// ── Prominent War Room Approval Gate Banner ─────────────────

function WarRoomApprovalBanner({
  channel,
  userName,
}: {
  channel: string;
  userName: string;
}) {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [recentDecisions, setRecentDecisions] = useState<Record<string, { status: 'executing' | 'executed' | 'rejected' | 'failed'; message: string; recovery?: any }>>({});

  const fetchApprovals = useCallback(async () => {
    try {
      const r = await fetch(`/api/mcp?channel=${encodeURIComponent(channel)}`, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        setApprovals(data.approvals || []);
      }
    } catch {}
  }, [channel]);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 1500);
    return () => clearInterval(interval);
  }, [fetchApprovals]);

  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    setDecidingId(id);
    setRecentDecisions((prev) => ({
      ...prev,
      [id]: {
        status: decision === 'approved' ? 'executing' : 'rejected',
        message: decision === 'approved'
          ? 'APPROVED — Executing rollback & running independent verification...'
          : 'REJECTED — Rollback blocked by human engineer.',
      },
    }));

    try {
      const r = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, decidedBy: userName || 'human (UI)', channel }),
      });
      const data = await r.json();
      if (r.ok) {
        setRecentDecisions((prev) => ({
          ...prev,
          [id]: {
            status: decision === 'approved' ? 'executed' : 'rejected',
            message: decision === 'approved'
              ? 'APPROVED & EXECUTED — Rollback completed. Independent recovery verification finished.'
              : 'REJECTED — Action blocked.',
            recovery: data.recovery,
          },
        }));
        await fetchApprovals();
      } else {
        setRecentDecisions((prev) => ({
          ...prev,
          [id]: {
            status: 'failed',
            message: `Approval failed: ${data.error || 'Server error'}`,
          },
        }));
      }
    } catch (err) {
      setRecentDecisions((prev) => ({
        ...prev,
        [id]: {
          status: 'failed',
          message: `Network error during approval: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      }));
    } finally {
      setDecidingId(null);
    }
  };

  const pendingApprovals = approvals.filter((a) => String(a.status || '').toLowerCase() === 'pending');
  const activeApprovalIds = Array.from(new Set([...pendingApprovals.map((a) => a.id), ...Object.keys(recentDecisions)]));

  if (activeApprovalIds.length === 0) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/[0.08] px-6 py-4 backdrop-blur-sm shadow-sm transition-all duration-300">
      <div className="space-y-3">
        {activeApprovalIds.map((id) => {
          const approval = approvals.find((a) => a.id === id) || { id, action: 'rollback', reason: 'Human intervention', status: 'pending' };
          const decisionInfo = recentDecisions[id];
          const isPending = String(approval.status || '').toLowerCase() === 'pending' && !decisionInfo;
          const isExecuting = decisionInfo?.status === 'executing' || decidingId === id;
          const isExecuted = decisionInfo?.status === 'executed' || approval.status === 'approved';
          const isRejected = decisionInfo?.status === 'rejected' || approval.status === 'rejected';

          return (
            <div
              key={id}
              className={`rounded-lg border p-4 transition-all duration-200 ${
                isPending
                  ? 'border-warning/50 bg-card shadow-md ring-1 ring-warning/30'
                  : isExecuting
                  ? 'border-primary/50 bg-card shadow-md ring-1 ring-primary/30'
                  : isExecuted
                  ? 'border-success/50 bg-card/80'
                  : 'border-destructive/50 bg-card/80'
              }`}
            >
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isPending
                        ? 'bg-warning animate-pulse'
                        : isExecuting
                        ? 'bg-primary animate-ping'
                        : isExecuted
                        ? 'bg-success'
                        : 'bg-destructive'
                    }`}
                  />
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">
                    CRITICAL ACTION REQUIRED — HUMAN APPROVAL GATE
                  </span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isPending
                      ? 'border border-warning/40 bg-warning/15 text-warning'
                      : isExecuting
                      ? 'border border-primary/40 bg-primary/15 text-primary'
                      : isExecuted
                      ? 'border border-success/40 bg-success/15 text-success'
                      : 'border border-destructive/40 bg-destructive/15 text-destructive'
                  }`}
                >
                  {isPending
                    ? 'Pending Human Approval'
                    : isExecuting
                    ? 'Executing…'
                    : isExecuted
                    ? 'Approved & Executed'
                    : 'Rejected'}
                </span>
              </div>

              {/* Body */}
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Action</p>
                  <p className="font-mono text-sm font-bold text-foreground uppercase">{approval.action}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</p>
                  <p className="text-xs text-foreground/90 leading-relaxed">{approval.reason || 'Incident mitigation'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target</p>
                  <p className="font-mono text-xs text-foreground/80">{approval.target || 'previous-release'}</p>
                </div>
              </div>

              {approval.risks && approval.risks.length > 0 && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-warning/90">Identified Risks:</span> {approval.risks.join(', ')}
                </div>
              )}

              {/* Status or Actions */}
              {isPending && (
                <div className="mt-4 flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-border/40">
                  <button
                    onClick={() => handleDecide(id, 'rejected')}
                    disabled={decidingId === id}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleDecide(id, 'approved')}
                    disabled={decidingId === id}
                    className="flex items-center gap-1.5 rounded-md bg-success px-5 py-2 text-xs font-bold uppercase tracking-wider text-success-foreground shadow-sm transition-colors hover:bg-success/90 disabled:opacity-50"
                  >
                    Approve Rollback
                  </button>
                </div>
              )}

              {(isExecuting || isExecuted || isRejected) && (
                <div className="mt-3 flex flex-col gap-1.5 rounded-md bg-muted/30 p-2.5 text-xs text-foreground/85 border border-border/40">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{decisionInfo?.message || (isExecuted ? 'Approved and executed.' : 'Rejected.')}</span>
                    {!isExecuting && (
                      <button
                        onClick={() => {
                          setRecentDecisions((prev) => {
                            const next = { ...prev };
                            delete next[id];
                            return next;
                          });
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline ml-2"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                  {decisionInfo?.recovery && (
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                      Recovery Checks: Website {decisionInfo.recovery.results?.[0]?.status || 'CHECKED'} &middot; Monitoring {decisionInfo.recovery.results?.[1]?.status || 'CHECKED'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pre-call screen: Start or Join incident ──────────

type PreCallMode = 'home' | 'start' | 'join';

function PreCallScreen({
  onStart,
  onJoin,
  isLoading,
  error,
}: {
  onStart: (name: string, role: string, incidentTitle: string) => void;
  onJoin: (name: string, role: string, roomCode: string) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [mode, setMode] = useState<PreCallMode>('home');
  const [name, setName] = useState('');
  const [role, setRole] = useState('Engineer');
  const [incidentTitle, setIncidentTitle] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const canStart = name.trim() && incidentTitle.trim() && !isLoading;
  const canJoin = name.trim() && roomCode.trim() && !isLoading;

  if (mode === 'home') {
    return (
      <div className="relative flex h-dvh min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
        {/* Ambient tone — a single restrained wash, not a neon glow */}
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full opacity-[0.10] blur-3xl"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)' }}
        />

        <div className="relative flex flex-col items-center gap-8 max-w-lg text-center px-6">
          <div className="flex flex-col items-center gap-5">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-card font-serif text-lg font-medium text-primary">
                S0
              </div>
            </div>
            <div>
              <h1 className="font-serif text-4xl font-medium tracking-tight text-foreground">SRE&#8288;-Zero</h1>
              <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Incident Commander</p>
            </div>
          </div>

          <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Brings a live voice war room to order. SRE-Zero listens alongside your
            team, separates fact from hypothesis, flags conflicting reports, and
            keeps a human in the loop before anything critical runs.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Real-time voice</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Conflict detection</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />Human approval gates</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-warning" />Live timeline</span>
          </div>

          {error && (
            <div className="w-full rounded-sm border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex w-full gap-3">
            <button
              onClick={() => setMode('start')}
              className="flex-1 rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start incident
            </button>
            <button
              onClick={() => setMode('join')}
              className="flex-1 rounded-md border border-border bg-card px-6 py-3 font-medium text-foreground transition-colors hover:bg-surface-elevated"
            >
              Join incident
            </button>
          </div>

          <p className="text-xs text-muted-foreground/70">
            Agora Conversational AI &middot; Deepgram &middot; OpenAI &middot; MiniMax
          </p>
        </div>
      </div>
    );
  }

  // Shared name + role form for both start and join
  return (
    <div className="flex h-dvh min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex w-full max-w-md flex-col gap-5 px-6">
        <button
          onClick={() => setMode('home')}
          className="self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-card font-serif text-sm font-medium text-primary">
            S0
          </div>
          <div>
            <h1 className="font-serif text-xl font-medium text-foreground">
              {mode === 'start' ? 'Start a new incident' : 'Join an incident room'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {mode === 'start'
                ? 'Creates a war room and brings SRE-Zero online'
                : 'Enter the room code shared by your incident commander'}
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-sm border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Name */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-md border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        {/* Role */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Your role</label>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  role === r
                    ? 'border border-primary/40 bg-primary/10 text-primary'
                    : 'border border-border bg-card text-muted-foreground hover:bg-surface-elevated'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Mode-specific field */}
        {mode === 'start' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Incident title</label>
            <input
              type="text"
              value={incidentTitle}
              onChange={(e) => setIncidentTitle(e.target.value)}
              placeholder="Enter incident title"
              className="w-full rounded-md border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Room code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              className="w-full rounded-md border border-border bg-card px-4 py-2.5 font-mono text-sm tracking-wider text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
          </div>
        )}

        <button
          onClick={() => {
            if (mode === 'start') {
              onStart(name.trim(), role, incidentTitle.trim());
            } else {
              onJoin(name.trim(), role, roomCode.trim());
            }
          }}
          disabled={mode === 'start' ? !canStart : !canJoin}
          className="rounded-md bg-primary px-8 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {isLoading ? 'Connecting…' : mode === 'start' ? 'Create war room' : 'Join war room'}
        </button>
      </div>
    </div>
  );
}

// ── Participants sidebar (live roster) ────────────────

function ParticipantsList({
  channel,
  agentActive,
  speakingUids,
  onRosterChange,
}: {
  channel: string;
  agentActive: boolean;
  speakingUids?: Set<string>;
  onRosterChange?: (roster: RosterParticipant[]) => void;
}) {
  const [roster, setRoster] = useState<RosterParticipant[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (!channel) return;
    const fetchRoster = async () => {
      try {
        const resp = await fetch(`/api/roster?channel=${encodeURIComponent(channel)}`);
        if (resp.ok) {
          const data = await resp.json();
          const list: RosterParticipant[] = data.participants || [];
          setRoster(list);
          setAgentId(data.agentId || null);
          onRosterChange?.(list);
        }
      } catch {}
    };
    fetchRoster();
    const interval = setInterval(fetchRoster, 3000);
    return () => clearInterval(interval);
  }, [channel, onRosterChange]);

  const totalOnline = roster.length + (agentActive ? 1 : 0);
  const isAgentSpeaking = speakingUids?.has(String(DEFAULT_AGENT_UID)) ?? false;

  return (
    <div className="mt-2 px-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
        <span>Participants &middot; {totalOnline}</span>
        <span className="flex items-center gap-1 text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />{totalOnline} online</span>
      </div>

      {/* SRE-Zero AI Agent */}
      {agentActive && (
        <div className="mb-1 flex items-center gap-2.5 rounded-md bg-sidebar-primary/15 py-2 px-2">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-sidebar-primary/40 bg-sidebar-primary/25 font-serif text-xs text-sidebar-primary-foreground">S0</div>
            <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar ${isAgentSpeaking ? 'bg-success animate-ping' : 'bg-success animate-calm-pulse'}`}></div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-sidebar-foreground">SRE-Zero</p>
              {isAgentSpeaking && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Speaking
                </span>
              )}
            </div>
            <p className="text-[10px] text-sidebar-foreground/50">AI Incident Commander &middot; {isAgentSpeaking ? 'Speaking' : 'Listening'}</p>
          </div>
          {agentId && (
            <span className="rounded-sm bg-success/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">Active</span>
          )}
        </div>
      )}

      {/* Human participants */}
      {roster.map((p) => {
        const isSpeaking = speakingUids?.has(String(p.uid)) ?? false;
        return (
          <div key={p.uid} className="mb-1 flex items-center gap-2.5 rounded-md py-2 px-2 hover:bg-sidebar-accent">
            <div className="relative">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${ROLE_COLORS[p.role] || 'bg-sidebar-foreground/15 text-sidebar-foreground'}`}>
                {getInitials(p.name)}
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar ${isSpeaking ? 'bg-success animate-ping' : 'bg-success'}`}></div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-sidebar-foreground">{p.name}</p>
                {isSpeaking && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    Speaking
                  </span>
                )}
              </div>
              <p className="text-[10px] text-sidebar-foreground/50">{p.role}</p>
            </div>
          </div>
        );
      })}

      {/* Invite hint */}
      <div className="flex items-center gap-2.5 rounded-md py-2 px-2 text-xs text-sidebar-foreground/35">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-sidebar-border text-sm">+</div>
        <span>Share room code to invite</span>
      </div>
    </div>
  );
}

// ── Incident Summary Modal ────────────────────────────

function SummaryModal({
  data,
  onClose,
  onRefresh,
  isRefreshing,
}: {
  data: IncidentSummaryData;
  onClose: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const [copiedReport, setCopiedReport] = useState(false);

  const fmtTime = (ts?: string) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  const statBlock = (value: number, label: string, colorCls: string) => (
    <div className="flex-1 min-w-[96px] border-r border-border/60 px-3 py-2 text-center last:border-r-0">
      <p className={`font-serif text-2xl font-medium ${colorCls}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );

  const totalFacts = data.summary?.totalFacts ?? data.facts?.length ?? 0;
  const totalHypotheses = data.summary?.totalHypotheses ?? data.hypotheses?.length ?? 0;
  const totalConflicts = data.summary?.totalConflicts ?? data.conflicts?.length ?? 0;
  const totalDecisions = data.summary?.totalDecisions ?? data.decisions?.length ?? 0;
  const totalActions = data.summary?.totalActions ?? data.actions?.length ?? 0;

  const reportSection = (title: string, dotCls: string, rows: { content: string; meta?: string; tone?: string }[]) =>
    rows.length > 0 && (
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="border-l border-border pl-3">
              <p className={r.tone || 'text-card-foreground'}>{r.content}</p>
              {r.meta && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">{r.meta}</p>}
            </div>
          ))}
        </div>
      </div>
    );

  const factsList = (data.facts || []).map((f) => ({
    content: f.content,
    meta: `${f.source || 'system'} · ${fmtTime(f.timestamp)}`,
  }));

  const hypothesesList = (data.hypotheses || []).map((h) => ({
    content: h.content,
    meta: `${h.confidence || 'unverified'} · ${h.source || 'engine'}`,
  }));

  const conflictsList = (data.conflicts || []).map((c) => ({
    content: c.description || c.content || 'Unspecified conflict',
    tone: 'text-destructive',
  }));

  const decisionsList = (data.decisions || []).map((d) => ({
    content: d.content,
    meta: d.source ? `${d.source} · ${fmtTime(d.timestamp)}` : undefined,
  }));

  const actionsList = (data.actions || []).map((a) => {
    const ownerName = typeof a.owner === 'object' && a.owner ? a.owner.name : typeof a.owner === 'string' ? a.owner : '';
    return {
      content: `${a.title || a.content || 'Action'}${ownerName ? ` (Owner: ${ownerName})` : ''}`,
      meta: a.status ? `Status: ${a.status}` : undefined,
    };
  });

  const handleCopyReport = async () => {
    const ts = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : new Date().toLocaleString();
    const lines: string[] = [
      `# Incident Postmortem & Summary Report`,
      `**Generated:** ${ts}`,
      `**Duration:** ${data.durationMinutes || 1} min(s)`,
      `**Status:** ${data.status || 'ACTIVE'}`,
      '',
      `## Summary Metrics`,
      `- Total Facts: ${totalFacts}`,
      `- Active Hypotheses: ${totalHypotheses}`,
      `- Detected Conflicts: ${totalConflicts}`,
      `- Decisions Recorded: ${totalDecisions}`,
      `- Action Items: ${totalActions}`,
      '',
    ];

    if (data.participants && data.participants.length > 0) {
      lines.push('## Participants');
      data.participants.forEach((p) => {
        lines.push(`- **${p.name}** (${p.role})`);
      });
      if (data.agentActive) {
        lines.push(`- **SRE-Zero** (AI Incident Commander)`);
      }
      lines.push('');
    }

    if (data.facts && data.facts.length > 0) {
      lines.push('## Confirmed Facts');
      data.facts.forEach((f) => {
        lines.push(`- ${f.content} *(Source: ${f.source || 'system'}, ${fmtTime(f.timestamp)})*`);
      });
      lines.push('');
    }

    if (data.hypotheses && data.hypotheses.length > 0) {
      lines.push('## Hypotheses');
      data.hypotheses.forEach((h) => {
        lines.push(`- ${h.content} *(Confidence: ${h.confidence || 'unverified'}, Source: ${h.source || 'engine'})*`);
      });
      lines.push('');
    }

    if (data.conflicts && data.conflicts.length > 0) {
      lines.push('## Conflicts Detected');
      data.conflicts.forEach((c) => {
        lines.push(`- ⚠️ ${c.description || c.content || 'Unspecified conflict'}`);
      });
      lines.push('');
    }

    if (data.decisions && data.decisions.length > 0) {
      lines.push('## Decisions');
      data.decisions.forEach((d) => {
        lines.push(`- ${d.content} *(Decided by: ${d.source || 'team'})*`);
      });
      lines.push('');
    }

    if (data.actions && data.actions.length > 0) {
      lines.push('## Action Items');
      data.actions.forEach((a) => {
        const owner = typeof a.owner === 'object' && a.owner ? a.owner.name : typeof a.owner === 'string' ? a.owner : 'Unassigned';
        lines.push(`- [ ] ${a.title || a.content || 'Action'} *(Owner: ${owner}, Status: ${a.status || 'OPEN'})*`);
      });
      lines.push('');
    }

    if (data.approvals && data.approvals.length > 0) {
      lines.push('## Approvals & Critical Gates');
      data.approvals.forEach((ap) => {
        lines.push(`- **${ap.action}**: ${ap.status.toUpperCase()} *(Reason: ${ap.reason})*`);
      });
      lines.push('');
    }

    if (data.timeline && data.timeline.length > 0) {
      lines.push('## Incident Timeline');
      data.timeline.forEach((t) => {
        lines.push(`- **${fmtTime(t.timestamp)}** [${t.actor || 'sre-zero'}]: ${t.description}`);
      });
      lines.push('');
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch (err) {
      console.error('Failed to copy markdown report:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto rounded-md border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="font-serif text-lg font-medium text-card-foreground">Incident Summary</h2>
            <p className="text-xs text-muted-foreground">
              Generated {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'Just now'} &middot; {data.durationMinutes || 1}m duration &middot; Status: {data.status || 'ACTIVE'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground disabled:opacity-50"
                title="Refresh incident summary"
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            <button
              onClick={handleCopyReport}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors border ${
                copiedReport
                  ? 'border-success/40 bg-success/15 text-success'
                  : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title="Copy incident report as Markdown"
            >
              {copiedReport ? 'Report Copied!' : 'Copy Report'}
            </button>
            <button
              onClick={onClose}
              className="ml-1 text-muted-foreground hover:text-card-foreground text-xl leading-none p-1"
              aria-label="Close summary modal"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6 text-sm">
          {/* Stats row */}
          <div className="flex flex-wrap rounded-md border border-border">
            {statBlock(totalFacts, 'Facts', 'text-success')}
            {statBlock(totalHypotheses, 'Hypotheses', 'text-warning')}
            {statBlock(totalConflicts, 'Conflicts', 'text-destructive')}
            {statBlock(totalDecisions, 'Decisions', 'text-primary')}
            {statBlock(totalActions, 'Actions', 'text-accent-foreground')}
          </div>

          {/* Participants */}
          {(data.participants || []).length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Participants</h3>
              <div className="flex flex-wrap gap-2">
                {data.participants.map((p) => (
                  <span key={p.uid} className="rounded-sm border border-border px-2 py-1 text-xs text-card-foreground">
                    {p.name} ({p.role})
                  </span>
                ))}
                {data.agentActive && (
                  <span className="rounded-sm border border-primary/25 bg-primary/10 px-2 py-1 text-xs text-primary">
                    SRE-Zero
                  </span>
                )}
              </div>
            </div>
          )}

          {reportSection('Confirmed facts', 'bg-success', factsList)}
          {reportSection('Hypotheses', 'bg-warning', hypothesesList)}
          {reportSection('Conflicts', 'bg-destructive', conflictsList)}
          {reportSection('Decisions', 'bg-primary', decisionsList)}
          {reportSection('Action items', 'bg-accent', actionsList)}

          {/* Approvals */}
          {(data.approvals || []).length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Approval requests</h3>
              </div>
              <div className="space-y-2">
                {data.approvals.map((a, i) => (
                  <div key={i} className="border-l border-border pl-3">
                    <p className="text-card-foreground">{a.action} — <span className={a.status === 'approved' ? 'text-success' : 'text-warning'}>{a.status}</span></p>
                    <p className="text-[10px] text-muted-foreground">{a.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {(data.timeline || []).length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Full timeline</h3>
              <div className="relative space-y-3 border-l border-border pl-4">
                {data.timeline.map((t, i) => (
                  <div key={i} className="relative">
                    <span className="absolute -left-[1.31rem] top-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{fmtTime(t.timestamp)} &middot; {t.actor || 'sre-zero'}</p>
                    <p className="text-card-foreground/80">{t.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {factsList.length === 0 && (data.timeline || []).length === 0 && (
            <p className="py-8 text-center text-muted-foreground">No incident data collected yet. Start a conversation and ask SRE-Zero to check monitoring or record facts.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main LandingPage ──────────────────────────────────

export default function LandingPage() {
  const [inWarRoom, setInWarRoom] = useState(false);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [roomCode, setRoomCode] = useState<string>('');
  const [incidentTitle, setIncidentTitle] = useState<string>('Active Incident');
  const [userInfo, setUserInfo] = useState<{ name: string; role: string }>({ name: '', role: 'Engineer' });
  const [roster, setRoster] = useState<RosterParticipant[]>([]);
  const [speakingUids, setSpeakingUids] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    import('agora-rtc-react').catch(() => {});
    import('agora-rtm').catch(() => {});
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null);
  const [rtmClient, setRtmClient] = useState<RTMClient | null>(null);
  const [agentJoinError, setAgentJoinError] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<IncidentSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeView, setActiveView] = useState<'war_room' | 'incidents' | 'about'>('war_room');
  const [incidentsRoomCode, setIncidentsRoomCode] = useState('');
  const [warRoomTab, setWarRoomTab] = useState<'VOICE_LIVE' | 'HEATMAP' | 'RUNBOOK' | 'RECOVERY' | 'TIME_MACHINE' | 'DECISIONS' | 'CHAT_FIREWALL'>('VOICE_LIVE');
  const [showReportsModal, setShowReportsModal] = useState(false);
  const isStoppingRef = useRef(false);

  // ── Start a new incident (creates room code + token) ──
  const handleStartIncident = async (name: string, role: string, title: string) => {
    isStoppingRef.current = false;
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    if (rtmClient) {
      try {
        await rtmClient.logout();
      } catch {}
      setRtmClient(null);
    }

    try {
      const code = generateRoomCode();
      setRoomCode(code);
      setIncidentTitle(title);
      setUserInfo({ name, role });

      // 1. Get Agora token for this channel
      const tokenResp = await fetch(`/api/generate-agora-token?channel=${encodeURIComponent(code)}`);
      const tokenData = await tokenResp.json();

      if (!tokenResp.ok) {
        throw new Error(`Failed to generate Agora token: ${JSON.stringify(tokenData)}`);
      }

      // 2. Register creator with the roster API
      await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          channel: code,
          uid: tokenData.uid,
          name,
          role,
        }),
      });

      // 3. Connect RTM in parallel
      const rtm: RTMClient | null = await (async (): Promise<RTMClient | null> => {
        try {
          const { default: AgoraRTM } = await import('agora-rtm');
          const rtm: RTMClient = new AgoraRTM.RTM(
            process.env.NEXT_PUBLIC_AGORA_APP_ID!,
            tokenData.uid,
          );
          await rtm.login({ token: tokenData.token });
          await rtm.subscribe(code);
          return rtm;
        } catch (err) {
          console.error('RTM init failed (transcript panel will be disabled):', err);
          return null;
        }
      })();

      setRtmClient(rtm);
      setAgoraData({ ...tokenData });
      setInWarRoom(true);
      setIsConversationActive(true);
    } catch (err) {
      setError('Failed to start incident. Please try again.');
      console.error('Error starting incident:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Called by ConversationComponent after RTC join + mic publish ──
  const handleRtcReady = useCallback(async (uid: string) => {
    if (!agoraData?.channel || !userInfo.name) return;

    // If an agent is already running for this channel, don't start a new one.
    if (agoraData.agentId) return;

    try {
      const resp = await fetch('/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: uid,
          channel_name: agoraData.channel,
          requester_name: userInfo.name,
          requester_role: userInfo.role,
        } as ClientStartRequest),
      });

      if (!resp.ok) {
        setAgentJoinError(true);
        return;
      }

      const agentData: AgentResponse = await resp.json();
      setAgoraData((prev) => (prev ? { ...prev, agentId: agentData.agent_id } : prev));
    } catch (err) {
      console.error('Failed to start agent after RTC ready:', err);
      setAgentJoinError(true);
    }
  }, [agoraData, userInfo]);

  // ── Join an existing incident (reuses room code) ──
  const handleJoinIncident = async (name: string, role: string, code: string) => {
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    if (rtmClient) {
      try {
        await rtmClient.logout();
      } catch {}
      setRtmClient(null);
    }

    try {
      const cleanCode = code.trim().toUpperCase();

      // 1. Verify if room exists in registry
      const checkResp = await fetch(`/api/roster?channel=${encodeURIComponent(cleanCode)}`);
      const checkData = await checkResp.json();
      if (!checkResp.ok || !checkData.exists) {
        setError('Room not found. Check the room code and try again.');
        setIsLoading(false);
        return;
      }

      setRoomCode(cleanCode);
      setIncidentTitle(checkData.incidentTitle || 'Active Incident');
      setUserInfo({ name, role });

      // 2. Get Agora token for the existing channel
      const tokenResp = await fetch(`/api/generate-agora-token?channel=${encodeURIComponent(cleanCode)}`);
      const tokenData = await tokenResp.json();

      if (!tokenResp.ok) {
        throw new Error(`Failed to generate Agora token: ${JSON.stringify(tokenData)}`);
      }

      // 3. Register with the roster API (adds participant)
      await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          channel: cleanCode,
          uid: tokenData.uid,
          name,
          role,
        }),
      });

      const existingAgentId = checkData.agentId || null;

      // 4. Connect RTM
      let rtm: RTMClient | null = null;
      try {
        const { default: AgoraRTM } = await import('agora-rtm');
        rtm = new AgoraRTM.RTM(
          process.env.NEXT_PUBLIC_AGORA_APP_ID!,
          tokenData.uid,
        );
        await rtm.login({ token: tokenData.token });
        await rtm.subscribe(cleanCode);
      } catch (err) {
        console.error('RTM init failed (transcript panel will be disabled):', err);
      }

      setRtmClient(rtm);
      setAgoraData({ ...tokenData, agentId: existingAgentId });
      setInWarRoom(true);
      setIsConversationActive(true);
    } catch (err) {
      setError('Failed to join incident. Check the room code and try again.');
      console.error('Error joining incident:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTokenWillExpire = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      try {
        const channel = agoraData?.channel;
        if (!channel) {
          throw new Error('Missing channel for token renewal');
        }
        const [rtcResponse, rtmResponse] = await Promise.all([
          fetch(`/api/generate-agora-token?channel=${channel}&uid=${uid}`),
          fetch(`/api/generate-agora-token?channel=${channel}&uid=${agoraData.uid}`),
        ]);
        const [rtcData, rtmData] = await Promise.all([
          rtcResponse.json(),
          rtmResponse.json(),
        ]);
        if (!rtcResponse.ok || !rtmResponse.ok) {
          throw new Error('Failed to generate renewal tokens');
        }
        return {
          rtcToken: rtcData.token,
          rtmToken: rtmData.token,
        };
      } catch (error) {
        console.error('Error renewing token:', error);
        throw error;
      }
    },
    [agoraData],
  );

  // ── End conversation: stops Agora session ONLY, stays inside War Room ──
  const handleEndConversation = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 1. Capture current session params before clearing state
    const agentIdToStop = agoraData?.agentId;
    const channelToLeave = agoraData?.channel;
    const uidToLeave = agoraData?.uid;
    const currentRtm = rtmClient;

    // 2. IMMEDIATELY update local UI state (optimistic)
    setIsConversationActive(false);
    setRtmClient(null);
    setAgoraData((prev) => (prev ? { ...prev, agentId: undefined } : null));

    // 3. Fire network cleanup & agent termination in background
    (async () => {
      try {
        if (agentIdToStop) {
          fetch('/api/stop-conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentIdToStop }),
          }).catch((err) => {
            console.error('[stop-conversation] Background stop failed:', err);
          });
        }

        if (channelToLeave && uidToLeave) {
          fetch('/api/roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'leave',
              channel: channelToLeave,
              uid: uidToLeave,
            }),
          }).catch((err) => {
            console.error('[roster] Background leave failed:', err);
          });
        }

        if (currentRtm) {
          try {
            await currentRtm.logout();
          } catch (rtmErr) {
            console.error('[rtm] Background logout error:', rtmErr);
          }
        }
      } finally {
        isStoppingRef.current = false;
      }
    })();
  }, [agoraData, rtmClient]);

  // ── Restart / Rejoin conversation inside the current room ──
  const handleRestartConversation = async () => {
    if (!roomCode || !userInfo.name) return;
    isStoppingRef.current = false;
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    try {
      const tokenResp = await fetch(`/api/generate-agora-token?channel=${encodeURIComponent(roomCode)}`);
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok) throw new Error('Failed to generate token');

      await fetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          channel: roomCode,
          uid: tokenData.uid,
          name: userInfo.name,
          role: userInfo.role,
        }),
      });

      let rtm: RTMClient | null = null;
      try {
        const { default: AgoraRTM } = await import('agora-rtm');
        rtm = new AgoraRTM.RTM(process.env.NEXT_PUBLIC_AGORA_APP_ID!, tokenData.uid);
        await rtm.login({ token: tokenData.token });
        await rtm.subscribe(roomCode);
      } catch (err) {
        console.error('RTM init failed:', err);
      }

      setRtmClient(rtm);
      setAgoraData({ ...tokenData });
      setIsConversationActive(true);
    } catch (err) {
      console.error('Failed to restart conversation:', err);
      setError('Failed to restart conversation.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Explicit Leave Room (returns to pre-call screen) ──
  const handleLeaveWarRoom = async () => {
    if (isConversationActive) {
      await handleEndConversation();
    }
    setInWarRoom(false);
    setRoomCode('');
    setAgoraData(null);
    setActiveView('war_room');
  };

  // ── Generate incident summary ──
  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    try {
      const channel = agoraData?.channel || roomCode;
      const resp = await fetch(`/api/incident-summary?channel=${encodeURIComponent(channel)}`);
      if (resp.ok) {
        const data: IncidentSummaryData = await resp.json();
        setSummaryData(data);
        setShowSummary(true);
      }
    } catch (err) {
      console.error('Failed to generate summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  };

  // ── Pre-call screen ──
  if (!inWarRoom) {
    return (
      <PreCallScreen
        onStart={handleStartIncident}
        onJoin={handleJoinIncident}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  // ── Active war room shell ──
  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background text-foreground">
      {/* ── Column 1: Icon navigation rail ── */}
      <div className="w-16 shrink-0 flex flex-col items-center gap-6 bg-sidebar py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-sidebar-border font-serif text-sm text-sidebar-primary-foreground">
          S0
        </div>
        <div className="flex flex-col gap-2 text-sidebar-foreground/60">
          <button
            onClick={handleLeaveWarRoom}
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Leave War Room (Home)"
            aria-label="Leave war room"
          >
            <span className="text-base">&#x2302;</span>
          </button>
          <button
            onClick={() => setActiveView('war_room')}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors ${
              activeView === 'war_room'
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
            title="War Room"
          >
            &#x23FA;
          </button>
          <button
            onClick={() => setActiveView('incidents')}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors ${
              activeView === 'incidents'
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
            title="Incidents"
          >
            &#x2630;
          </button>
          <button
            onClick={() => setActiveView('about')}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-base transition-colors ${
              activeView === 'about'
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
            title="About"
          >
            i
          </button>
        </div>
        <div className="mt-auto flex flex-col items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
              ROLE_COLORS[userInfo.role] || 'bg-sidebar-foreground/15 text-sidebar-foreground'
            }`}
          >
            {getInitials(userInfo.name)}
          </div>
        </div>
      </div>

      {/* ── Column 2: War room list + participants ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
            War Rooms
          </span>
          <span className="font-mono text-xs text-sidebar-foreground/60">{roomCode}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Active incident */}
          <div
            onClick={() => setActiveView('war_room')}
            className="cursor-pointer border-l-2 border-sidebar-primary bg-sidebar-primary/10 px-4 py-3"
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  isConversationActive ? 'bg-destructive animate-calm-pulse' : 'bg-muted-foreground'
                }`}
              />
              <p className="truncate text-sm font-medium text-sidebar-foreground">{incidentTitle}</p>
            </div>
            <p className="text-xs text-sidebar-foreground/50">
              {isConversationActive ? 'Live · SRE-Zero active' : 'Session Ended · State active'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-sidebar-foreground/35">Room: {roomCode}</p>
          </div>

          {/* Room code share box */}
          <div className="mx-4 my-3 rounded-md border border-sidebar-border px-3 py-2.5">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-sidebar-foreground/40">Share this code</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm tracking-wider text-sidebar-foreground">{roomCode}</code>
              <button
                onClick={() => {
                  if (roomCode) {
                    navigator.clipboard?.writeText(roomCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                className={`text-xs transition-colors ${
                  copied
                    ? 'font-semibold text-success'
                    : 'text-sidebar-foreground/50 hover:text-sidebar-foreground'
                }`}
                title="Copy room code to clipboard"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Participants */}
          <ParticipantsList
            channel={agoraData?.channel || roomCode}
            agentActive={isConversationActive || !!agoraData?.agentId}
            speakingUids={speakingUids}
            onRosterChange={setRoster}
          />
        </div>
      </div>

      {/* ── Column 3: Main area (switches between War Room / Incidents / About) ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Incidents View */}
        {activeView === 'incidents' && (
          <div className="flex-1 flex flex-col bg-background text-foreground p-8 overflow-y-auto">
            <h2 className="font-serif text-2xl font-medium mb-1.5">Incident Summaries</h2>
            <p className="text-sm text-muted-foreground mb-6">Enter a room code to view the incident summary and timeline.</p>
            <div className="flex gap-2 mb-6 max-w-md">
              <input
                type="text"
                value={incidentsRoomCode}
                onChange={(e) => setIncidentsRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                className="flex-1 px-4 py-2.5 rounded-md bg-card border border-border text-foreground text-sm font-mono tracking-wider focus:outline-none focus:border-primary"
              />
              <button
                onClick={async () => {
                  setSummaryLoading(true);
                  try {
                    const resp = await fetch(`/api/incident-summary?channel=${encodeURIComponent(incidentsRoomCode)}`);
                    if (resp.ok) {
                      const data: IncidentSummaryData = await resp.json();
                      setSummaryData(data);
                      setShowSummary(true);
                    }
                  } catch (err) {
                    console.error('Failed to fetch summary:', err);
                  } finally {
                    setSummaryLoading(false);
                  }
                }}
                disabled={!incidentsRoomCode || summaryLoading}
                className="px-4 py-2.5 rounded-md bg-primary/10 text-primary border border-primary/30 text-sm font-medium hover:bg-primary/15 disabled:opacity-50"
              >
                {summaryLoading ? 'Loading...' : 'View Summary'}
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              {roomCode ? (
                <p>Current active room: <span className="text-primary font-mono">{roomCode}</span></p>
              ) : (
                <p>No active incident. Start or join a war room first.</p>
              )}
            </div>
          </div>
        )}

        {/* About View */}
        {activeView === 'about' && (
          <div className="flex-1 flex flex-col bg-background text-foreground p-8 overflow-y-auto max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full border border-primary/25 bg-card flex items-center justify-center font-serif text-lg text-primary">
                S0
              </div>
              <div>
                <h2 className="font-serif text-xl font-medium">SRE-Zero</h2>
                <p className="text-sm text-muted-foreground">AI Incident Commander</p>
              </div>
            </div>
            <div className="space-y-5 text-sm text-muted-foreground">
              <p className="text-foreground/80">
                SRE-Zero is a voice-native AI Incident Commander built on Agora Conversational AI. It joins live incident war rooms as a participant — listening to engineers discuss production incidents, organizing evidence, detecting conflicts, and keeping humans in control of critical actions.
              </p>
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">Key Features</h3>
                <ul className="space-y-1.5">
                  <li>Voice-native — joins the call via Agora ConvoAI (Deepgram STT, OpenAI GPT-4o-mini, MiniMax TTS)</li>
                  <li>Conflict detection — cross-validates engineer claims against monitoring data</li>
                  <li>Human-in-the-loop — requires explicit approval for critical actions like rollbacks</li>
                  <li>Incident intelligence — tracks facts, hypotheses, decisions, actions, and timeline</li>
                  <li>Room codes — shareable war room codes for multi-participant incidents</li>
                  <li>Roster awareness — knows who&apos;s in the room and their roles</li>
                  <li>Auto-generated incident summaries — postmortem-ready reports</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">MCP Tools</h3>
                <p>The AI agent can invoke tools during conversation: checkWebsite, checkGitHub, check_monitoring, record_fact, get_incident_state, detect_conflict, request_approval, execute_rollback</p>
              </div>
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">Tech Stack</h3>
                <p>Next.js, Agora Conversational AI, Agora RTC + RTM, MCP (Model Context Protocol), Tailwind CSS</p>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-6">Built for the Agora Conversational AI Hackathon.</p>
            </div>
          </div>
        )}

        {/* War Room View (Persistently mounted in DOM to prevent killing Agora on navigation) */}
        <div className={activeView === 'war_room' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'}>
          {/* Incident header */}
          <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                <span className={`h-1.5 w-1.5 rounded-full ${isConversationActive ? 'bg-destructive animate-calm-pulse' : 'bg-muted-foreground'}`} />
                {isConversationActive ? 'LIVE' : 'WAR ROOM'}
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-serif text-lg font-medium leading-tight text-card-foreground">{incidentTitle}</h2>
                <p className="text-xs text-muted-foreground">War Room &middot; {roomCode}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setShowReportsModal(true)}
                className="rounded-md border border-primary/40 bg-primary/20 px-3.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/30"
                title="View complete 2-layer incident and conversation reports"
              >
                Complete Incident Reports
              </button>
              <button
                onClick={handleGenerateSummary}
                disabled={summaryLoading}
                className="rounded-md border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                title="Generate incident summary"
              >
                {summaryLoading ? 'Generating…' : 'Summary'}
              </button>
            </div>
          </div>

          {/* SRE-Zero War Room Sub-Navigation Tabs */}
          <div className="flex items-center gap-1.5 border-b border-border bg-card/60 px-6 py-2 overflow-x-auto text-xs font-medium">
            <button
              onClick={() => setWarRoomTab('VOICE_LIVE')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'VOICE_LIVE' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              🎙️ Voice & Live Conversation
            </button>
            <button
              onClick={() => setWarRoomTab('HEATMAP')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'HEATMAP' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              📊 Operational Heatmap
            </button>
            <button
              onClick={() => setWarRoomTab('RUNBOOK')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'RUNBOOK' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              📖 Adaptive Runbook
            </button>
            <button
              onClick={() => setWarRoomTab('RECOVERY')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'RECOVERY' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              🔄 Recovery & Snapshots
            </button>
            <button
              onClick={() => setWarRoomTab('TIME_MACHINE')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'TIME_MACHINE' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              🧠 Time Machine
            </button>
            <button
              onClick={() => setWarRoomTab('DECISIONS')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'DECISIONS' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              🎯 Decision Packets
            </button>
            <button
              onClick={() => setWarRoomTab('CHAT_FIREWALL')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                warRoomTab === 'CHAT_FIREWALL' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              💬 Realtime Chat (Firewall)
            </button>
          </div>

          {/* Conversation + sidebar */}
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 flex flex-col min-w-0 bg-background overflow-y-auto">
              {/* Prominent War Room Approval Gate Banner */}
              <WarRoomApprovalBanner
                channel={agoraData?.channel || roomCode}
                userName={userInfo.name}
              />

              {agentJoinError && (
                <div className="m-3 rounded-sm border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                  Failed to connect with AI agent. The conversation may not work as expected.
                </div>
              )}

              {/* Tab 1: Voice & Live Conversation (Persistently mounted so Agora WebRTC is never killed) */}
              <div className={warRoomTab === 'VOICE_LIVE' ? 'flex flex-1 flex-col' : 'hidden'}>
                {isConversationActive && agoraData ? (
                  <Suspense fallback={<LoadingSkeleton />}>
                    <ErrorBoundary>
                      <AgoraProvider>
                        <ConversationComponent
                          agoraData={agoraData}
                          rtmClient={rtmClient}
                          onTokenWillExpire={handleTokenWillExpire}
                          onEndConversation={handleEndConversation}
                          onRtcReady={handleRtcReady}
                          roster={roster}
                          userInfo={userInfo}
                          onSpeakingChange={setSpeakingUids}
                        />
                      </AgoraProvider>
                    </ErrorBoundary>
                  </Suspense>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                    <div className="max-w-md space-y-4 rounded-lg border border-border bg-card/60 p-6 backdrop-blur-sm">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/20 font-serif text-base text-muted-foreground">
                        S0
                      </div>
                      <div>
                        <h3 className="font-serif text-base font-medium text-foreground">Voice Conversation Ended</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          The live Agora voice session with SRE-Zero has ended. Incident state, timeline, facts, actions, and summary remain fully active and accessible.
                        </p>
                      </div>
                      <div className="pt-2">
                        <button
                          onClick={handleRestartConversation}
                          disabled={isLoading}
                          className="rounded-md bg-primary px-5 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                          {isLoading ? 'Reconnecting…' : 'Rejoin Voice Conversation'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Tab 2: Operational Heatmap */}
              {warRoomTab === 'HEATMAP' && (
                <div className="p-6">
                  <OperationalHeatmap channel={agoraData?.channel || roomCode} />
                </div>
              )}

              {/* Tab 3: Adaptive Runbook */}
              {warRoomTab === 'RUNBOOK' && (
                <div className="p-6">
                  <AdaptiveRunbookPanel channel={agoraData?.channel || roomCode} />
                </div>
              )}

              {/* Tab 4: Human Recovery & Snapshots */}
              {warRoomTab === 'RECOVERY' && (
                <div className="p-6">
                  <RecoveryWorkflowPanel channel={agoraData?.channel || roomCode} currentUser={userInfo} />
                </div>
              )}

              {/* Tab 5: Incident Time Machine */}
              {warRoomTab === 'TIME_MACHINE' && (
                <div className="p-6">
                  <IncidentTimeMachine channel={agoraData?.channel || roomCode} />
                </div>
              )}

              {/* Tab 6: Decision Packets */}
              {warRoomTab === 'DECISIONS' && (
                <div className="p-6">
                  <DecisionPacketPanel channel={agoraData?.channel || roomCode} currentUser={userInfo} />
                </div>
              )}

              {/* Tab 7: Realtime Chat (Firewall) */}
              {warRoomTab === 'CHAT_FIREWALL' && (
                <div className="p-6">
                  <RealtimeChatPanel
                    channel={agoraData?.channel || roomCode}
                    currentUser={{ uid: String(agoraData?.uid || '0'), name: userInfo.name, role: userInfo.role }}
                  />
                </div>
              )}
            </div>

            {/* Right sidebar: Incident state */}
            <div className="w-80 border-l border-sidebar-border flex-shrink-0">
              <IncidentSidebar channel={agoraData?.channel || roomCode} />
            </div>
          </div>
        </div>
      </div>

      {/* Final Reports Modal */}
      <FinalReportModal
        channel={agoraData?.channel || roomCode}
        isOpen={showReportsModal}
        onClose={() => setShowReportsModal(false)}
      />

      {/* Summary modal */}
      {showSummary && summaryData && (
        <SummaryModal
          data={summaryData}
          onClose={() => setShowSummary(false)}
          onRefresh={handleGenerateSummary}
          isRefreshing={summaryLoading}
        />
      )}
    </div>
  );
}

// Must match the server-side generateRoomCode format.
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';
  const a = chars[Math.floor(Math.random() * chars.length)];
  const b = chars[Math.floor(Math.random() * chars.length)];
  const c = digits[Math.floor(Math.random() * digits.length)];
  const d = digits[Math.floor(Math.random() * digits.length)];
  return `SRE-${a}${b}${c}${d}`;
}

