import type { IncidentState } from '@/lib/incident/types';
import { IncidentRepository, type DecisionPacketRecord } from '@/lib/db/repository';

export async function createDecisionPacket(
  channel: string,
  title: string,
  problem: string,
  options?: Partial<DecisionPacketRecord>,
  incidentState?: IncidentState
): Promise<DecisionPacketRecord> {
  const channelKey = channel.trim().toLowerCase() || 'default';
  const confirmedFacts = incidentState?.facts
    .filter((f) => f.confidence === 'confirmed' || f.type === 'fact')
    .map((f) => `[${f.source}] ${f.content}`) || options?.confirmedFacts || ['Website health check and error telemetry collected'];

  const supportingEvidence = incidentState?.evidence
    .filter((e) => e.confidence === 'CONFIRMED' || e.confidence === 'LIKELY')
    .map((e) => `[${e.source}] ${e.content}`) || options?.supportingEvidence || ['Observed HTTP 5xx responses during check'];

  const conflictingEvidence = incidentState?.conflicts
    .map((c) => `[${c.status}] ${c.description}`) || options?.conflictingEvidence || [];

  const hypotheses = incidentState?.hypotheses
    .map((h) => `[${h.status}] ${h.content}`) || options?.hypotheses || ['Recent deployment v2.4.1 introduced payment route regression'];

  const packet: DecisionPacketRecord = {
    id: `dp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    channel: channelKey,
    title,
    problem,
    confirmedFacts,
    supportingEvidence,
    conflictingEvidence,
    hypotheses,
    confidence: options?.confidence || (conflictingEvidence.length > 0 ? 'MEDIUM (CONFLICTING EVIDENCE)' : 'HIGH'),
    risk: options?.risk || 'HIGH (PRODUCTION OUTAGE IMPACT)',
    possibleActions: options?.possibleActions || ['Manual code patch or configuration update by human engineer'],
    alternatives: options?.alternatives || ['Scale backend replicas', 'Route traffic to fallback static gateway'],
    expectedImpact: options?.expectedImpact || 'Restores payment service availability and reduces 5xx error rate below threshold.',
    verificationPlan: options?.verificationPlan || 'Run independent website GET health check and telemetry query post-remediation.',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  await IncidentRepository.saveDecisionPacket(channelKey, packet);
  return packet;
}

export async function submitHumanVerdict(
  channel: string,
  packetId: string,
  verdict: 'APPROVE' | 'REJECT' | 'MODIFY' | 'DEFER' | 'UNKNOWN',
  decidedBy: { name: string; role: string },
  rationale?: string
): Promise<DecisionPacketRecord | null> {
  const channelKey = channel.trim().toLowerCase() || 'default';
  const packets = await IncidentRepository.getDecisionPackets(channelKey);
  const packet = packets.find((p) => p.id === packetId);

  if (!packet) return null;

  packet.status = 'DECIDED';
  packet.verdict = verdict;
  packet.decidedBy = decidedBy;
  packet.decidedAt = new Date().toISOString();
  packet.rationale = rationale || `Human verdict ${verdict} submitted by ${decidedBy.name} (${decidedBy.role}).`;

  await IncidentRepository.saveDecisionPacket(channelKey, packet);
  return packet;
}
