import type { ApprovalRequest } from './types';
export const CRITICAL_ACTIONS = new Set(['rollback','restart','deploy','delete','scale_down','disable']);
export function requiresApproval(action:string){return CRITICAL_ACTIONS.has(action.trim().toLowerCase());}
export function approvalIsValid(a:ApprovalRequest, action:string, target?:string, parameters?:Record<string,unknown>){
 if(a.status!=='approved') return false; if(a.expiresAt && Date.now()>=Date.parse(a.expiresAt)) return false;
 if(a.action.toLowerCase()!==action.toLowerCase()) return false;
 if(a.target && target && a.target!==target) return false;
 if(a.parameters && parameters && JSON.stringify(a.parameters)!==JSON.stringify(parameters)) return false;
 return true;
}

