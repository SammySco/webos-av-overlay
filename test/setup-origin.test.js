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

// Real LAN request as Firefox sends it, against the module loaded with and without WHATWG URL (the TV's node).
function lanPost(h, origin) {
  let code;
  const req = { method: 'POST', headers: { host: '192.168.253.8:41101', origin, 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 Firefox/131.0' },
    socket: { localAddress: '::ffff:192.168.253.8', remoteAddress: '::ffff:192.168.253.20' } };
  h(req, { writeHead: c => { code = c; }, end() {} }, '/setup/test');
  return code;
}
test('LAN Firefox request passes, also when url.URL is missing or throws', () => {
  const url = require('url');
  const saved = url.URL;
  for (const variant of [saved, undefined, function () { throw new TypeError('URL needs ICU'); }]) {
    url.URL = variant;
    for (const k of Object.keys(require.cache)) if (/runtime[\\/](setup|shared)\.js$/.test(k)) delete require.cache[k];
    const h = require('../runtime/setup.js')({ profiles: {} });
    assert.strictEqual(lanPost(h, 'http://192.168.253.8:41101'), 415);
    assert.strictEqual(lanPost(h, 'http://evil.example'), 403);
    assert.strictEqual(lanPost(h, 'http://192.168.253.9:41101'), 403);
  }
  url.URL = saved;
});
test('origin matching the connected address passes even if Host differs', () => {
  assert.strictEqual(post('http://192.168.253.8:41101', 'lgtv.lan:41101', '::ffff:192.168.253.8'), 415);
});
