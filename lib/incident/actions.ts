import type { ActionItem, ApprovalRequest } from './types';
import { getIncidentState, addIncidentTimeline, persistIncidentState } from './state';

export function createAction(channel: string, input: Pick<ActionItem,'title'|'description'|'priority'|'source'>): ActionItem {
  const state = getIncidentState(channel); const now = new Date().toISOString();
  const action: ActionItem = { id:`action-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, title:input.title, description:input.description, priority:input.priority, source:input.source, status:'OPEN', evidenceIds:[], createdAt:now };
  state.actions.push(action); state.updatedAt=now;
  addIncidentTimeline(channel,{type:'action_created',description:`Action created: ${action.title}`,actor:'sre-zero',source:'SYSTEM'});
  persistIncidentState(channel, state);
  return action;
}

export function requestApproval(channel: string, action: string, target: string | undefined, parameters: Record<string,unknown>|undefined, reason:string, risks:string[]): ApprovalRequest {
  const state = getIncidentState(channel);
  const now = Date.now();
  const approval: ApprovalRequest = {
    id: `approval-${now}-${Math.random().toString(36).slice(2, 7)}`,
    action: action || 'rollback',
    target: target || undefined,
    parameters: parameters || undefined,
    reason: reason || 'Incident mitigation intervention',
    risks: risks || [],
    status: 'pending',
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  };
  state.approvals.push(approval);
  state.updatedAt = new Date().toISOString();
  addIncidentTimeline(channel, {
    type: 'approval_requested',
    description: `Approval requested for ${approval.action}${target ? ` targeting ${target}` : ''}: ${approval.reason}`,
    actor: 'sre-zero',
    source: 'SYSTEM',
  });
  persistIncidentState(channel, state);
  return approval;
}

export function validateApproval(approval: ApprovalRequest, action: string, target?: string, parameters?: Record<string,unknown>): string | null {
  if (approval.status !== 'approved') return `Approval is ${approval.status}.`;
  if (approval.expiresAt && Date.now() >= Date.parse(approval.expiresAt)) return 'Approval has expired.';
  if (approval.action.toLowerCase() !== action.toLowerCase()) return 'Approval action does not match.';
  if (approval.target && target && approval.target !== target) return 'Approval target does not match.';
  if (approval.parameters && parameters && JSON.stringify(approval.parameters) !== JSON.stringify(parameters)) return 'Approval parameters do not match.';
  return null;
}

