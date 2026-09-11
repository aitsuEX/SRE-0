import { createIncidentState, getIncidentState as getScopedIncidentState, addIncidentTimeline, addIncidentEvidence, persistIncidentState } from '@/lib/incident/state';
import { getIncidentContext } from '@/lib/incident/context';
import type { Evidence, IncidentState as RichIncidentState } from '@/lib/incident/types';

export interface RosterParticipant { uid:string; name:string; role:string; joinedAt:number; }
export interface RoomMessage {
  id: string;
  turn_id: string | number;
  uid: number;
  speakerUid: string;
  isAgent: boolean;
  text: string;
  createdAt: number;
  status: string;
  isTextChat: boolean;
  name?: string;
  role?: string;
}
interface RoomEntry {
  channel: string;
  agentId: string | null;
  agentCreatedAt: number | null;
  createdAt: number;
  createdBy: string;
  incidentTitle: string;
  roster: Map<string, RosterParticipant>;
  messages: RoomMessage[];
}
const globalRegistry = globalThis as unknown as { __sreZeroRooms?: Map<string, RoomEntry> };
if (!globalRegistry.__sreZeroRooms) globalRegistry.__sreZeroRooms = new Map();
const rooms = globalRegistry.__sreZeroRooms;

function norm(channel?: string): string {
  return (channel || 'default').trim().toUpperCase() || 'DEFAULT';
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits = '0123456789';
  return `SRE-${chars[Math.floor(Math.random() * chars.length)]}${chars[Math.floor(Math.random() * chars.length)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}`;
}

export function createRoom(channel: string, createdBy: string, incidentTitle: string) {
  const key = norm(channel);
  if (!rooms.has(key)) {
    rooms.set(key, {
      channel: key,
      agentId: null,
      agentCreatedAt: null,
      createdAt: Date.now(),
      createdBy,
      incidentTitle,
      roster: new Map(),
      messages: [],
    });
    createIncidentState(key, incidentTitle);
  }
}

export function getRoom(channel: string) {
  return rooms.get(norm(channel));
}

export function roomExists(channel: string) {
  return rooms.has(norm(channel));
}

export function hasAgent(channel: string) {
  return !!rooms.get(norm(channel))?.agentId;
}

export function getAgentId(channel: string) {
  return rooms.get(norm(channel))?.agentId ?? null;
}

export function registerAgent(channel: string, agentId: string) {
  const room = rooms.get(norm(channel));
  if (room) {
    room.agentId = agentId;
    room.agentCreatedAt = Date.now();
  }
}

export function clearAgent(channel: string) {
  const room = rooms.get(norm(channel));
  if (room) {
    room.agentId = null;
    room.agentCreatedAt = null;
  }
}

export function clearAgentByAgentId(agentId: string) {
  for (const room of rooms.values()) {
    if (room.agentId === agentId) {
      clearAgent(room.channel);
      return;
    }
  }
}

export function addParticipant(channel: string, uid: string, name: string, role: string) {
  const key = norm(channel);
  let room = rooms.get(key);
  if (!room) {
    createRoom(key, name, 'Active Incident');
    room = rooms.get(key)!;
  }
  const p = { uid: String(uid), name, role, joinedAt: Date.now() };
  room.roster.set(String(uid), p);
  const state = getScopedIncidentState(key);
  state.participants = Array.from(room.roster.values());
  state.updatedAt = new Date().toISOString();
  return p;
}

export function removeParticipant(channel: string, uid: string) {
  const key = norm(channel);
  const removed = rooms.get(key)?.roster.delete(String(uid)) ?? false;
  const state = getScopedIncidentState(key);
  state.participants = Array.from(rooms.get(key)?.roster.values() ?? []);
  state.updatedAt = new Date().toISOString();
  return removed;
}

export function getRoster(channel: string) {
  return Array.from(rooms.get(norm(channel))?.roster.values() ?? []);
}

export function addRoomMessage(channel: string, message: RoomMessage) {
  const key = norm(channel);
  let room = rooms.get(key);
  if (!room) {
    createRoom(key, message.name || 'Engineer', 'Active Incident');
    room = rooms.get(key)!;
  }
  if (!room.messages.some((m) => String(m.turn_id) === String(message.turn_id))) {
    room.messages.push(message);
  }
}

export function getRoomMessages(channel: string): RoomMessage[] {
  return rooms.get(norm(channel))?.messages ?? [];
}

// Backward-compatible lightweight fact shape used by the existing UI/MCP.
export interface Fact { id:string; content:string; confidence:'confirmed'|'likely'|'unverified'|'unknown'; source:string; type:'fact'|'hypothesis'|'decision'|'action'|'conflict'; timestamp:string; }
export interface TimelineEvent { timestamp:string; event_type:string; description:string; actor:string; }
export interface ApprovalRequest { id:string; action:string; reason:string; risks:string[]; status:'pending'|'approved'|'rejected'|'expired'; decided_by?:string; requestedAt?:string; approvedAt?:string; expiresAt?:string; target?:string; parameters?:Record<string,unknown>; }
export type IncidentState = RichIncidentState & { unresolved_risks:string[]; };

export function getIncidentState(channel?:string): IncidentState { const state=getScopedIncidentState(norm(channel || getIncidentContext() || 'default')) as IncidentState; if(!state.unresolved_risks) state.unresolved_risks=state.unresolvedRisks; return state; }
export function addTimelineEvent(channelOrType:string,typeOrDescription:string,descriptionOrActor='sre-zero',actor='sre-zero'){
  // Supports both addTimelineEvent(type, description, actor) and scoped addTimelineEvent(channel,type,description,actor).
  const scoped=arguments.length>=4; const channel=scoped?norm(channelOrType):norm(getIncidentContext() || 'default'); const type=scoped?typeOrDescription:channelOrType; const description=scoped?descriptionOrActor:typeOrDescription; const who=scoped?actor:descriptionOrActor;
  addIncidentTimeline(channel,{type,description,actor:who,source:'system'});
}
export function addFact(fact:Fact,channel?:string){
  const key=norm(channel || getIncidentContext() || 'default');
  const state=getIncidentState(key); const existing=state.facts.find(f=>f.content.toLowerCase()===fact.content.toLowerCase()&&f.source===fact.source); if(existing)return;
  state.facts.push(fact);
  addIncidentEvidence(key,{id:fact.id,type:fact.type.toUpperCase() as Evidence['type'],content:fact.content,confidence:fact.confidence.toUpperCase() as Evidence['confidence'],source:(fact.source.toUpperCase() as Evidence['source'])||'SYSTEM',recordedAt:fact.timestamp});
  state.updatedAt=new Date().toISOString();
  persistIncidentState(key, state);
}
export function buildRosterContext(channel:string){const roster=getRoster(channel);if(!roster.length)return '';return `\n\n# Current Participants in War Room\n${roster.map(p=>`- ${p.name} (${p.role}) — RTC uid ${p.uid}`).join('\n')}\n\nAttribute statements to the correct participant by RTC uid. Never invent a participant identity.`;}
