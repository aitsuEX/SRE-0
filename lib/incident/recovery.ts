import { checkWebsite } from '@/lib/adapters/website';
import { checkMonitoring } from '@/lib/adapters/monitoring';
import { getIncidentState, addIncidentEvidence, addIncidentTimeline, persistIncidentState } from './state';

/**
 * IMPORTANT (human-in-the-loop invariant):
 * SRE-Zero must never autonomously execute a rollback or mutate the system under
 * investigation. Previously this module auto-flipped the local Phasebook simulator
 * to its "recovered" state and switched the active website check target to a
 * recovery URL before "verifying" recovery — which guaranteed a fabricated
 * RECOVERED result regardless of what actually happened. That behavior has been
 * removed. verifyRecovery() now ONLY performs independent, read-only checks
 * against whatever the human has actually changed.
 */
export async function verifyRecovery(channel: string) {
  const state = getIncidentState(channel);

  const results = await Promise.all([checkWebsite(), checkMonitoring('service_health')]);
  const usable = results.filter(r => !('status' in r) || (r.status !== 'UNKNOWN' && r.status !== 'UNAVAILABLE'));
  for (const r of results) {
    const source = 'source' in r ? String(r.source).toUpperCase() : 'SYSTEM';
    const status = String(r.status);
    addIncidentEvidence(channel, {
      id: `recovery-${source.toLowerCase()}-${Date.now()}`,
      type: 'OBSERVATION',
      content: `Recovery verification ${source}: ${status}`,
      confidence: status === 'UP' || status === 'PASS' || status === 'healthy' || status === 'HEALTHY' ? 'CONFIRMED' : 'UNVERIFIED',
      source: source as any,
      sourceUrl: 'sourceUrl' in r ? String((r as any).sourceUrl) : 'url' in r ? String((r as any).url) : undefined,
      recordedAt: new Date().toISOString(),
      checkedAt: 'checkedAt' in r ? String((r as any).checkedAt) : new Date().toISOString()
    });
  }
  const healthyWebsite = results[0]?.status === 'UP';
  const healthyMonitoring = results[1]?.status !== 'UNKNOWN' && results[1]?.status !== 'UNAVAILABLE' && (String((results[1] as any)?.metrics?.service_health || '').toLowerCase() === 'healthy' || results[1]?.status === 'HEALTHY');
  if (healthyWebsite && healthyMonitoring) {
    state.phase = 'RESOLVED';
    state.status = 'RESOLVED';
    addIncidentTimeline(channel, {
      type: 'incident_resolved',
      description: 'Independent recovery checks support resolution.',
      actor: 'sre-zero',
      source: 'SYSTEM'
    });
  } else {
    state.phase = 'MONITORING';
    addIncidentTimeline(channel, {
      type: 'recovery_unverified',
      description: 'Recovery is not fully verified; at least one independent check is unavailable or failing.',
      actor: 'sre-zero',
      source: 'SYSTEM'
    });
  }
  state.updatedAt = new Date().toISOString();
  persistIncidentState(channel, state);
  return { resolved: state.status === 'RESOLVED', results, checksAvailable: usable.length };
}

