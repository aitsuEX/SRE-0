const http = require('http');

async function test() {
  const req = http.request('http://localhost:3002/api/system/state', (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('System state status:', res.statusCode);
      console.log('System state body:', body);
    });
  });
  req.end();
}

test();
