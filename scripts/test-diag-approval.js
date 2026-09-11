const http = require('http');

async function test() {
  const req = http.request(
    'http://localhost:3002/api/approvals',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Body:', body);
      });
    }
  );

  // First request an approval
  const mcpReq = http.request(
    'http://localhost:3002/api/mcp?channel=test-diag',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    (res) => {
      let mcpBody = '';
      res.on('data', chunk => mcpBody += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(mcpBody);
        const app = JSON.parse(parsed.result.content[0].text);
        console.log('Created approval:', app.id);
        req.write(JSON.stringify({
          id: app.id,
          decision: 'approved',
          decidedBy: 'Admin',
          channel: 'test-diag',
        }));
        req.end();
      });
    }
  );

  mcpReq.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 'req1',
    method: 'tools/call',
    params: { name: 'request_approval', arguments: { action: 'rollback', reason: 'test' } },
  }));
  mcpReq.end();
}

test();
