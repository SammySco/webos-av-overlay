const test = require('node:test');
const assert = require('node:assert');
const createSetup = require('../runtime/setup.js');
const handle = createSetup({ profiles: {} });
function post(origin, host, la) {
  let code;
  const req = { method: 'POST', headers: { host, 'content-type': 'text/plain' }, socket: { localAddress: la || '192.168.253.8' } };
  if (origin !== undefined) req.headers.origin = origin;
  handle(req, { writeHead: c => { code = c; }, end() {} }, '/setup/save');
  return code; // 415 = passed the origin check, 403 = refused
}
test('allowed origins', () => {
  assert.strictEqual(post(undefined, '192.168.253.8:41101'), 415);
  assert.strictEqual(post('null', '192.168.253.8:41101'), 415);
  assert.strictEqual(post('file://', '127.0.0.1:41101'), 415);
  assert.strictEqual(post('http://192.168.253.8:41101', '192.168.253.8:41101'), 415);
  assert.strictEqual(post('http://192.168.253.8', '192.168.253.8:41101'), 415);
  assert.strictEqual(post('http://localhost:41101', '127.0.0.1:41101'), 415);
  assert.strictEqual(post('http://127.0.0.1:41101', '192.168.253.8:41101', '127.0.0.1'), 415);
  assert.strictEqual(post('http://[::1]:41101', 'localhost:41101'), 415);
});
test('foreign origins refused', () => {
  assert.strictEqual(post('http://evil.example', '192.168.253.8:41101'), 403);
  assert.strictEqual(post('http://192.168.253.9:41101', '192.168.253.8:41101'), 403);
  assert.strictEqual(post('http://127.0.0.1:41101', '192.168.253.8:41101'), 403);
  assert.strictEqual(post('garbage', '192.168.253.8:41101'), 403);
});
