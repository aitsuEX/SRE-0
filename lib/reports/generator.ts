import type { IncidentState } from '@/lib/incident/types';
import { IncidentRepository } from '@/lib/db/repository';
import { INCIDENT_CONFIG } from '@/src/config/incident';

export interface IncidentReportsBundle {
  conversationReport: string;
  intelligenceReport: string;
  combinedReport: string;
  generatedAt: string;
}

export async function generateIncidentReports(
  channel: string,
  state: IncidentState
): Promise<IncidentReportsBundle> {
  const channelKey = channel.trim().toLowerCase() || 'default';
  const generatedAt = new Date().toISOString();

  // Load persistent messages & decision packets
  const rawMessages = await IncidentRepository.getMessages(channelKey);
  const decisionPackets = await IncidentRepository.getDecisionPackets(channelKey);

  // Filter messages for Conversation Report according to Firewall Rule:
  // Public (EVERYONE) + Shared DMs ONLY. Private unshared DMs MUST NOT appear in public reports.
  const publicMessages = rawMessages.filter(
    (m) => m.scope === 'EVERYONE' || m.sharedToIncident
  );

  // Sort chronologically
  publicMessages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  // --- 1. CONVERSATION REPORT ---
  const convLines: string[] = [
    `# SRE-Zero — Incident Conversation Report`,
    `**Incident:** ${state.incident.name || channel}`,
    `**Affected Service:** ${INCIDENT_CONFIG.websiteUrl || 'NOT_CONFIGURED'}`,
    `**Generated At:** ${generatedAt}`,
    `**Channel:** ${channelKey}`,
    `\n---`,
    `\n### Chronological Communication Log\n`,
  ];

  if (publicMessages.length === 0) {
    convLines.push(`*No public or shared communication recorded during this incident.*`);
  } else {
    for (const msg of publicMessages) {
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
      const tag = msg.sharedToIncident
        ? `[DIRECT CHAT → SHARED TO INCIDENT]`
        : `[${msg.source || 'CHAT'}]`;
      const sender = `${msg.senderName}${msg.senderRole ? ` (${msg.senderRole})` : ''}`;
      convLines.push(`- **${time}** **${tag}** **${sender}:** ${msg.content}`);
    }
  }

  const conversationReport = convLines.join('\n');

  // --- 2. INCIDENT INTELLIGENCE REPORT ---
  const intelLines: string[] = [
    `# SRE-Zero — Incident Intelligence Report`,
    `**Incident ID:** ${state.incident.id}`,
    `**Incident Name:** ${state.incident.name}`,
    `**Affected Service:** ${INCIDENT_CONFIG.websiteUrl || 'NOT_CONFIGURED'}`,
    `**Status:** ${state.status} | **Phase:** ${state.phase} | **Severity:** ${state.severity}`,
    `**Generated At:** ${generatedAt}`,
    `\n---`,
    `\n## Executive Summary`,
    `Incident triaged and monitored by SRE-Zero AI Incident Commander over Agora voice/chat channel \`${channelKey}\`.`,
    `\n### Configured Integrations & Evidence Sources:`,
    `- **Affected Service:** ${INCIDENT_CONFIG.websiteUrl || 'NOT_CONFIGURED'}`,
    `- **Monitoring Source:** ${INCIDENT_CONFIG.monitoringUrl || 'NOT_CONFIGURED'}`,
    `- **GitHub Source:** ${INCIDENT_CONFIG.githubRepoUrl || 'NOT_CONFIGURED'}`,
    `- **Test Source:** ${process.env.INCIDENT_TESTSPRITE_URL || 'NOT_CONFIGURED'}`,
    `- **Jira Source:** ${INCIDENT_CONFIG.jiraUrl || 'NOT_CONFIGURED'}`,
    `\n## Roster & Participants`,
  ];

  if (state.participants && state.participants.length > 0) {
    for (const p of state.participants) {
      intelLines.push(`- **${p.name}** (${p.role}) - UID: \`${p.uid}\``);
    }
  } else {
    intelLines.push(`- *No external participants registered.*`);
  }

  intelLines.push(`\n## Confirmed Facts`);
  const confirmedFacts = state.facts?.filter((f) => f.confidence === 'confirmed' || f.type === 'fact') || [];
  if (confirmedFacts.length > 0) {
    for (const f of confirmedFacts) {
      intelLines.push(`- [${f.source || 'FACT'}] ${f.content}`);
    }
  } else {
    intelLines.push(`- *No confirmed facts recorded.*`);
  }

  intelLines.push(`\n## Hypotheses & Status`);
  if (state.hypotheses && state.hypotheses.length > 0) {
    for (const h of state.hypotheses) {
      intelLines.push(`- **[${h.status}]** ${h.content}`);
    }
  } else {
    intelLines.push(`- *No active hypotheses recorded.*`);
  }

  intelLines.push(`\n## Conflicts & Discrepancies`);
  if (state.conflicts && state.conflicts.length > 0) {
    for (const c of state.conflicts) {
      intelLines.push(`- **[${c.status}]** ${c.description}`);
    }
  } else {
    intelLines.push(`- *No open conflicts detected.*`);
  }

  intelLines.push(`\n## External Evidence Gathered`);
  if (state.evidence && state.evidence.length > 0) {
    for (const e of state.evidence) {
      intelLines.push(`- **[${e.source} | ${e.confidence}]** ${e.content}${e.sourceUrl ? ` ([Source Link](${e.sourceUrl}))` : ''}`);
    }
  } else {
    intelLines.push(`- *No external evidence recorded.*`);
  }

  intelLines.push(`\n## Decisions, Actions & Owners`);
  if (state.actions && state.actions.length > 0) {
    for (const a of state.actions) {
      intelLines.push(`- **[${a.status}]** ${a.title}${a.owner?.name ? ` (Owner: ${a.owner.name})` : ''}`);
    }
  } else {
    intelLines.push(`- *No action items created.*`);
  }

  intelLines.push(`\n## Human Decisions & Decision Packets`);
  if (decisionPackets.length > 0) {
    for (const dp of decisionPackets) {
      intelLines.push(`- **${dp.title}**: Verdict = **${dp.verdict || 'PENDING'}** by ${dp.decidedBy?.name || 'Human'} (${dp.decidedBy?.role || 'Engineer'})`);
      if (dp.rationale) intelLines.push(`  *Rationale:* ${dp.rationale}`);
    }
  } else {
    intelLines.push(`- *No decision packets evaluated.*`);
  }

  intelLines.push(`\n## Recovery & Verification Workflow`);
  const rec = state.recovery;
  intelLines.push(`- **Recovery State:** \`${rec?.state || 'INCIDENT_ACTIVE'}\``);
  if (rec?.before) {
    intelLines.push(`- **Before Snapshot:** Website: ${rec.before.websiteStatus}, Monitoring: ${rec.before.monitoringStatus}`);
  }
  if (rec?.humanReportedChange) {
    intelLines.push(`- **Human Action Reported:** "${rec.humanReportedChange.description}" by ${rec.humanReportedChange.reportedBy}`);
  }
  if (rec?.after) {
    intelLines.push(`- **After Snapshot:** Website: ${rec.after.websiteStatus}, Monitoring: ${rec.after.monitoringStatus}`);
  }
  if (rec?.verificationResult) {
    intelLines.push(`- **Independent AI Verification Verdict:** **${rec.verificationResult}**`);
  }

  intelLines.push(`\n## Root Cause Analysis`);
  const confirmedRootCause = state.facts?.find((f) => f.content.toLowerCase().includes('root cause'));
  if (confirmedRootCause) {
    intelLines.push(`- **Confirmed Root Cause:** ${confirmedRootCause.content}`);
  } else {
    intelLines.push(`- **Root Cause:** Root cause has not been confirmed.`);
  }

  intelLines.push(`\n## Unresolved Risks`);
  if (state.unresolvedRisks && state.unresolvedRisks.length > 0) {
    for (const r of state.unresolvedRisks) {
      intelLines.push(`- ⚠️ ${r}`);
    }
  } else {
    intelLines.push(`- *No open unresolved risks flagged.*`);
  }

  const intelligenceReport = intelLines.join('\n');

  // --- 3. COMBINED REPORT ---
  const combinedReport = [
    intelligenceReport,
    `\n\n==================================================\n\n`,
    conversationReport,
  ].join('\n');

  return {
    conversationReport,
    intelligenceReport,
    combinedReport,
    generatedAt,
  };
}
