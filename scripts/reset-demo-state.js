const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

function getCandidateTargetFiles() {
  const list = [
    path.join(process.cwd(), '.sre-zero-runtime-target.json'),
    path.join(os.homedir(), '.sre-zero-runtime-target.json'),
    path.join(os.tmpdir(), 'sre-zero-runtime-target.json'),
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\submission ready\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-runtime-target.json',
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\claude\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-runtime-target.json',
  ];
  return Array.from(new Set(list));
}

function getCandidatePhasebookFiles() {
  const list = [
    path.join(process.cwd(), '.sre-zero-phasebook-simulator.json'),
    path.join(os.homedir(), '.sre-zero-phasebook-simulator.json'),
    path.join(os.tmpdir(), 'sre-zero-phasebook-simulator.json'),
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\submission ready\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-phasebook-simulator.json',
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\claude\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-phasebook-simulator.json',
  ];
  return Array.from(new Set(list));
}

const FAILING_PHASEBOOK_STATE = {
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

function resetAllPersistedStateToIncident(reason = 'demo-reset') {
  const targetFiles = getCandidateTargetFiles();
  const phasebookFiles = getCandidatePhasebookFiles();

  const runtimeTargetState = {
    target: 'incident',
    incidentUrl: 'https://httpbin.org/status/500',
    recoveryUrl: 'https://phasebookkk.netlify.app',
    activeUrl: 'https://httpbin.org/status/500',
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    switchedBy: reason,
  };

  const updatedTargetPaths = [];
  for (const f of targetFiles) {
    try {
      const dir = path.dirname(f);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify(runtimeTargetState, null, 2), 'utf-8');
      updatedTargetPaths.push(f);
    } catch (err) {
      console.warn(`[Reset] Could not write to ${f}:`, err.message);
    }
  }

  const updatedPhasebookPaths = [];
  for (const f of phasebookFiles) {
    try {
      const dir = path.dirname(f);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ ...FAILING_PHASEBOOK_STATE, lastUpdated: new Date().toISOString() }, null, 2), 'utf-8');
      updatedPhasebookPaths.push(f);
    } catch (err) {
      console.warn(`[Reset] Could not write to ${f}:`, err.message);
    }
  }

  return {
    runtimeTargetState,
    updatedTargetPaths,
    updatedPhasebookPaths,
  };
}

