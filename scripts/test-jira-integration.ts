import * as fs from 'fs';
import * as path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
} catch (e) {
  console.warn('Could not read .env.local:', e);
}

import { createJiraIssue } from '../lib/adapters/jira';
import { getIncidentState, addIncidentEvidence, addIncidentTimeline } from '../lib/incident/state';
import { addFact } from '../lib/room-registry';

async function runTests() {
  console.log('==================================================');
  console.log('STARTING JIRA INTEGRATION SUITE');
  console.log('==================================================\n');

  const testChannel = `test-jira-${Date.now()}`;
  const state = getIncidentState(testChannel);

  // Setup real incident state items to verify dynamic description generation
  state.incident.name = 'Payment Gateway Degradation';
  state.severity = 'SEV-1';
  state.status = 'ACTIVE';
  state.phase = 'INVESTIGATING';

  state.facts.push({
    id: `fact-1`,
    content: '5xx error rate on /checkout spiked to 48%',
    confidence: 'confirmed',
    source: 'monitoring',
    type: 'fact',
    timestamp: new Date().toISOString(),
  });

  state.hypotheses.push({
    id: 'hyp-1',
    content: 'Release v2.4.1 database migration deadlock',
    status: 'SUPPORTED',
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  state.actions.push({
    id: 'act-1',
    title: 'Prepare hotfix rollback',
    description: 'Prepare hotfix rollback',
    status: 'OPEN',
    priority: 'HIGH',
    createdAt: new Date().toISOString(),
    evidenceIds: [],
    source: 'sre-lead',
    owner: { name: 'Addie' },
  });

  state.decisions.push({
    id: 'dec-1',
    content: 'Halt all non-essential batch jobs',
    confidence: 'confirmed',
    source: 'Addie',
    type: 'decision',
    timestamp: new Date().toISOString(),
  });

  addIncidentEvidence(testChannel, {
    id: 'ev-1',
    type: 'OBSERVATION',
    content: 'Monitoring error rate: 48.2% on checkout service',
    confidence: 'CONFIRMED',
    source: 'MONITORING',
    sourceUrl: 'https://monitoring.internal/checkout',
    recordedAt: new Date().toISOString(),
  });

  // TEST 1: Valid credentials issue creation
  console.log('TEST 1: Creating Jira issue with valid credentials & live incident state...');
  const res1 = await createJiraIssue('[SEV-1] Payment Gateway Degradation', 'Created during incident investigation by SRE-Zero.', { priority: 'High' }, state);
  console.log('Result 1:', JSON.stringify(res1, null, 2));

  if (res1.status !== 'CREATED' || !res1.issueKey || !res1.url) {
    throw new Error(`TEST 1 Failed: Expected status CREATED with issueKey and url, got: ${JSON.stringify(res1)}`);
  }
  console.log(`✅ TEST 1 PASSED: Issue created with key ${res1.issueKey}`);

  // TEST 2: Verify returned issue key and URL format
  console.log('\nTEST 2: Verifying issue key and URL...');
  if (!res1.issueKey.startsWith('KAN-') && !res1.issueKey.startsWith('SAM1-')) {
    throw new Error(`TEST 2 Failed: Unexpected issue key format: ${res1.issueKey}`);
  }
  if (!res1.url.includes('/browse/')) {
    throw new Error(`TEST 2 Failed: URL does not include /browse/: ${res1.url}`);
  }
  console.log(`✅ TEST 2 PASSED: Real issue URL: ${res1.url}`);

  // TEST 3: Fetch the issue back from Jira REST API v3 and verify the description contains the actual incident facts!
  console.log('\nTEST 3: Fetching created issue from Jira REST API v3 to verify actual content...');
  const jiraUrl = (process.env.INCIDENT_JIRA_URL || '').replace(/\/$/, '');
  const email = process.env.INCIDENT_JIRA_EMAIL || '';
  const token = process.env.INCIDENT_JIRA_API_TOKEN || '';
  const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  const fetchRes = await fetch(`${jiraUrl}/rest/api/3/issue/${res1.issueKey}`, {
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
    },
  });

  if (!fetchRes.ok) {
    throw new Error(`TEST 3 Failed: Could not fetch created issue from Jira: HTTP ${fetchRes.status}`);
  }

  const issueData = await fetchRes.json() as any;
  const descString = JSON.stringify(issueData.fields?.description || {});
  console.log('Issue Summary on Jira:', issueData.fields?.summary);
  console.log('ADF Description contains "Payment Gateway Degradation":', descString.includes('Payment Gateway Degradation'));
  console.log('ADF Description contains "5xx error rate on /checkout spiked to 48%":', descString.includes('5xx error rate on /checkout spiked to 48%'));
  console.log('ADF Description contains "Release v2.4.1 database migration deadlock":', descString.includes('Release v2.4.1 database migration deadlock'));

  if (!descString.includes('5xx error rate on /checkout spiked to 48%')) {
    throw new Error('TEST 3 Failed: Issue description in Jira does not contain confirmed incident facts.');
  }
  console.log('✅ TEST 3 PASSED: Verified Jira issue contains real incident state without hardcoded values.');

  // TEST 4: Check incident state recording
  console.log('\nTEST 4: Verifying incident state integration...');
  addIncidentEvidence(testChannel, {
    id: `jira-${Date.now()}`,
    type: 'ACTION',
    content: `Jira issue created: ${res1.issueKey} (${res1.url}) - [SEV-1] Payment Gateway Degradation`,
    confidence: 'CONFIRMED',
    source: 'JIRA',
    sourceUrl: res1.url,
    recordedAt: new Date().toISOString(),
  });
  addIncidentTimeline(testChannel, {
    type: 'jira_created',
    description: `Jira issue ${res1.issueKey} created: [SEV-1] Payment Gateway Degradation`,
    source: 'sre-zero',
  });

  const updatedState = getIncidentState(testChannel);
  const jiraEvidence = updatedState.evidence.find(e => e.source === 'JIRA');
  const jiraTimeline = updatedState.timeline.find(t => t.type === 'jira_created');

  if (!jiraEvidence || jiraEvidence.confidence !== 'CONFIRMED') {
    throw new Error('TEST 4 Failed: JIRA evidence not found or not CONFIRMED in incident state.');
  }
  if (!jiraTimeline || !jiraTimeline.description.includes(res1.issueKey)) {
    throw new Error('TEST 4 Failed: Timeline does not record Jira issue creation.');
  }
  console.log(`✅ TEST 4 PASSED: Incident state correctly recorded Jira evidence and timeline event.`);

  // TEST 5: Break credentials temporarily to verify error handling
  console.log('\nTEST 5: Testing authentication error with broken API token...');
  const originalToken = process.env.INCIDENT_JIRA_API_TOKEN;
  process.env.INCIDENT_JIRA_API_TOKEN = 'INVALID_BROKEN_TOKEN_FOR_TEST';

  const resAuthErr = await createJiraIssue('[SEV-1] Should Fail', 'Testing auth failure', {}, state);
  console.log('Result with invalid token:', JSON.stringify(resAuthErr, null, 2));

  if (resAuthErr.status !== 'AUTHENTICATION_ERROR') {
    throw new Error(`TEST 5 Failed: Expected status AUTHENTICATION_ERROR, got: ${resAuthErr.status}`);
  }
  console.log('✅ TEST 5 PASSED: Correctly caught AUTHENTICATION_ERROR without inventing issues.');

  // TEST 6: Restore credentials and create another issue
  console.log('\nTEST 6: Restoring credentials and creating follow-up issue...');
  process.env.INCIDENT_JIRA_API_TOKEN = originalToken;

  const res6 = await createJiraIssue('[SEV-1] Resolved Incident Follow-up', 'Follow-up ticket after mitigation.', {}, state);
  console.log('Result 6:', JSON.stringify(res6, null, 2));

  if (res6.status !== 'CREATED' || !res6.issueKey) {
    throw new Error(`TEST 6 Failed: Expected status CREATED, got: ${JSON.stringify(res6)}`);
  }
  console.log(`✅ TEST 6 PASSED: Restored credentials successfully created ${res6.issueKey} at ${res6.url}`);

  console.log('\n==================================================');
  console.log('ALL JIRA INTEGRATION TESTS PASSED SUCCESSFULLY!');
  console.log('==================================================');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
