'use strict';
// node --test test/   (Node 18+; the runtime itself stays ES5 for the TV)
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
var denon = require('../runtime/denon.js'), createFake = require('../scripts/fake-denon.js');
var FX = path.join(__dirname, 'fixtures');

test('MV parsing: whole steps, half steps, minimum', function () {
  assert.strictEqual(denon.parseMV('50'), 50);
  assert.strictEqual(denon.parseMV('505'), 50.5);
  assert.strictEqual(denon.parseMV('005'), 0.5);
  assert.strictEqual(denon.parseMV('00'), 0);
  assert.strictEqual(denon.parseMV('99'), 0);
  assert.strictEqual(denon.parseMV('98'), 98);
  assert.strictEqual(denon.parseMV('UP'), null);
  assert.strictEqual(denon.relToDb(33), -47);
  assert.strictEqual(denon.relToDb(80), 0);
  assert.strictEqual(denon.relToDb(98), 18);
});

test('recorded X2400H telnet session', function () {
  var st = denon.newState(), changes = [];
  fs.readFileSync(path.join(FX, 'x2400h-telnet.txt'), 'latin1').split('\r').forEach(function (l) {
    var c = denon.parseLine(st, l); if (c) changes.push(c + '=' + st[c === 'mode' ? 'mode' : c]);
  });
  assert.deepStrictEqual(changes, ['power=on', 'volume=33', 'input=TV', 'mode=DOLBY DIGITAL', 'volume=33.5', 'volume=34', 'mute=true', 'mute=false',
    'input=BD', 'mode=DOLBY D+ +DS', 'mode=STEREO', 'mode=DIRECT', 'input=NET', 'power=standby']); // MUOFF at start equals the default: no change
  assert.strictEqual(st.maxVolume, 86.5, 'MVMAX lines update max, never the volume');
  assert.strictEqual(st.volume, 34);
});

test('status shape matches what the watcher reads from Yamaha', function () {
  var st = denon.newState();
  ['PWON', 'MV335', 'MUOFF', 'SITV', 'MSDOLBY D+ +DS'].forEach(function (l) { denon.parseLine(st, l); });
  var s = denon.toStatus(st);
  assert.strictEqual(s.response_code, 0);
  assert.strictEqual(s.power, 'on');
  assert.deepStrictEqual(s.actual_volume, { mode: 'numeric', value: 33.5, db: -46.5 });
  assert.strictEqual(s.mute, false);
  assert.strictEqual(s.input, 'TV');
  assert.strictEqual(s.sound_program, 'Dolby Digital+ · Dolby Surround');
  denon.parseLine(st, 'PWSTANDBY');
  assert.strictEqual(denon.toStatus(st).power, 'standby');
});

test('friendly names', function () {
  assert.strictEqual(denon.inputName('TV'), 'TV Audio');
  assert.strictEqual(denon.inputName('SAT/CBL'), 'CBL/SAT');
  assert.strictEqual(denon.inputName('NET'), 'HEOS Music');
  assert.strictEqual(denon.inputName('SOMETHING NEW'), 'Something New');
  assert.strictEqual(denon.modeName('DOLBY SURROUND'), 'Dolby Surround');
  assert.strictEqual(denon.modeName('Dolby Surround          '), 'Dolby Surround');
  assert.strictEqual(denon.modeName('MCH STEREO'), 'Multi Ch Stereo');
  assert.strictEqual(denon.modeName('DTS HD MSTR'), 'DTS-HD Master Audio');
});

test('recorded X2400H web API answers', function () {
  var st = denon.parseLiteXml(fs.readFileSync(path.join(FX, 'x2400h-lite.xml'), 'utf8'));
  assert.deepStrictEqual([st.power, st.input, st.volume, st.mute], ['on', 'TV', 33, false]);
  assert.strictEqual(denon.parseSurroundXml(fs.readFileSync(path.join(FX, 'x2400h-surround.xml'), 'utf8')), 'Dolby Surround');
});

function until(cond, ms) {
  return new Promise(function (ok, bad) {
    var t0 = Date.now(), iv = setInterval(function () { if (cond()) { clearInterval(iv); ok(); } else if (Date.now() - t0 > (ms || 3000)) { clearInterval(iv); bad(new Error('timeout')); } }, 20);
  });
}

test('telnet driver against the fake receiver: initial query, push events, reconnect', async function () {
  var fake = createFake(), ports = await new Promise(function (ok) { fake.listen(0, 0, function (t, h) { ok([t, h]); }); });
  var last = null, n = 0;
  var d = denon.createTelnetDriver({ host: '127.0.0.1', port: ports[0], minBackoff: 50, maxBackoff: 200, heartbeatMs: 100 });
  d.on('status', function (s) { last = s; n++; });
  d.start();
  await until(function () { return last && last.sound_program === 'Dolby Digital'; });
  assert.deepStrictEqual(fake.received.slice(0, 6), ['PW?', 'ZM?', 'MV?', 'MU?', 'SI?', 'MS?'], 'only queries are sent');
  assert.strictEqual(last.actual_volume.value, 50);
  fake.apply('MV455');
  await until(function () { return last.actual_volume.value === 45.5; });
  assert.strictEqual(last.actual_volume.db, -34.5);
  fake.apply('MUON'); await until(function () { return last.mute === true; });
  fake.apply('SIBD'); await until(function () { return last.input === 'BD'; });
  // second client is refused while the driver holds the slot (like HA vs the overlay)
  var other = require('net').createConnection({ host: '127.0.0.1', port: ports[0] });
  await new Promise(function (ok) { other.on('close', ok); other.on('error', ok); });
  assert.ok(d.connected());
  // drop the connection: the driver reconnects and re-queries
  var before = fake.received.length;
  fake.close();
  var fake2 = createFake(); fake2.state.MV = '40';
  await new Promise(function (ok) { fake2.listen(ports[0], 0, ok); });
  await until(function () { return last.actual_volume.value === 40; }, 4000);
  assert.ok(fake2.received.indexOf('MV?') >= 0);
  // heartbeat keeps statuses coming while nothing changes
  var k = n; await new Promise(function (ok) { setTimeout(ok, 350); }); assert.ok(n > k);
  d.stop(); fake2.close();
  assert.ok(before > 0);
});

test('http driver against the fake receiver', async function () {
  var fake = createFake(), ports = await new Promise(function (ok) { fake.listen(0, 0, function (t, h) { ok([t, h]); }); });
  var last = null;
  var d = denon.createHttpDriver({ host: '127.0.0.1', port: ports[1], pollMs: 50, modePollMs: 50 });
  d.on('status', function (s) { last = s; });
  d.start();
  await until(function () { return last && last.sound_program === 'Dolby Digital' && last.actual_volume; });
  assert.strictEqual(last.actual_volume.value, 50);
  fake.apply('MV335'); fake.apply('MSSTEREO'); fake.apply('MUON');
  await until(function () { return last.actual_volume.value === 33.5 && last.sound_program === 'Stereo' && last.mute; });
  assert.strictEqual(fake.hasClient(), false, 'the HTTP driver never touches the telnet slot');
  var info = await new Promise(function (ok, bad) { denon.testReceiver('127.0.0.1', ports[1], function (e, i) { e ? bad(e) : ok(i); }); });
  assert.match(info.version, /on, TV Audio/);
  d.stop(); fake.close();
});