async function postJson(urlStr, data) {
  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'ngrok-skip-browser-warning': 'true',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(body), raw: body });
          } catch {
            resolve({ statusCode: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('================================================================================');
  console.log('RESETTING PERSISTED DEMO STATE TO BROKEN INCIDENT STATE');
  console.log('================================================================================');

  const NGROK_MCP_URL = 'https://aflutter-subdued-refusal.ngrok-free.dev/api/mcp?channel=demo-reset-test';
  const LOCAL_APPROVALS_URL = 'http://localhost:3002/api/approvals';
  const LOCAL_MCP_URL = 'http://localhost:3002/api/mcp?channel=demo-reset-test';

  const resetResult = resetAllPersistedStateToIncident('initial-reset');

  console.log('\nDIAGNOSTICS:');
  console.log('  Process PID:       ', process.pid);
  console.log('  Hostname:          ', os.hostname());
  console.log('  Working Directory: ', process.cwd());
  console.log('  Active Target:     ', resetResult.runtimeTargetState.target);
  console.log('  Active URL:        ', resetResult.runtimeTargetState.activeUrl);
  console.log('  Incident URL:      ', resetResult.runtimeTargetState.incidentUrl);
  console.log('  Recovery URL:      ', resetResult.runtimeTargetState.recoveryUrl);
  console.log('  Persisted Target Files:   ');
  resetResult.updatedTargetPaths.forEach((p) => console.log('   - Target State:   ', p));
  console.log('  Persisted Phasebook Files:');
  resetResult.updatedPhasebookPaths.forEach((p) => console.log('   - Phasebook State:', p));

  console.log('\n--------------------------------------------------------------------------------');
  console.log('STEP 1: VERIFY INITIAL checkWebsite CALL VIA PUBLIC NGROK MCP ENDPOINT');
  console.log('--------------------------------------------------------------------------------');

  const check1 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'verify-1',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });
  const web1 = JSON.parse(check1.data?.result?.content?.[0]?.text || '{}');
  console.log('Public Ngrok checkWebsite (INITIAL):', {
    mcpStatusCode: check1.statusCode,
    httpStatus: web1.httpStatus,
    status: web1.status,
    sourceUrl: web1.sourceUrl,
    responseTimeMs: web1.responseTimeMs,
  });

  if (web1.httpStatus !== 500 || web1.status !== 'DOWN') {
    throw new Error(`Expected initial checkWebsite to return HTTP 500 / DOWN, but got ${web1.httpStatus} / ${web1.status}`);
  }
  console.log('>>> [OK] Step 1 Confirmed: Public Ngrok returns HTTP 500 / DOWN from incident URL.');

  console.log('\n--------------------------------------------------------------------------------');
  console.log('STEP 2: REQUEST APPROVAL FOR ROLLBACK VIA MCP');
  console.log('--------------------------------------------------------------------------------');

  const reqApproval = await postJson(LOCAL_MCP_URL, {
    jsonrpc: '2.0',
    id: 'app-req-1',
    method: 'tools/call',
    params: {
      name: 'request_approval',
      arguments: {
        action: 'rollback',
        target: 'v1.1.0-stable',
        reason: 'Rollback to v1.1.0-stable to resolve HTTP 500 outage',
      },
    },
  });
  const parsedApproval = JSON.parse(reqApproval.data?.result?.content?.[0]?.text || '{}');
  console.log('Rollback Approval Request Created:', {
    id: parsedApproval.id,
    action: parsedApproval.action,
    status: parsedApproval.status,
  });

  if (parsedApproval.status !== 'pending') {
    throw new Error(`Expected approval status to be 'pending', got ${parsedApproval.status}`);
  }
  console.log('>>> [OK] Step 2 Confirmed: Approval request is pending.');

  console.log('\n--------------------------------------------------------------------------------');
  console.log('STEP 3: EXECUTE APPROVAL IN WAR ROOM (SIMULATING HUMAN APPROVAL)');
  console.log('--------------------------------------------------------------------------------');

  const approvalRes = await postJson(LOCAL_APPROVALS_URL, {
    id: parsedApproval.id,
    decision: 'approved',
    decidedBy: 'Lead SRE (War Room UI)',
    channel: 'demo-reset-test',
  });
  console.log('War Room Approval API Result:', {
    status: approvalRes.statusCode,
    approvalStatus: approvalRes.data?.approval?.status,
    recoveryResolved: approvalRes.data?.recovery?.resolved,
  });

  if (!approvalRes.data?.recovery?.resolved) {
    throw new Error('Approval execution failed or recovery check did not resolve.');
  }
  console.log('>>> [OK] Step 3 Confirmed: Rollback executed and recovery verification resolved.');

  console.log('\n--------------------------------------------------------------------------------');
  console.log('STEP 4: VERIFY checkWebsite AFTER ROLLBACK VIA PUBLIC NGROK MCP ENDPOINT');
  console.log('--------------------------------------------------------------------------------');

  const check2 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'verify-2',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });
  const web2 = JSON.parse(check2.data?.result?.content?.[0]?.text || '{}');
  console.log('Public Ngrok checkWebsite (AFTER ROLLBACK):', {
    mcpStatusCode: check2.statusCode,
    httpStatus: web2.httpStatus,
    status: web2.status,
    sourceUrl: web2.sourceUrl,
    responseTimeMs: web2.responseTimeMs,
  });

  if (web2.httpStatus !== 200 || web2.status !== 'UP') {
    throw new Error(`Expected post-rollback checkWebsite to return HTTP 200 / UP, but got ${web2.httpStatus} / ${web2.status}`);
  }
  console.log('>>> [OK] Step 4 Confirmed: Public Ngrok returns HTTP 200 / UP from recovery URL.');

  console.log('\n--------------------------------------------------------------------------------');
  console.log('STEP 5: RESET PERSISTED STATE BACK TO INCIDENT SO LIVE DEMO STARTS AT HTTP 500');
  console.log('--------------------------------------------------------------------------------');

  const finalReset = resetAllPersistedStateToIncident('final-demo-ready-state');
  console.log('Persisted state reset to INCIDENT across all shared files:');
  console.log('  Active Target:', finalReset.runtimeTargetState.target);
  console.log('  Active URL:   ', finalReset.runtimeTargetState.activeUrl);

  const checkFinal = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'verify-final',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });
  const webFinal = JSON.parse(checkFinal.data?.result?.content?.[0]?.text || '{}');
  console.log('Public Ngrok checkWebsite (FINAL DEMO-READY STATE):', {
    mcpStatusCode: checkFinal.statusCode,
    httpStatus: webFinal.httpStatus,
    status: webFinal.status,
    sourceUrl: webFinal.sourceUrl,
    responseTimeMs: webFinal.responseTimeMs,
  });

  if (webFinal.httpStatus !== 500 || webFinal.status !== 'DOWN') {
    throw new Error(`Expected final demo-ready state to return HTTP 500 / DOWN, but got ${webFinal.httpStatus}`);
  }

  console.log('\n================================================================================');
  console.log('DEMO IS NOW OFFICIALLY READY: STARTS AT HTTP 500 (DOWN) ON PUBLIC NGROK!');
  console.log('================================================================================');
}

main().catch((err) => {
  console.error('SCRIPT FAILED:', err);
  process.exit(1);
});
