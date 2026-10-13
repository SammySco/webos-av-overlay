const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const denon = require('../runtime/denon.js');
const ds = require('../runtime/denon-sound.js');
const createFake = require('../scripts/fake-denon.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('Deviceinfo.xml of the AVR-X2400H: model, genres and inputs', () => {
  const r = ds.parseDeviceInfo(fs.readFileSync(path.join(__dirname, 'fixtures/x2400h-deviceinfo.xml'), 'utf8'));
  assert.strictEqual(r.model, 'AVR-X2400H');
  assert.deepStrictEqual(r.genres, ['MOVIE', 'MUSIC', 'GAME', 'PURE']);
  const tv = r.inputs.find(i => i.value === 'TV');
  assert.deepStrictEqual(tv, { value: 'TV', label: 'TV Audio' });
  assert.ok(r.inputs.find(i => i.value === 'BD' && i.label === 'Blu-ray'));
  assert.ok(ds.modesFor(r.model).includes('AUTO'));
  assert.strictEqual(ds.commandPath('PURE DIRECT'), '/goform/formiPhoneAppDirect.xml?MSPURE%20DIRECT');
});

function setup(fake, webPort, sound, opts) {
  let store = sound;
  const drv = denon.createHttpDriver({ host: '127.0.0.1', port: webPort, pollMs: 50, modePollMs: 5000 }).start();
  const luna = path.join(__dirname, 'fixtures', 'no-luna');
  const profiles = require('../runtime/profiles.js')({
    log: () => {}, luna, ampGet: (p, cb) => cb(new Error('yamaha only')),
    getSound: () => store, setSound: o => { store = o; },
    getPlexApp: () => null, inputLabel: id => denon.inputName(id),
    ampType: () => 'denon-http', denonState: () => drv.state(),
    denonHttp: (p, cb) => denon.httpGet('127.0.0.1', webPort, p, cb)
  });
  drv.on('status', s => profiles.onAmpStatus(s));
  return { drv, profiles };
}

test('Denon surround rules against the fake AVR (HTTP only)', async () => {
  const fake = createFake();
  const ports = await new Promise(r => fake.listen(0, 0, (t, h) => r({ t, h })));
  const sound = { amp: 'denon', enabled: true, tvInput: 'TV', rules: [{ app: 'Live TV', kind: 'input', program: 'MOVIE' }, { app: 'Tuner', kind: 'amp', program: 'STEREO' }] };
  const { drv, profiles } = setup(fake, ports.h, sound);
  try {
    await wait(300);
    // lists: modes from the model table, inputs from Deviceinfo
    const L = await new Promise(r => profiles.lists(r));
    assert.strictEqual(L.amp, 'denon'); assert.strictEqual(L.model, 'AVR-X2400H');
    assert.ok(L.programs.includes('AUTO') && L.inputs.includes('TV') && L.decoders.length === 0);
    // nothing in front on the TV (no luna here): nothing to match, nothing sent
    profiles.applyNow(); await wait(200);
    assert.deepStrictEqual(fake.commands, []);
    // validation: Denon modes and SI codes, tagged as Denon
    const v = profiles.validate({ enabled: true, tvInput: 'TV', default: { program: 'AUTO' }, rules: [{ app: 'Netflix', kind: 'lg', program: 'MOVIE' }] });
    assert.ok(!v.error, v.error); assert.strictEqual(v.value.amp, 'denon');
    assert.ok(profiles.validate({ tvInput: 'TV', rules: [{ app: 'x', program: 'straight' }] }).error); // a Yamaha program is refused
    // a receiver source with a rule applies even off the TV input, the default never does
    fake.apply('SITUNER'); await wait(300);
    assert.strictEqual(profiles.current().key, 'Tuner');
    profiles.applyNow(); await wait(300);
    assert.deepStrictEqual(fake.commands, ['MSSTEREO']);
    assert.strictEqual(fake.state.MS, 'STEREO');
    fake.apply('SIBD'); await wait(300);
    profiles.applyNow(); await wait(300);
    assert.deepStrictEqual(fake.commands, ['MSSTEREO']); // Blu-ray: no rule, default not used on a receiver source
  } finally { drv.stop(); fake.close(); }
});

