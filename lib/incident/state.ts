import fs from 'fs';
import path from 'path';
import { INCIDENT_CONFIG } from '@/src/config/incident';
import type { IncidentState, Evidence, TimelineEvent, RecoveryState, RecoveryRecord } from './types';

// NOTE: this file previously lived under `.next/`, which Next.js wipes on every
// rebuild — meaning an incident's state was destroyed by the exact "redeploy"
// event rule 4 says must not erase it. Moved to a directory that survives
// `next build`. This is still local-disk persistence, not a cloud database —
// on ephemeral/serverless hosts (e.g. Vercel) this directory is NOT guaranteed
// to survive a redeploy or scale-to-zero. A real cloud DB provider was not
// specified in the requirements, so none was invented; swap this module's
// load/save implementation for a real provider client when one is chosen.
const STORAGE_FILE = path.join(process.cwd(), '.sre-zero-data', 'incident-states.json');

function backfill(state: IncidentState): IncidentState {
  if (!state.recovery) {
    const now = new Date().toISOString();
    state.recovery = { state: 'INCIDENT_ACTIVE', updatedAt: now, history: [{ state: 'INCIDENT_ACTIVE', at: now }] };
  }
  if (typeof state.aiPaused !== 'boolean') state.aiPaused = false;
  return state;
}

function loadAllStates(): Map<string, IncidentState> {
  const map = new Map<string, IncidentState>();
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [k, v] of Object.entries(parsed)) {
        map.set(k, backfill(v as IncidentState));
      }
    }
  } catch (err) {
    console.error('[loadAllStates error]:', err);
  }
  return map;
}

function saveState(k: string, state: IncidentState) {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = loadAllStates();
    current.set(k, state);
    const obj: Record<string, IncidentState> = {};
    for (const [chan, val] of current.entries()) {
      obj[chan] = val;
    }
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj), 'utf-8');
    console.log('[saveState SUCCESS] saved channel:', k, 'facts count:', state.facts?.length);
  } catch (err) {
    console.error('[saveState ERROR]:', err);
  }
}

const globalState = globalThis as unknown as { __sreZeroIncidentStates?: Map<string, IncidentState> };
if (!globalState.__sreZeroIncidentStates) globalState.__sreZeroIncidentStates = new Map();
const memoryStates = globalState.__sreZeroIncidentStates;

function key(channel?: string): string { return (channel || 'default').trim().toLowerCase() || 'default'; }

export function createIncidentState(channel: string, title?: string): IncidentState {
  const k = key(channel);
  const fileStates = loadAllStates();
  if (fileStates.has(k)) {
    const existing = fileStates.get(k)!;
    if (title && existing.incident) existing.incident.name = title;
    memoryStates.set(k, existing);
    return existing;
  }
  if (memoryStates.has(k)) {
    const existing = memoryStates.get(k)!;
    if (title && existing.incident) existing.incident.name = title;
    saveState(k, existing);
    return existing;
  }
  const now = new Date().toISOString();
  const state: IncidentState = {
    incident: { id: process.env.INCIDENT_ID || `incident-${channel}`, name: title || INCIDENT_CONFIG.incidentName, description: process.env.INCIDENT_DESCRIPTION || '', createdAt: now },
    phase: 'DETECTED', severity: (process.env.INCIDENT_SEVERITY as IncidentState['severity']) || 'UNKNOWN', status: 'ACTIVE',
    participants: [], evidence: [], facts: [], hypotheses: [], conflicts: [], decisions: [], actions: [], approvals: [], timeline: [], missingInformation: [], unresolvedRisks: [], investigations: [],
    recovery: { state: 'INCIDENT_ACTIVE', updatedAt: now, history: [{ state: 'INCIDENT_ACTIVE', at: now }] },
    aiPaused: false,
    createdAt: now, updatedAt: now,
  };
  memoryStates.set(k, state);
  saveState(k, state);
  return state;
}

export function getIncidentState(channel?: string): IncidentState {
  const k = key(channel);
  const fileStates = loadAllStates();
  if (fileStates.has(k)) {
    const s = fileStates.get(k)!;
    memoryStates.set(k, s);
    return s;
  }
  if (memoryStates.has(k)) {
    const s = memoryStates.get(k)!;
    saveState(k, s);
    return s;
  }
  return createIncidentState(channel || 'default');
}

export function touchIncident(channel?: string): void {
  const state = getIncidentState(channel);
  state.updatedAt = new Date().toISOString();
  saveState(key(channel), state);
}

