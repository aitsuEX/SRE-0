const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

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

async function runLiveTest() {
  console.log('========================================================================');
  console.log('STARTING LIVE CROSS-PROCESS MCP / VOICE SYNCHRONIZATION TEST');
  console.log('========================================================================');

  const NGROK_MCP_URL = 'https://aflutter-subdued-refusal.ngrok-free.dev/api/mcp';
  const STATE_FILE = path.join(process.cwd(), '.sre-zero-runtime-target.json');

  console.log('\n--- STEP 1: INITIALIZE BROKEN INCIDENT STATE ---');
  // Initialize state to incident
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        target: 'incident',
        incidentUrl: 'https://httpbin.org/status/500',
        recoveryUrl: 'https://phasebookkk.netlify.app',
        activeUrl: 'https://httpbin.org/status/500',
        updatedAt: new Date().toISOString(),
        pid: process.pid,
        hostname: os.hostname(),
        switchedBy: 'test-init',
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log('State file initialized on disk to: target = "incident", URL = "https://httpbin.org/status/500"');

  console.log('\n--- STEP 2: CALL checkWebsite VIA LIVE PUBLIC NGROK MCP ENDPOINT (BEFORE ROLLBACK) ---');
  const check1 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'check-before-rollback',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });

  const parsed1 = JSON.parse(check1.data?.result?.content?.[0]?.text || '{}');
  console.log('BEFORE ROLLBACK - PUBLIC MCP RESULT:');
  console.log('  MCP HTTP Status:     ', check1.statusCode);
  console.log('  Target Website HTTP: ', parsed1.httpStatus);
  console.log('  Website Status:      ', parsed1.status);
  console.log('  Source URL Hit:      ', parsed1.sourceUrl);
  console.log('  Response Time (ms):  ', parsed1.responseTimeMs);

  if (parsed1.httpStatus !== 500) {
    throw new Error(`Expected HTTP 500 before rollback, but got ${parsed1.httpStatus}`);
  }
  console.log('>>> CONFIRMED: Initial checkWebsite via public ngrok returned HTTP 500 (DOWN) as expected.');

  console.log('\n--- STEP 3: EXECUTE ROLLBACK (SIMULATING WAR ROOM APPROVAL) ---');
  // Update state file to recovery
  const updatedState = {
    target: 'recovery',
    incidentUrl: 'https://httpbin.org/status/500',
    recoveryUrl: 'https://phasebookkk.netlify.app',
    activeUrl: 'https://phasebookkk.netlify.app',
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    switchedBy: 'war-room-approval',
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(updatedState, null, 2), 'utf-8');
  console.log('State file updated on disk to: target = "recovery", activeUrl = "https://phasebookkk.netlify.app"');

  console.log('\n--- STEP 4: CALL checkWebsite AGAIN VIA SAME PUBLIC NGROK MCP ENDPOINT (AFTER ROLLBACK) ---');
  const check2 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'check-after-rollback',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });

  const parsed2 = JSON.parse(check2.data?.result?.content?.[0]?.text || '{}');
  console.log('AFTER ROLLBACK - PUBLIC MCP RESULT:');
  console.log('  MCP HTTP Status:     ', check2.statusCode);
  console.log('  Target Website HTTP: ', parsed2.httpStatus);
  console.log('  Website Status:      ', parsed2.status);
  console.log('  Source URL Hit:      ', parsed2.sourceUrl);
  console.log('  Response Time (ms):  ', parsed2.responseTimeMs);

  if (parsed2.httpStatus !== 200 || parsed2.status !== 'UP') {
    throw new Error(`Expected HTTP 200 / UP after rollback, but got ${parsed2.httpStatus} / ${parsed2.status}`);
  }
  console.log('>>> CONFIRMED: Subsequent checkWebsite via public ngrok returned HTTP 200 (UP) successfully!');

  console.log('\n========================================================================');
  console.log('ALL CROSS-PROCESS CHECKS VIA LIVE PUBLIC NGROK MCP ENDPOINT PASSED!');
  console.log('========================================================================');
}

runLiveTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
