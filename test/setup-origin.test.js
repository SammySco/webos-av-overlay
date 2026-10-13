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

test('Plex/Jellyfin URL validation works without WHATWG URL', async () => {
  const url = require('url'); const savedU = url.URL, savedG = global.URL;
  for (const variant of [undefined, function () { throw new TypeError('no ICU'); }]) {
    url.URL = variant; global.URL = variant;
    for (const k of Object.keys(require.cache)) if (/runtime[\\/](setup|shared)\.js$/.test(k)) delete require.cache[k];
    const shared = require('../runtime/shared.js');
    const p = shared.parseUrl('https://proxjf.codefarm.eu');
    assert.strictEqual(p.protocol, 'https:'); assert.strictEqual(p.hostname, 'proxjf.codefarm.eu'); assert.strictEqual(p.path, '/');
    assert.strictEqual(shared.parseUrl('http://192.168.1.5:32400/x?a=1').port, '32400');
    assert.throws(() => shared.parseUrl('proxjf.codefarm.eu'));
    let code, body = '';
    const h = require('../runtime/setup.js')({ profiles: {}, applySettings: () => ({}) });
    const req = new (require('stream').PassThrough)();
    Object.assign(req, { method: 'POST', url: '/setup/save', headers: { host: '192.168.253.8:41101', 'content-type': 'application/json' }, socket: { localAddress: '192.168.253.8' } });
    h(req, { writeHead: c => { code = c; }, end(b) { body = String(b); } }, '/setup/save');
    req.end(JSON.stringify({ jellyfinUrl: 'https://proxjf.codefarm.eu' }));
    await new Promise(r => setTimeout(r, 20));
    assert.ok(body, 'save answered'); assert.doesNotMatch(body, /Jellyfin URL must start/);
  }
  url.URL = savedU; global.URL = savedG;
});

