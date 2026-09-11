import type { Conflict, Evidence, Hypothesis } from './types';

export function detectConflicts(evidence?: Evidence[]): Conflict[] {
  const evidenceList = evidence || [];
  const conflicts: Conflict[] = [];
  for (let i = 0; i < evidenceList.length; i++) {
    for (let j = i + 1; j < evidenceList.length; j++) {
      const a = evidenceList[i], b = evidenceList[j];
      if (!a || !b || a.confidence === 'UNKNOWN' || b.confidence === 'UNKNOWN') continue;

      // 1. Metric differences
      const am = a.content.match(/(?:error rate|error_rate|cpu|latency|p99|502|500)[^0-9]*(\d+(?:\.\d+)?)/i);
      const bm = b.content.match(/(?:error rate|error_rate|cpu|latency|p99|502|500)[^0-9]*(\d+(?:\.\d+)?)/i);
      if (am && bm && /(?:error rate|error_rate|cpu|latency|p99|502|500)/i.test(a.content) && /(?:error rate|error_rate|cpu|latency|p99|502|500)/i.test(b.content)) {
        const av = Number(am[1]), bv = Number(bm[1]);
        if (Number.isFinite(av) && Number.isFinite(bv) && Math.abs(av - bv) > Math.max(1, Math.abs(av) * 0.25)) {
          conflicts.push({ id: `conflict-${i}-${j}`, description: `Evidence differs: ${a.content} vs ${b.content}`, evidenceIds: [a.id, b.id], status: 'UNRESOLVED', createdAt: new Date().toISOString() });
        }
      }

      // 2. Semantic state contradictions across entities
      const aLower = a.content.toLowerCase();
      const bLower = b.content.toLowerCase();
      const entities = ['database', 'db', 'payment', 'api', 'website', 'service', 'redis', 'network'];
      for (const entity of entities) {
        if (aLower.includes(entity) && bLower.includes(entity)) {
          const aBad = /down|failed|failure|500|5xx|crash|unhealthy|error|maxed/i.test(aLower);
          const aGood = /healthy|up|normal|ok|fine|running|200|operational/i.test(aLower);
          const bBad = /down|failed|failure|500|5xx|crash|unhealthy|error|maxed/i.test(bLower);
          const bGood = /healthy|up|normal|ok|fine|running|200|operational/i.test(bLower);
          if ((aBad && bGood) || (aGood && bBad)) {
            const desc = `Contradictory reports on ${entity}: "${a.content}" vs "${b.content}"`;
            if (!conflicts.some((c) => c.description === desc)) {
              conflicts.push({
                id: `conflict-${i}-${j}`,
                description: desc,
                evidenceIds: [a.id, b.id],
                status: 'UNRESOLVED',
                createdAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    }
  }
  return conflicts;
}

export function deriveMissingInformation(state: { evidence?: Evidence[]; hypotheses?: Hypothesis[]; conflicts?: Conflict[]; missingInformation?: string[] }): string[] {
  const evidenceList = state.evidence || [];
  const hypothesesList = state.hypotheses || [];
  const conflictsList = state.conflicts || [];
  const missingInfoList = state.missingInformation || [];

  const text = evidenceList.map(e => (e?.content || '').toLowerCase()).join('\n');
  const needed: string[] = [];
  if (!/impact|affected|users|customer/.test(text)) needed.push('Customer/user impact and affected scope');
  if (!/database|db|postgres|mysql|sql/.test(text)) needed.push('Database health and dependency status');
  if (!/deploy|commit|release|change/.test(text)) needed.push('Most recent deployment/change time and version');
  if (!/recovery|healthy|resolved/.test(text)) needed.push('Independent recovery verification after mitigation');
  if (hypothesesList.some(h => h && (h.status === 'PROPOSED' || h.status === 'INVESTIGATING'))) needed.push('Evidence needed to confirm or refute the active hypotheses');
  if (conflictsList.some(c => c && c.status === 'UNRESOLVED')) needed.push('Resolution of conflicting evidence');
  return [...new Set([...missingInfoList, ...needed])];
}

export function upsertHypothesis(state: { hypotheses: Hypothesis[] }, content: string, evidenceIds: string[], status: Hypothesis['status'] = 'PROPOSED'): Hypothesis {
  const existing = state.hypotheses.find(h => h.content.toLowerCase() === content.toLowerCase());
  const now = new Date().toISOString();
  if (existing) { existing.evidenceIds = [...new Set([...existing.evidenceIds, ...evidenceIds])]; existing.status = status; existing.updatedAt = now; return existing; }
  const hypothesis: Hypothesis = { id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, content, status, evidenceIds, createdAt: now, updatedAt: now };
  state.hypotheses.push(hypothesis); return hypothesis;
}
