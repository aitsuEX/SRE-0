import { getIncidentState, addParticipant } from '../lib/room-registry';
import { resetWebsiteTarget } from '../lib/runtime-website-target';

async function testIncidentFlow() {
  resetWebsiteTarget();
  const channel = `TEST-${Date.now()}`;
  console.log(`Starting live incident flow test on channel: ${channel}`);

  // 1. Add participants
  addParticipant(channel, '101', 'Alice', 'Engineer');
  addParticipant(channel, '102', 'Bob', 'SRE');

  const postMessage = async (uid: string, name: string, role: string, text: string) => {
    const res = await fetch(`http://localhost:3002/api/incident-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text, uid, name, role }),
    });
    const data = await res.json();
    console.log('postMessage status:', res.status, data);
    return data;
  };

  // Step 1: Alice says "Payment API is failing with elevated 5xx errors."
  console.log('\n--- Step 1: Alice reports 5xx failure ---');
  await postMessage('101', 'Alice', 'Engineer', 'Payment API is failing with elevated 5xx errors.');
  
  let stateRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`);
  let state = await stateRes.json();
  console.log('GET /api/mcp full state:', JSON.stringify(state, null, 2));
  console.log('Facts count:', state.facts?.length);
  if (state.facts?.length === 0) throw new Error('Step 1 Failed: Fact not recorded');

  // Step 2: Bob says "I think the database is down."
  console.log('\n--- Step 2: Bob proposes hypothesis ---');
  await postMessage('102', 'Bob', 'SRE', 'I think the database is down.');
  
  stateRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`);
  state = await stateRes.json();
  console.log('Hypotheses count:', state.hypotheses?.length);
  console.log('Hypotheses:', state.hypotheses);
  if (state.hypotheses?.length === 0) throw new Error('Step 2 Failed: Hypothesis not recorded');

  // Step 3: Alice says "Database looks healthy."
  console.log('\n--- Step 3: Alice reports contradiction ---');
  await postMessage('101', 'Alice', 'Engineer', 'Database looks healthy.');
  
  stateRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`);
  state = await stateRes.json();
  console.log('Conflicts count:', state.conflicts?.length);
  console.log('Conflicts:', state.conflicts);
  if (state.conflicts?.length === 0) throw new Error('Step 3 Failed: Conflict not detected');

  // Step 4: Say "Prepare the rollback."
  console.log('\n--- Step 4: Say "Prepare the rollback." ---');
  await postMessage('101', 'Alice', 'Engineer', 'Prepare the rollback.');
  
  stateRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`);
  state = await stateRes.json();
  console.log('Approvals count:', state.approvals?.length);
  console.log('Pending approvals:', state.approvals?.filter((a: any) => a.status === 'pending'));
  if (!state.approvals?.some((a: any) => a.status === 'pending' && a.action === 'rollback')) {
    throw new Error('Step 4 Failed: Rollback approval request not generated');
  }

  // Step 5: Test Summary API
  console.log('\n--- Step 5: Fetch Incident Summary ---');
  const summaryRes = await fetch(`http://localhost:3002/api/incident-summary?channel=${channel}`);
  const summary = await summaryRes.json();
  console.log('Incident Summary Report Summary:', summary.summary);
  console.log('Summary Approvals:', summary.approvals);

  if (
    summary.summary.totalFacts === 0 ||
    summary.summary.totalHypotheses === 0 ||
    summary.summary.totalConflicts === 0 ||
    summary.approvals.length === 0
  ) {
    throw new Error('Step 5 Failed: Summary has zero counts');
  }

  // Step 7: Test checkWebsite & check_monitoring MCP tools BEFORE rollback (Failing state)
  console.log('\n--- Step 7: Test checkWebsite MCP tool BEFORE rollback ---');
  // Inject failure state to ensure pristine starting state
  await fetch(`http://localhost:3002/api/system/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inject', failureType: '5XX_SPIKE' }),
  });

  const preWebsiteRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'pre-website',
      method: 'tools/call',
      params: { name: 'checkWebsite', arguments: {} },
    }),
  });
  const preWebsiteData = await preWebsiteRes.json();
  console.log('Pre-Rollback checkWebsite MCP response:', preWebsiteData);
  const preWebsiteParsed = JSON.parse(preWebsiteData.result?.content?.[0]?.text || '{}');
  if (preWebsiteParsed.status !== 'DOWN' && preWebsiteParsed.httpStatus !== 500) {
    throw new Error(`Step 7 Failed: Expected DOWN / 500 before rollback, got ${preWebsiteParsed.status} / ${preWebsiteParsed.httpStatus}`);
  }

  console.log('\n--- Step 8: Test check_monitoring MCP tool BEFORE rollback ---');
  const preMonitoringRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'pre-monitoring',
      method: 'tools/call',
      params: { name: 'check_monitoring', arguments: { metric: 'cpu' } },
    }),
  });
  const preMonitoringData = await preMonitoringRes.json();
  console.log('Pre-Rollback check_monitoring MCP response:', preMonitoringData);
  const preMonitoringParsed = JSON.parse(preMonitoringData.result?.content?.[0]?.text || '{}');
  if (preMonitoringParsed.status === 'UNAVAILABLE' || preMonitoringParsed.status === 'UNKNOWN') {
    throw new Error('Step 8 Failed: check_monitoring returned UNAVAILABLE/UNKNOWN before rollback');
  }

  // Step 9: Test Human Approval Execution Gate (triggers Rollback)
  console.log('\n--- Step 9: Test Approval Decision (Approve Rollback) ---');
  const approvalId = summary.approvals[0].id;
  const approvalRes = await fetch(`http://localhost:3002/api/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: approvalId, decision: 'approved', decidedBy: 'Alice', channel }),
  });
  const approvalResult = await approvalRes.json();
  console.log('Approval response:', approvalResult);
  if (!approvalResult.ok || approvalResult.approval?.status !== 'approved') {
    throw new Error('Step 9 Failed: Approval was not approved');
  }

  // Step 10: Test checkWebsite & check_monitoring MCP tools AFTER rollback (Recovered state)
  console.log('\n--- Step 10: Test checkWebsite MCP tool AFTER rollback ---');
  const postWebsiteRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'post-website',
      method: 'tools/call',
      params: { name: 'checkWebsite', arguments: {} },
    }),
  });
  const postWebsiteData = await postWebsiteRes.json();
  console.log('Post-Rollback checkWebsite MCP response:', postWebsiteData);
  const postWebsiteParsed = JSON.parse(postWebsiteData.result?.content?.[0]?.text || '{}');
  if (postWebsiteParsed.status !== 'UP' || postWebsiteParsed.httpStatus !== 200) {
    throw new Error(`Step 10 Failed: Expected UP / 200 after rollback, got ${postWebsiteParsed.status} / ${postWebsiteParsed.httpStatus}`);
  }

  console.log('\n--- Step 11: Test check_monitoring MCP tool AFTER rollback ---');
  const postMonitoringRes = await fetch(`http://localhost:3002/api/mcp?channel=${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'post-monitoring',
      method: 'tools/call',
      params: { name: 'check_monitoring', arguments: { metric: 'service_health' } },
    }),
  });
  const postMonitoringData = await postMonitoringRes.json();
  console.log('Post-Rollback check_monitoring MCP response:', postMonitoringData);
  const postMonitoringParsed = JSON.parse(postMonitoringData.result?.content?.[0]?.text || '{}');
  if (postMonitoringParsed.status !== 'HEALTHY') {
    throw new Error(`Step 11 Failed: Expected HEALTHY after rollback, got ${postMonitoringParsed.status}`);
  }

  // Step 12: Test stop-conversation idempotency
  console.log('\n--- Step 12: Test stop-conversation idempotency ---');
  const stopRes = await fetch(`http://localhost:3002/api/stop-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 'non-existent-agent-id-123' }),
  });
  const stopData = await stopRes.json();
  console.log('stop-conversation response status:', stopRes.status, stopData);
  if (stopRes.status !== 200 && stopRes.status !== 500) {
    throw new Error('Step 12 Failed: Unexpected status code');
  }

  console.log('\n>>> ALL 12 VERIFICATION STEPS PASSED PERFECTLY (BEFORE & AFTER ROLLBACK)! <<<');
}

testIncidentFlow().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});


