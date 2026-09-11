import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type { IncidentState } from '@/lib/incident/types';

export interface CloudDbStatus {
  configured: boolean;
  mode: 'CLOUD_DB' | 'LOCAL_FALLBACK' | 'NOT_CONFIGURED';
  provider: 'PostgreSQL' | 'None';
  message: string;
  urlPreview?: string;
}

export function getCloudDbStatus(): CloudDbStatus {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  const isPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://');
  if (isPostgres && !dbUrl.includes('placeholder')) {
    return {
      configured: true,
      mode: 'CLOUD_DB',
      provider: 'PostgreSQL',
      message: `Cloud database active via PostgreSQL (${dbUrl.slice(0, 18)}...)`,
      urlPreview: `${dbUrl.slice(0, 15)}...`,
    };
  }
  if (dbUrl && !isPostgres) {
    return {
      configured: false,
      mode: 'LOCAL_FALLBACK',
      provider: 'None',
      message: 'DATABASE_URL is set to a web console URL, not a PostgreSQL connection string (postgresql://user:password@host/dbname?sslmode=require). Using local disk storage fallback (.sre-zero-data/).',
    };
  }
  return {
    configured: false,
    mode: 'LOCAL_FALLBACK',
    provider: 'None',
    message: 'DATABASE_URL is not configured. Using local disk storage fallback (.sre-zero-data/). Note: Local storage is not a cloud database.',
  };
}

// ── PostgreSQL Pool Initialization ──
let pool: Pool | null = null;
let tablesInitialized = false;

