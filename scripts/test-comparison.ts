import fs from 'fs';
import path from 'path';

// Load .env.local into process.env
try {
  const envFile = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

import { resetWebsiteTarget, getActiveWebsiteUrl } from '../lib/runtime-website-target';
import { checkWebsite } from '../lib/adapters/website';
import { checkMonitoring } from '../lib/adapters/monitoring';
import { verifyRecovery } from '../lib/incident/recovery';
import { injectPhasebookFailure } from '../lib/simulator/phasebook';

async function runDirectComparison() {
  console.log('==============================================');
  console.log('STAGE 1: FAILING STATE (BEFORE ROLLBACK)');
  console.log('==============================================');
  resetWebsiteTarget();
  injectPhasebookFailure('5XX_SPIKE');
  console.log('Active URL:', getActiveWebsiteUrl());

  // A. Direct Website Check
  const directWeb1 = await checkWebsite();
  console.log('A. DIRECT checkWebsite():', directWeb1.httpStatus, directWeb1.status, `(URL: ${directWeb1.sourceUrl})`);

  // B. Phasebook Health Route directly
  const healthRoute1 = await fetch('http://localhost:3002/api/website/health').then(async r => ({ status: r.status, data: await r.json() }));
  console.log('B. DIRECT /api/website/health HTTP:', healthRoute1.status, healthRoute1.data.status);

  // C. MCP checkWebsite tool call
  const mcpWeb1 = await fetch('http://localhost:3002/api/mcp?channel=comp-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'w1', method: 'tools/call', params: { name: 'checkWebsite', arguments: {} } }),
  }).then(r => r.json());
  const mcpWeb1Parsed = JSON.parse(mcpWeb1.result?.content?.[0]?.text || '{}');
  console.log('C. MCP checkWebsite:', mcpWeb1Parsed.httpStatus, mcpWeb1Parsed.status, `(URL: ${mcpWeb1Parsed.sourceUrl})`);

  // D. MCP check_monitoring tool call
  const mcpMon1 = await fetch('http://localhost:3002/api/mcp?channel=comp-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'm1', method: 'tools/call', params: { name: 'check_monitoring', arguments: { metric: 'cpu' } } }),
  }).then(r => r.json());
  const mcpMon1Parsed = JSON.parse(mcpMon1.result?.content?.[0]?.text || '{}');
  console.log('D. MCP check_monitoring:', mcpMon1Parsed.status, mcpMon1Parsed.metrics);

  console.log('\n==============================================');
  console.log('STAGE 2: VERIFY RECOVERY (read-only; SRE-Zero performs no remediation itself)');
  console.log('==============================================');
  const recResult = await verifyRecovery('comp-test');
  console.log('Recovery verification result:', { resolved: recResult.resolved, websiteStatus: recResult.results[0].status, monitoringStatus: recResult.results[1].status });

  console.log('\n==============================================');
  console.log('STAGE 3: RECOVERED STATE (AFTER ROLLBACK)');
  console.log('==============================================');
  console.log('Active URL:', getActiveWebsiteUrl());

  // A. Direct Website Check
  const directWeb2 = await checkWebsite();
  console.log('A. DIRECT checkWebsite():', directWeb2.httpStatus, directWeb2.status, `(URL: ${directWeb2.sourceUrl})`);

  // B. Phasebook Health Route directly
  const healthRoute2 = await fetch('http://localhost:3002/api/website/health').then(async r => ({ status: r.status, data: await r.json() }));
  console.log('B. DIRECT /api/website/health HTTP:', healthRoute2.status, healthRoute2.data.status);

  // C. MCP checkWebsite tool call
  const mcpWeb2 = await fetch('http://localhost:3002/api/mcp?channel=comp-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'w2', method: 'tools/call', params: { name: 'checkWebsite', arguments: {} } }),
  }).then(r => r.json());
  const mcpWeb2Parsed = JSON.parse(mcpWeb2.result?.content?.[0]?.text || '{}');
  console.log('C. MCP checkWebsite:', mcpWeb2Parsed.httpStatus, mcpWeb2Parsed.status, `(URL: ${mcpWeb2Parsed.sourceUrl})`);

  // D. MCP check_monitoring tool call
  const mcpMon2 = await fetch('http://localhost:3002/api/mcp?channel=comp-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'm2', method: 'tools/call', params: { name: 'check_monitoring', arguments: { metric: 'service_health' } } }),
  }).then(r => r.json());
  const mcpMon2Parsed = JSON.parse(mcpMon2.result?.content?.[0]?.text || '{}');
  console.log('D. MCP check_monitoring:', mcpMon2Parsed.status, mcpMon2Parsed.metrics);

  console.log('\n>>> SIDE-BY-SIDE COMPARISON: <<<');
  console.log('BEFORE ROLLBACK:');
  console.log('  ACTIVE URL:            ', directWeb1.sourceUrl);
  console.log('  DIRECT WEBSITE:        ', directWeb1.httpStatus, '/', directWeb1.status);
  console.log('  MCP checkWebsite:      ', mcpWeb1Parsed.httpStatus, '/', mcpWeb1Parsed.status);
  console.log('  MCP check_monitoring:  ', mcpMon1Parsed.status);
  console.log('AFTER ROLLBACK:');
  console.log('  ACTIVE URL:            ', directWeb2.sourceUrl);
  console.log('  DIRECT WEBSITE:        ', directWeb2.httpStatus, '/', directWeb2.status);
  console.log('  MCP checkWebsite:      ', mcpWeb2Parsed.httpStatus, '/', mcpWeb2Parsed.status);
  console.log('  MCP check_monitoring:  ', mcpMon2Parsed.status);
  console.log('  verifyRecovery:        ', recResult.resolved ? 'RESOLVED (UP & HEALTHY)' : 'UNRESOLVED');
}

runDirectComparison().catch(console.error);