test('Denon default is Auto unless set to "leave unchanged"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../runtime/profiles.js'), 'utf8');
  assert.match(src, /dn && s\.default === undefined \? \{ program: 'AUTO' \}/);
});

test('reading the current mode and group (real X2400H answers)', () => {
  const FX = path.join(__dirname, 'fixtures');
  assert.strictEqual(denon.parseSurroundXml(fs.readFileSync(path.join(FX, 'x2400h-surround-atmos.xml'), 'utf8')), 'Dolby Atmos');
  assert.strictEqual(denon.parseGenreXml(fs.readFileSync(path.join(FX, 'x2400h-soundmode.xml'), 'utf8')), 'MOVIE');
});

test('only what differs is sent', () => {
  const now = { mode: 'Dolby Atmos', genre: 'MOVIE' };
  assert.deepStrictEqual(ds.commandsFor('MOVIE|DOLBY DIGITAL', now), []);
  assert.deepStrictEqual(ds.commandsFor('MOVIE', now), []);
  assert.deepStrictEqual(ds.commandsFor('MOVIE|MCH STEREO', now), ['MCH STEREO']);
  assert.deepStrictEqual(ds.commandsFor('MUSIC|STEREO', now), ['MUSIC', 'STEREO']);
  assert.deepStrictEqual(ds.commandsFor('PURE|PURE DIRECT', now), ['PURE DIRECT']);
  assert.deepStrictEqual(ds.commandsFor('DOLBY DIGITAL', now), []);           // a 2.5.0 rule (mode only)
  assert.deepStrictEqual(ds.commandsFor('AUTO', now), ['AUTO']);              // Auto is not reported as such
  assert.strictEqual(ds.modeLabel('MOVIE|DOLBY DIGITAL'), 'Movie / Dolby Atmos/Surround');
});

test('grouped rule against the fake AVR: group then mode, nothing when already there', async () => {
  const fake = createFake();
  const ports = await new Promise(r => fake.listen(0, 0, (t, h) => r({ t, h })));
  const sound = { amp: 'denon', enabled: true, tvInput: 'TV', rules: [{ app: 'Tuner', kind: 'amp', program: 'MUSIC|STEREO' }, { app: 'CD', kind: 'amp', program: 'MOVIE|DOLBY DIGITAL' }] };
  let store = sound;
  const drv = denon.createHttpDriver({ host: '127.0.0.1', port: ports.h, pollMs: 50, modePollMs: 100 }).start();
  const profiles = require('../runtime/profiles.js')({
    log: () => {}, luna: '/nonexistent', ampGet: (p, cb) => cb(new Error('x')), getSound: () => store, setSound: o => { store = o; },
    getPlexApp: () => null, inputLabel: id => denon.inputName(id), ampType: () => 'denon-http', denonState: () => drv.state(),
    denonHttp: (p, cb) => denon.httpGet('127.0.0.1', ports.h, p, cb) });
  drv.on('status', s => profiles.onAmpStatus(s));
  try {
    fake.apply('SICD'); await wait(400);
    profiles.applyNow(); await wait(400);
    assert.deepStrictEqual(fake.commands, []);                     // already Movie / Dolby Atmos
    fake.apply('SITUNER'); await wait(400);
    profiles.applyNow(); await wait(1200);
    assert.deepStrictEqual(fake.commands, ['MSMUSIC', 'MSSTEREO']);
    await wait(300);
    profiles.applyNow(); await wait(400);
    assert.deepStrictEqual(fake.commands, ['MSMUSIC', 'MSSTEREO']); // read back: no repeat
  } finally { drv.stop(); fake.close(); }
});
