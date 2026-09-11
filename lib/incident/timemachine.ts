import type { IncidentState } from '@/lib/incident/types';
import { IncidentRepository, type TimeMachineSnapshotRecord } from '@/lib/db/repository';

export async function captureTimeMachineSnapshot(
  channel: string,
  summary: string,
  state: IncidentState
): Promise<TimeMachineSnapshotRecord> {
  const timestamp = new Date().toISOString();
  const snapshot: TimeMachineSnapshotRecord = {
    id: `tm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    channel: channel.trim().toLowerCase() || 'default',
    timestamp,
    summary,
    phase: state.phase,
    severity: state.severity,
    recoveryState: state.recovery?.state || 'INCIDENT_ACTIVE',
    factsCount: state.facts?.length || 0,
    hypothesesCount: state.hypotheses?.length || 0,
    evidenceCount: state.evidence?.length || 0,
    conflictsCount: state.conflicts?.length || 0,
    decisionsCount: state.decisions?.length || 0,
    actionsCount: state.actions?.length || 0,
    state: JSON.parse(JSON.stringify(state)),
  };

  await IncidentRepository.recordTimeMachineSnapshot(channel, snapshot);
  return snapshot;
}

export async function getTimeMachineHistory(channel: string): Promise<TimeMachineSnapshotRecord[]> {
  return await IncidentRepository.getTimeMachineSnapshots(channel);
}

export async function getSnapshotAtTimestamp(channel: string, timestamp: string): Promise<TimeMachineSnapshotRecord | null> {
  const history = await getTimeMachineHistory(channel);
  if (history.length === 0) return null;

  const targetMs = Date.parse(timestamp);
  let best: TimeMachineSnapshotRecord | null = null;
  let bestDiff = Infinity;

  for (const snap of history) {
    const snapMs = Date.parse(snap.timestamp);
    if (snapMs <= targetMs) {
      const diff = targetMs - snapMs;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = snap;
      }
    }
  }

  return best || history[0];
}