export function addIncidentEvidence(channel: string, evidence: Evidence): void {
  const k = key(channel);
  const state = getIncidentState(channel);
  const duplicate = state.evidence.find(e => e.source === evidence.source && e.content.toLowerCase() === evidence.content.toLowerCase());
  if (!duplicate) {
    state.evidence.push(evidence);
  }
  state.updatedAt = new Date().toISOString();
  memoryStates.set(k, state);
  saveState(k, state);
}

export function addIncidentTimeline(channel: string, event: Omit<TimelineEvent, 'id' | 'timestamp'> & { timestamp?: string }): void {
  const k = key(channel);
  const state = getIncidentState(channel);
  state.timeline.push({ id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: event.timestamp || new Date().toISOString(), ...event });
  state.updatedAt = new Date().toISOString();
  memoryStates.set(k, state);
  saveState(k, state);
}

export function persistIncidentState(channel: string, state: IncidentState): void {
  const k = key(channel);
  state.updatedAt = new Date().toISOString();
  memoryStates.set(k, state);
  saveState(k, state);
}

// ── Recovery state machine ──────────────────────────────────────────────
// Enforces the transitions required by spec: "Changed" must never directly
// equal "Recovered" — HUMAN_REPORTED_CHANGE always routes through
// VERIFYING_RECOVERY (an independent check) before landing on RECOVERED /
// STILL_IMPACTED / VERIFICATION_UNKNOWN.
const ALLOWED_TRANSITIONS: Record<RecoveryState, RecoveryState[]> = {
  INCIDENT_ACTIVE: ['ROLLBACK_RECOMMENDED', 'AWAITING_HUMAN_DECISION', 'OTHER_OPTIONS_REQUESTED'],
  ROLLBACK_RECOMMENDED: ['AWAITING_HUMAN_DECISION', 'HUMAN_REPORTED_CHANGE', 'OTHER_OPTIONS_REQUESTED'],
  AWAITING_HUMAN_DECISION: ['HUMAN_REPORTED_CHANGE', 'OTHER_OPTIONS_REQUESTED'],
  HUMAN_REPORTED_CHANGE: ['VERIFYING_RECOVERY'],
  VERIFYING_RECOVERY: ['RECOVERED', 'STILL_IMPACTED', 'VERIFICATION_UNKNOWN'],
  RECOVERED: ['AWAITING_HUMAN_DECISION', 'INCIDENT_ACTIVE'],
  STILL_IMPACTED: ['AWAITING_HUMAN_DECISION', 'OTHER_OPTIONS_REQUESTED', 'HUMAN_REPORTED_CHANGE'],
  VERIFICATION_UNKNOWN: ['VERIFYING_RECOVERY', 'AWAITING_HUMAN_DECISION', 'OTHER_OPTIONS_REQUESTED'],
  OTHER_OPTIONS_REQUESTED: ['JIRA_PROVIDED', 'WAITING_FOR_COMMAND'],
  JIRA_PROVIDED: ['WAITING_FOR_COMMAND'],
  WAITING_FOR_COMMAND: ['AWAITING_HUMAN_DECISION', 'ROLLBACK_RECOMMENDED', 'INCIDENT_ACTIVE'],
};

export function transitionRecoveryState(
  channel: string,
  to: RecoveryState,
  extra?: Partial<Pick<RecoveryRecord, 'before' | 'humanReportedChange' | 'after' | 'verificationResult'>>,
): { ok: true; recovery: RecoveryRecord } | { ok: false; error: string } {
  const k = key(channel);
  const state = getIncidentState(channel);
  const from = state.recovery.state;
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (from !== to && !allowed.includes(to)) {
    return { ok: false, error: `Illegal recovery transition: ${from} -> ${to}. Allowed: ${allowed.join(', ') || '(none)'}` };
  }
  const now = new Date().toISOString();
  state.recovery = {
    ...state.recovery,
    ...extra,
    state: to,
    updatedAt: now,
    history: [...state.recovery.history, { state: to, at: now }],
  };
  memoryStates.set(k, state);
  saveState(k, state);
  return { ok: true, recovery: state.recovery };
}

// ── AI pause (real, server-side, per-incident) ──────────────────────────
export function setAiPaused(channel: string, paused: boolean): IncidentState {
  const k = key(channel);
  const state = getIncidentState(channel);
  state.aiPaused = paused;
  state.updatedAt = new Date().toISOString();
  memoryStates.set(k, state);
  saveState(k, state);
  return state;
}

export function isAiPaused(channel: string): boolean {
  return getIncidentState(channel).aiPaused === true;
}
