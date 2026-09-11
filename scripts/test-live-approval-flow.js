const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

function setDiskTarget(target) {
  const candidateFiles = [
    path.join(process.cwd(), '.sre-zero-runtime-target.json'),
    path.join(os.homedir(), '.sre-zero-runtime-target.json'),
    path.join(os.tmpdir(), 'sre-zero-runtime-target.json'),
    'C:\\Users\\aditi\\College academics\\hackathons\\Echosphere\\submission ready\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-runtime-target.json',
    'C:\\Users\\aditi\\College academics\\hackathons\Echosphere\\claude\\SRE-Zero-fixed-transcript-attribution\\.sre-zero-runtime-target.json',
  ];

  const state = {
    target,
    incidentUrl: 'https://httpbin.org/status/500',
    recoveryUrl: 'https://phasebookkk.netlify.app',
    activeUrl: target === 'recovery' ? 'https://phasebookkk.netlify.app' : 'https://httpbin.org/status/500',
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    switchedBy: 'test-runner',
  };

  for (const f of candidateFiles) {
    try {
      fs.writeFileSync(f, JSON.stringify(state, null, 2), 'utf-8');
    } catch {}
  }
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

async function runEndToEndApprovalFlow() {
  console.log('================================================================================');
  console.log('TESTING COMPLETE LIVE WAR ROOM APPROVAL + AGORA VOICE AGENT MCP SYNCHRONIZATION');
  console.log('================================================================================');

  const NGROK_MCP_URL = 'https://aflutter-subdued-refusal.ngrok-free.dev/api/mcp?channel=live-demo-channel';
  const LOCAL_APPROVALS_URL = 'http://localhost:3002/api/approvals';
  const LOCAL_MCP_URL = 'http://localhost:3002/api/mcp?channel=live-demo-channel';

  // 0. Reset to incident state
  console.log('\n[0] Initializing broken incident state on disk across all processes...');
  setDiskTarget('incident');

  // 1. Initial MCP setup: Request approval for rollback
  console.log('\n[1] Voice Agent / Team requests rollback approval...');
  const reqApproval = await postJson(LOCAL_MCP_URL, {
    jsonrpc: '2.0',
    id: 'req-app-1',
    method: 'tools/call',
    params: {
      name: 'request_approval',
      arguments: {
        action: 'rollback',
        target: 'v1.1.0-stable',
        reason: 'Rollback to v1.1.0-stable to resolve HTTP 500 outage on website',
      },
    },
  });
  const parsedApproval = JSON.parse(reqApproval.data?.result?.content?.[0]?.text || '{}');
  const approvalId = parsedApproval.id;
  console.log(`Approval Created: ID=${approvalId}, Status=${parsedApproval.status}, Action=${parsedApproval.action}`);

  // 2. Initial Voice check before rollback
  console.log('\n[2] Voice Agent calls checkWebsite via PUBLIC NGROK (Before Rollback)...');
  const check1 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'voice-check-1',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });
  const web1 = JSON.parse(check1.data?.result?.content?.[0]?.text || '{}');
  console.log('Voice check BEFORE rollback:', {
    httpStatus: web1.httpStatus,
    status: web1.status,
    sourceUrl: web1.sourceUrl,
    responseTimeMs: web1.responseTimeMs,
  });
  if (web1.httpStatus !== 500) {
    throw new Error(`Expected HTTP 500 before rollback, got ${web1.httpStatus}`);
  }
  console.log('>>> VERIFIED: Voice Agent receives real HTTP 500 (DOWN) before rollback.');

  // 3. User clicks "APPROVE ROLLBACK" in War Room UI
  console.log('\n[3] User clicks APPROVE ROLLBACK in War Room UI (/api/approvals)...');
  const approvalRes = await postJson(LOCAL_APPROVALS_URL, {
    id: approvalId,
    decision: 'approved',
    decidedBy: 'Lead SRE (War Room UI)',
    channel: 'live-demo-channel',
  });
  console.log('War Room Approval API Response:', {
    status: approvalRes.statusCode,
    decision: approvalRes.data?.approval?.status,
    recoveryResolved: approvalRes.data?.recovery?.resolved,
    recoveryChecks: approvalRes.data?.recovery?.results?.map((r) => ({
      source: r.source || (r.sourceUrl ? 'WEBSITE' : 'MONITORING'),
      status: r.status,
      httpStatus: r.httpStatus,
    })),
  });

  // 4. Voice Agent calls checkWebsite AGAIN via PUBLIC NGROK
  console.log('\n[4] Voice Agent calls checkWebsite via PUBLIC NGROK (After Rollback)...');
  const check2 = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'voice-check-2',
    method: 'tools/call',
    params: { name: 'checkWebsite', arguments: {} },
  });
  const web2 = JSON.parse(check2.data?.result?.content?.[0]?.text || '{}');
  console.log('Voice check AFTER rollback:', {
    httpStatus: web2.httpStatus,
    status: web2.status,
    sourceUrl: web2.sourceUrl,
    responseTimeMs: web2.responseTimeMs,
  });

  if (web2.httpStatus !== 200 || web2.status !== 'UP') {
    throw new Error(`Expected HTTP 200 / UP after rollback, got ${web2.httpStatus} / ${web2.status}`);
  }
  console.log('>>> VERIFIED: Voice Agent receives real HTTP 200 (UP) after rollback.');

  // 5. Voice Agent checks monitoring
  console.log('\n[5] Voice Agent calls check_monitoring via PUBLIC NGROK (After Rollback)...');
  const checkMon = await postJson(NGROK_MCP_URL, {
    jsonrpc: '2.0',
    id: 'voice-mon-1',
    method: 'tools/call',
    params: { name: 'check_monitoring', arguments: { metric: 'service_health' } },
  });
  const monParsed = JSON.parse(checkMon.data?.result?.content?.[0]?.text || '{}');
  console.log('Monitoring check AFTER rollback:', {
    status: monParsed.status,
    metrics: monParsed.metrics,
  });

  console.log('\n================================================================================');
  console.log('SUCCESS: LIVE WAR ROOM APPROVAL + AGORA VOICE AGENT ARE 100% SYNCHRONIZED!');
  console.log('================================================================================');
}

runEndToEndApprovalFlow().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