function getPgPool(): Pool | null {
  const status = getCloudDbStatus();
  if (!status.configured) return null;

  if (!pool) {
    const connectionString = process.env.DATABASE_URL!;
    const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    pool = new Pool({
      connectionString,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function ensurePgTables(): Promise<void> {
  if (tablesInitialized) return;
  const p = getPgPool();
  if (!p) return;

  try {
    const client = await p.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sre_zero_incidents (
          channel TEXT PRIMARY KEY,
          state JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sre_zero_messages (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          sender_uid TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          sender_role TEXT NOT NULL,
          recipient_uid TEXT,
          recipient_name TEXT,
          content TEXT NOT NULL,
          source TEXT NOT NULL,
          scope TEXT NOT NULL,
          shared_to_incident BOOLEAN NOT NULL DEFAULT FALSE,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sre_zero_decision_packets (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sre_zero_time_machine (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          data JSONB NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
      `);
      tablesInitialized = true;
      console.log('[IncidentRepository] PostgreSQL schema verified/initialized successfully.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[IncidentRepository] PostgreSQL connection/table init error:', err);
  }
}

// ── Local File Fallback Storage ──
const STORAGE_DIR = path.join(process.cwd(), '.sre-zero-data');
const INCIDENTS_FILE = path.join(STORAGE_DIR, 'incident-states.json');
const MESSAGES_FILE = path.join(STORAGE_DIR, 'incident-messages.json');
const TIME_MACHINE_FILE = path.join(STORAGE_DIR, 'time-machine.json');
const DECISION_PACKETS_FILE = path.join(STORAGE_DIR, 'decision-packets.json');

function ensureLocalDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as T;
    }
  } catch (err) {
    console.error(`[Repository] Error reading ${filePath}:`, err);
  }
  return fallback;
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    ensureLocalDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Repository] Error writing ${filePath}:`, err);
  }
}

export interface IncidentMessageRecord {
  id: string;
  channel: string;
  senderUid: string;
  senderName: string;
  senderRole: string;
  recipientUid?: string;
  recipientName?: string;
  content: string;
  source: 'VOICE' | 'CHAT_EVERYONE' | 'DIRECT_CHAT' | 'SYSTEM' | 'TOOL' | 'SRE-ZERO';
  scope: 'EVERYONE' | 'DIRECT';
  sharedToIncident: boolean;
  sharedAt?: string;
  sharedBy?: string;
  timestamp: string;
}

export interface DecisionPacketRecord {
  id: string;
  channel: string;
  title: string;
  problem: string;
  confirmedFacts: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  hypotheses: string[];
  confidence: string;
  risk: string;
  possibleActions: string[];
  alternatives: string[];
  expectedImpact: string;
  verificationPlan: string;
  status: 'PENDING' | 'DECIDED';
  verdict?: 'APPROVE' | 'REJECT' | 'MODIFY' | 'DEFER' | 'UNKNOWN';
  decidedBy?: { name: string; role: string };
  decidedAt?: string;
  rationale?: string;
  createdAt: string;
}

export interface TimeMachineSnapshotRecord {
  id: string;
  channel: string;
  timestamp: string;
  summary: string;
  phase: string;
  severity: string;
  recoveryState: string;
  factsCount: number;
  hypothesesCount: number;
  evidenceCount: number;
  conflictsCount: number;
  decisionsCount: number;
  actionsCount: number;
  state: IncidentState;
}

export class IncidentRepository {
  // ── Incident State ──
  static async loadState(channel: string): Promise<IncidentState | null> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        const res = await p.query('SELECT state FROM sre_zero_incidents WHERE channel = $1', [key]);
        if (res.rows.length > 0) {
          return res.rows[0].state as IncidentState;
        }
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL loadState error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, IncidentState>>(INCIDENTS_FILE, {});
    return all[key] || null;
  }

  static async saveState(channel: string, state: IncidentState): Promise<void> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        await p.query(
          `INSERT INTO sre_zero_incidents (channel, state, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (channel) DO UPDATE
           SET state = EXCLUDED.state, updated_at = NOW()`,
          [key, JSON.stringify(state)]
        );
        return;
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL saveState error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, IncidentState>>(INCIDENTS_FILE, {});
    all[key] = state;
    writeJsonFile(INCIDENTS_FILE, all);
  }

  // ── Messages (Public & Direct) ──
  static async getMessages(channel: string, userUid?: string): Promise<IncidentMessageRecord[]> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        const res = await p.query(
          `SELECT id, channel, sender_uid AS "senderUid", sender_name AS "senderName", sender_role AS "senderRole",
                  recipient_uid AS "recipientUid", recipient_name AS "recipientName", content, source, scope,
                  shared_to_incident AS "sharedToIncident", timestamp
           FROM sre_zero_messages
           WHERE channel = $1
           ORDER BY timestamp ASC`,
          [key]
        );
        const rows = res.rows as IncidentMessageRecord[];
        if (!userUid) return rows;

        return rows.filter((msg) => {
          if (msg.scope === 'EVERYONE' || msg.sharedToIncident) return true;
          if (msg.senderUid === userUid || msg.recipientUid === userUid) return true;
          return false;
        });
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL getMessages error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, IncidentMessageRecord[]>>(MESSAGES_FILE, {});
    const list = all[key] || [];
    if (!userUid) return list;

    return list.filter((msg) => {
      if (msg.scope === 'EVERYONE' || msg.sharedToIncident) return true;
      if (msg.senderUid === userUid || msg.recipientUid === userUid) return true;
      return false;
    });
  }

  static async saveMessage(channel: string, message: IncidentMessageRecord): Promise<void> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        await p.query(
          `INSERT INTO sre_zero_messages
           (id, channel, sender_uid, sender_name, sender_role, recipient_uid, recipient_name, content, source, scope, shared_to_incident, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO UPDATE SET
           shared_to_incident = EXCLUDED.shared_to_incident`,
          [
            message.id,
            key,
            message.senderUid,
            message.senderName,
            message.senderRole,
            message.recipientUid || null,
            message.recipientName || null,
            message.content,
            message.source,
            message.scope,
            message.sharedToIncident,
            message.timestamp,
          ]
        );
        return;
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL saveMessage error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, IncidentMessageRecord[]>>(MESSAGES_FILE, {});
    if (!all[key]) all[key] = [];
    all[key].push(message);
    writeJsonFile(MESSAGES_FILE, all);
  }

  static async shareDirectMessageToIncident(channel: string, messageId: string, sharedBy: string): Promise<IncidentMessageRecord | null> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        const res = await p.query(
          `UPDATE sre_zero_messages
           SET shared_to_incident = TRUE
           WHERE channel = $1 AND id = $2
           RETURNING id, channel, sender_uid AS "senderUid", sender_name AS "senderName", sender_role AS "senderRole",
                     recipient_uid AS "recipientUid", recipient_name AS "recipientName", content, source, scope,
                     shared_to_incident AS "sharedToIncident", timestamp`,
          [key, messageId]
        );
        if (res.rows.length > 0) {
          const msg = res.rows[0] as IncidentMessageRecord;
          msg.sharedAt = new Date().toISOString();
          msg.sharedBy = sharedBy;
          return msg;
        }
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL shareDirectMessage error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, IncidentMessageRecord[]>>(MESSAGES_FILE, {});
    const list = all[key] || [];
    const msg = list.find((m) => m.id === messageId);
    if (!msg) return null;

    msg.sharedToIncident = true;
    msg.sharedAt = new Date().toISOString();
    msg.sharedBy = sharedBy;
    writeJsonFile(MESSAGES_FILE, all);
    return msg;
  }

  // ── Decision Packets ──
  static async getDecisionPackets(channel: string): Promise<DecisionPacketRecord[]> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        const res = await p.query(
          'SELECT data FROM sre_zero_decision_packets WHERE channel = $1 ORDER BY created_at ASC',
          [key]
        );
        return res.rows.map((r) => r.data as DecisionPacketRecord);
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL getDecisionPackets error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, DecisionPacketRecord[]>>(DECISION_PACKETS_FILE, {});
    return all[key] || [];
  }

  static async saveDecisionPacket(channel: string, packet: DecisionPacketRecord): Promise<void> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        await p.query(
          `INSERT INTO sre_zero_decision_packets (id, channel, data, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [packet.id, key, JSON.stringify(packet), packet.createdAt]
        );
        return;
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL saveDecisionPacket error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, DecisionPacketRecord[]>>(DECISION_PACKETS_FILE, {});
    if (!all[key]) all[key] = [];
    const idx = all[key].findIndex((p) => p.id === packet.id);
    if (idx >= 0) {
      all[key][idx] = packet;
    } else {
      all[key].push(packet);
    }
    writeJsonFile(DECISION_PACKETS_FILE, all);
  }

  // ── Time Machine Snapshots ──
  static async getTimeMachineSnapshots(channel: string): Promise<TimeMachineSnapshotRecord[]> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        const res = await p.query(
          'SELECT data FROM sre_zero_time_machine WHERE channel = $1 ORDER BY timestamp ASC',
          [key]
        );
        return res.rows.map((r) => r.data as TimeMachineSnapshotRecord);
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL getTimeMachineSnapshots error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, TimeMachineSnapshotRecord[]>>(TIME_MACHINE_FILE, {});
    return all[key] || [];
  }

  static async recordTimeMachineSnapshot(channel: string, snapshot: TimeMachineSnapshotRecord): Promise<void> {
    const key = channel.trim().toLowerCase() || 'default';
    const p = getPgPool();

    if (p) {
      try {
        await ensurePgTables();
        await p.query(
          `INSERT INTO sre_zero_time_machine (id, channel, data, timestamp)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [snapshot.id, key, JSON.stringify(snapshot), snapshot.timestamp]
        );
        return;
      } catch (err) {
        console.error('[IncidentRepository] PostgreSQL recordTimeMachineSnapshot error:', err);
      }
    }

    // Local file fallback
    const all = readJsonFile<Record<string, TimeMachineSnapshotRecord[]>>(TIME_MACHINE_FILE, {});
    if (!all[key]) all[key] = [];
    all[key].push(snapshot);
    writeJsonFile(TIME_MACHINE_FILE, all);
  }
}