test('Jellyfin requests use Authorization: MediaBrowser Token=..., no legacy headers', async () => {
  const http = require('http');
  let seen;
  const srv = http.createServer((q, r) => { seen = q.headers; const ok = /^MediaBrowser .*Token="k3y"/.test(q.headers.authorization || '');
    r.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' }); r.end(ok ? '[{"NowPlayingItem":{}},{}]' : '{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  for (const k of Object.keys(require.cache)) if (/runtime[\\/](setup|shared)\.js$/.test(k)) delete require.cache[k];
  const h = require('../runtime/setup.js')({ profiles: {}, getJellyfinSecret: () => null });
  const req = new (require('stream').PassThrough)();
  Object.assign(req, { method: 'POST', url: '/setup/test', headers: { host: 'x:41101', 'content-type': 'application/json' }, socket: {} });
  let body = '';
  const done = new Promise(r => h(req, { writeHead() {}, end(b) { body = String(b); r(); } }, '/setup/test'));
  req.end(JSON.stringify({ kind: 'jellyfin', url: base, apiKey: 'k3y' }));
  await done; srv.close();
  assert.deepStrictEqual(JSON.parse(body), { ok: true, sessions: 1 });
  assert.ok(!seen['x-emby-token'] && !seen['x-mediabrowser-token']);
  assert.match(require('fs').readFileSync(require('path').join(__dirname, '../runtime/watcher.js'), 'utf8'), /shared\.jellyfinAuth\(cfg\.apiKey\)/);
});

test('Jellyfin test works on old node: Object.assign removed', async () => {
  const savedA = Object.assign, savedB = Buffer.from;
  const http = require('http');
  const srv = http.createServer((q, r) => { const ok = /Token="k3y"/.test(q.headers.authorization || ''); r.writeHead(ok ? 200 : 401); r.end(ok ? '[]' : '{}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  for (const k of Object.keys(require.cache)) if (/runtime[\\/](setup|shared)\.js$/.test(k)) delete require.cache[k];
  const h = require('../runtime/setup.js')({ profiles: {}, getJellyfinSecret: () => null });
  delete Object.assign; // (Buffer.from cannot be removed here: Node 20's own http needs it)
  try {
    const req = new (require('stream').PassThrough)();
    req.method = 'POST'; req.url = '/setup/test'; req.headers = { host: 'x:41101', 'content-type': 'application/json' }; req.socket = {};
    let body = '';
    const done = new Promise(r => h(req, { writeHead() {}, end(b) { body = String(b); r(); } }, '/setup/test'));
    req.end(JSON.stringify({ kind: 'jellyfin', url: base, apiKey: 'k3y' }));
    await done;
    assert.deepStrictEqual(JSON.parse(body), { ok: true, sessions: 0 });
  } finally { Object.assign = savedA; srv.close(); }
});
test('handler errors are reported as 500 with the real message, not "bad json"', async () => {
  for (const k of Object.keys(require.cache)) if (/runtime[\\/](setup|shared)\.js$/.test(k)) delete require.cache[k];
  const h = require('../runtime/setup.js')({ profiles: {}, applySettings: () => { throw new Error('boom'); } });
  const req = new (require('stream').PassThrough)();
  req.method = 'POST'; req.url = '/setup/save'; req.headers = { host: 'x:41101', 'content-type': 'application/json' }; req.socket = {};
  let code, body = '';
  const done = new Promise(r => h(req, { writeHead(c) { code = c; }, end(b) { body = String(b); r(); } }, '/setup/save'));
  req.end('{}');
  await done;
  assert.strictEqual(code, 500); assert.match(body, /boom/);
});
test('runtime code avoids ES2015+ APIs missing on old node', () => {
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '../runtime');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Object\.assign\(|=>|\b(let|const) |copyFileSync|recursive: true|\.includes\(|startsWith|padStart/, f);
  }
});
test('Moonfin on the TV: polled and its session picked', () => {
  const shared = require('../runtime/shared.js');
  assert.ok(shared.isJellyfinTvApp('org.moonfin.webos'));
  assert.ok(shared.isJellyfinTvApp('org.jellyfin.webos'));
  assert.ok(!shared.isJellyfinTvApp('netflix'));
  const list = [{ Client: 'Jellyfin Web', DeviceName: 'Firefox', NowPlayingItem: { Id: 'a' } },
    { Client: 'Moonfin', DeviceName: 'LG Smart TV', NowPlayingItem: { Id: 'b' } }, { Client: 'Moonfin', DeviceName: 'x' }];
  assert.strictEqual(shared.pickJellyfinSession(list, {}, true).NowPlayingItem.Id, 'b');
  assert.strictEqual(shared.pickJellyfinSession(list, {}, false).NowPlayingItem.Id, 'a');
  assert.strictEqual(shared.pickJellyfinSession(list, { deviceName: 'firefox' }, true).NowPlayingItem.Id, 'a');
  const w = require('fs').readFileSync(require('path').join(__dirname, '../runtime/watcher.js'), 'utf8');

});
test('Moonfin matched by title and by its real session names; amp input does not matter', () => {
  const shared = require('../runtime/shared.js');
  assert.ok(shared.isJellyfinTvApp('com.some.unknown.id', 'Moonfin'));
  assert.ok(shared.isJellyfinTvApp('x', 'JELLYFIN'));
  assert.ok(!shared.isJellyfinTvApp('com.webos.app.hdmi1', 'HDMI 1'));
  const real = [{ Client: 'Moonfin for webOS', DeviceName: 'LG Smart TV', NowPlayingItem: { Id: 'corridor' } }];
  const other = [{ Client: 'Jellyfin Web', DeviceName: 'Firefox', NowPlayingItem: { Id: 'x' } }];
  // off HDMI (TV Audio / unknown foreground): strict, TV client only
  assert.strictEqual(shared.pickJellyfinSession(real, {}, true, true).NowPlayingItem.Id, 'corridor');
  assert.strictEqual(shared.pickJellyfinSession(other, {}, true, true), null);
  assert.strictEqual(shared.pickJellyfinSession(other.concat(real), {}, true, true).NowPlayingItem.Id, 'corridor');
  // configured device that does not match still falls back to the TV's own client off HDMI
  assert.strictEqual(shared.pickJellyfinSession(real, { deviceName: 'apple tv' }, true, true).NowPlayingItem.Id, 'corridor');
  const w = require('fs').readFileSync(require('path').join(__dirname, '../runtime/watcher.js'), 'utf8');
  assert.doesNotMatch(w, /if \(!onTv && \(!state\.source/); // no source gate any more
  assert.match(w, /log\('foreground app: '/);
});
test('auto info: bitrate/progress/transcode-stat changes do not re-announce; real changes do', () => {
  const shared = require('../runtime/shared.js');
  const s = (kbps, pos, extra) => Object.assign({ Client: 'Moonfin for webOS', DeviceName: 'LG Smart TV',
    PlayState: Object.assign({ PositionTicks: pos, PlayMethod: 'DirectPlay', AudioStreamIndex: 1 }, extra),
    TranscodingInfo: { Bitrate: kbps * 1000, Framerate: 23.9 },
    NowPlayingItem: { Id: 'corridor', MediaStreams: [{ Type: 'Video', Index: 0, Codec: 'hevc', VideoRangeType: 'HDR10' },
      { Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, Language: 'eng', BitRate: kbps * 1000, IsDefault: true },
      { Type: 'Audio', Index: 2, Codec: 'aac', Channels: 2, Language: 'nld' }] } });
  const ann = shared.mediaAnnouncer(30000);
  assert.strictEqual(ann.seen(shared.jellyfinIdentity(s(768, 1)), 1000), true);
  assert.strictEqual(ann.seen(shared.jellyfinIdentity(s(640, 5e7)), 5000), false);   // bitrate + position only
  ann.gone(9000); ann.gone(13000);                                                     // dropped out for a few polls
  assert.strictEqual(ann.seen(shared.jellyfinIdentity(s(900, 9e7)), 17000), false);
  assert.strictEqual(ann.seen(shared.jellyfinIdentity(s(900, 9e7, { AudioStreamIndex: 2 })), 21000), true); // audio track switch
  ann.gone(30000); ann.gone(70000);                                                    // gone for good
  assert.strictEqual(ann.seen(shared.jellyfinIdentity(s(900, 9e7, { AudioStreamIndex: 2 })), 80000), true);
  const p = (br) => ({ ratingKey: '7', title: 'x', Media: [{ bitrate: br, Part: [{ Stream: [{ streamType: 1, codec: 'hevc' }, { streamType: 2, codec: 'truehd', channels: 8, selected: true }] }] }] });
  assert.strictEqual(shared.plexIdentity(p(20000)), shared.plexIdentity(p(18000)));
});
