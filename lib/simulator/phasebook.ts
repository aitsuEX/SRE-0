import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PhasebookService {
  name: string;
  status: 'RUNNING' | 'DEGRADED' | 'FAILED';
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  cpu: number;
  memory: number;
  latencyMs: number;
  errorRate: number;
  version: string;
  replicas: number;
}

export interface PhasebookSystemState {
  systemHealth: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  currentVersion: string;
  databaseFailure: boolean;
  activeFailureType: 'NONE' | '5XX_SPIKE' | 'DATABASE_CORRUPTION' | 'MEMORY_LEAK';
  selectedFailureTargetService: string;
  services: Record<string, PhasebookService>;
  currentMetrics: {
    timestamp: string;
    errorRate: number;
    requestRate: number;
    cpu: number;
    memory: number;
    latency: number;
    http5xxRate: number;
    dbConnectionErrors: number;
  };
  lastUpdated: string;
}

const FAILING_STATE: PhasebookSystemState = {
  systemHealth: 'UNHEALTHY',
  currentVersion: 'v2.4.1-buggy',
  databaseFailure: true,
  activeFailureType: '5XX_SPIKE',
  selectedFailureTargetService: 'payment-service',
  services: {
    frontend: { name: 'frontend', status: 'DEGRADED', health: 'DEGRADED', cpu: 78, memory: 65, latencyMs: 320, errorRate: 8.5, version: 'v2.4.1', replicas: 3 },
    feed: { name: 'feed', status: 'DEGRADED', health: 'DEGRADED', cpu: 82, memory: 70, latencyMs: 450, errorRate: 9.2, version: 'v2.4.1', replicas: 4 },
    'post-service': { name: 'post-service', status: 'RUNNING', health: 'HEALTHY', cpu: 30, memory: 40, latencyMs: 35, errorRate: 0.1, version: 'v2.4.1', replicas: 3 },
    database: { name: 'database', status: 'DEGRADED', health: 'UNHEALTHY', cpu: 89, memory: 82, latencyMs: 780, errorRate: 14.5, version: 'PostgreSQL 16 (Neon)', replicas: 1 },
    'payment-service': { name: 'payment-service', status: 'FAILED', health: 'UNHEALTHY', cpu: 94, memory: 88, latencyMs: 1200, errorRate: 18.2, version: 'v2.4.1', replicas: 2 },
    'notification-service': { name: 'notification-service', status: 'RUNNING', health: 'HEALTHY', cpu: 25, memory: 35, latencyMs: 40, errorRate: 0.05, version: 'v2.4.1', replicas: 2 },
  },
  currentMetrics: {
    timestamp: new Date().toISOString(),
    errorRate: 14.2,
    requestRate: 1850,
    cpu: 88.5,
    memory: 74.2,
    latency: 820,
    http5xxRate: 12.8,
    dbConnectionErrors: 4,
  },
  lastUpdated: new Date().toISOString(),
};

const RECOVERED_STATE: PhasebookSystemState = {
  systemHealth: 'HEALTHY',
  currentVersion: 'v1.1.0-stable',
  databaseFailure: false,
  activeFailureType: 'NONE',
  selectedFailureTargetService: 'none',
  services: {
    frontend: { name: 'frontend', status: 'RUNNING', health: 'HEALTHY', cpu: 26, memory: 42, latencyMs: 35, errorRate: 0.1, version: 'v1.1.0', replicas: 3 },
    feed: { name: 'feed', status: 'RUNNING', health: 'HEALTHY', cpu: 31, memory: 44, latencyMs: 48, errorRate: 0.15, version: 'v1.1.0', replicas: 4 },
    'post-service': { name: 'post-service', status: 'RUNNING', health: 'HEALTHY', cpu: 24, memory: 38, latencyMs: 29, errorRate: 0.05, version: 'v1.1.0', replicas: 3 },
    database: { name: 'database', status: 'RUNNING', health: 'HEALTHY', cpu: 18, memory: 35, latencyMs: 14, errorRate: 0, version: 'PostgreSQL 16 (Neon)', replicas: 1 },
    'payment-service': { name: 'payment-service', status: 'RUNNING', health: 'HEALTHY', cpu: 18, memory: 32, latencyMs: 65, errorRate: 0.1, version: 'v1.1.0', replicas: 2 },
    'notification-service': { name: 'notification-service', status: 'RUNNING', health: 'HEALTHY', cpu: 22, memory: 36, latencyMs: 38, errorRate: 0.05, version: 'v1.1.0', replicas: 2 },
  },
  currentMetrics: {
    timestamp: new Date().toISOString(),
    errorRate: 0.13,
    requestRate: 1615,
    cpu: 28.3,
    memory: 42.5,
    latency: 42,
    http5xxRate: 0,
    dbConnectionErrors: 0,
  },
  lastUpdated: new Date().toISOString(),
};

function getCandidateStateFiles(): string[] {
  const list = [
    path.join(process.cwd(), '.sre-zero-phasebook-simulator.json'),
    path.join(os.homedir(), '.sre-zero-phasebook-simulator.json'),
    path.join(os.tmpdir(), 'sre-zero-phasebook-simulator.json'),
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\submission ready\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-phasebook-simulator.json',
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\claude\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-phasebook-simulator.json',
  ];
  return Array.from(new Set(list));
}

let memoryPhasebookState: PhasebookSystemState | null = null;

export function loadPhasebookState(): PhasebookSystemState {
  let latestState: PhasebookSystemState | null = null;
  let latestTime = 0;

  for (const filePath of getCandidateStateFiles()) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content && content.trim()) {
          const data = JSON.parse(content) as PhasebookSystemState;
          const time = data.lastUpdated ? Date.parse(data.lastUpdated) : 0;
          if (!latestState || time >= latestTime) {
            latestTime = time;
            latestState = data;
          }
        }
      }
    } catch {}
  }

  if (latestState) {
    memoryPhasebookState = latestState;
    return latestState;
  }

  if (memoryPhasebookState) return memoryPhasebookState;

  const initial = { ...FAILING_STATE, lastUpdated: new Date().toISOString() };
  savePhasebookState(initial);
  return initial;
}

export function savePhasebookState(state: PhasebookSystemState): void {
  memoryPhasebookState = state;
  for (const filePath of getCandidateStateFiles()) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {}
  }
}

export function rollbackPhasebook(): PhasebookSystemState {
  console.log('[Phasebook] Executing ROLLBACK to v1.1.0-stable. Restoring healthy state.');
  const state: PhasebookSystemState = {
    ...RECOVERED_STATE,
    lastUpdated: new Date().toISOString(),
    currentMetrics: {
      ...RECOVERED_STATE.currentMetrics,
      timestamp: new Date().toISOString(),
    },
  };
  savePhasebookState(state);
  return state;
}

export function injectPhasebookFailure(failureType: PhasebookSystemState['activeFailureType'] = '5XX_SPIKE'): PhasebookSystemState {
  console.log(`[Phasebook] Injecting failure: ${failureType}`);
  const state: PhasebookSystemState = {
    ...FAILING_STATE,
    activeFailureType: failureType,
    lastUpdated: new Date().toISOString(),
    currentMetrics: {
      ...FAILING_STATE.currentMetrics,
      timestamp: new Date().toISOString(),
    },
  };
  savePhasebookState(state);
  return state;
}
