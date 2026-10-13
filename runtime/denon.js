'use strict';
// Denon / Marantz receiver drivers (tested against the protocol of the AVR-X2400H).
//
// Both drivers keep a small Denon state and hand the watcher a status object in the same shape the Yamaha
// getStatus answer has ({response_code, power, actual_volume, mute, input, sound_program, direct}), so the
// overlay's volume popup, info bar, status pages and change detection work unchanged.
//
//  - 'denon'      : ASCII control protocol on TCP port 23 ("telnet"). Push events, no polling. NOTE: the
//                   X2400H accepts only ONE client on port 23; a second connection is refused or drops the first.
//                   Home Assistant's denonavr integration holds it when "use telnet" is on (its default).
//  - 'denon-http' : polls the web API on port 8080 (formMainZone_MainZoneXmlStatusLite.xml for power, input,
//                   volume and mute, AppCommand.xml GetSurroundModeStatus for the sound mode). Coexists with HA.
//
// Written in ES5 for the old Node on webOS 4.

var net = require('net');
var http = require('http');
var EventEmitter = require('events').EventEmitter;

// SI codes -> friendly names (receivers may be renamed by the user; those names only show via the HTTP driver)
var INPUTS = {
  'TV': 'TV Audio', 'BD': 'Blu-ray', 'DVD': 'DVD', 'SAT/CBL': 'CBL/SAT', 'MPLAY': 'Media Player', 'GAME': 'Game',
  'AUX1': 'AUX1', 'AUX2': 'AUX2', 'CD': 'CD', 'PHONO': 'Phono', 'TUNER': 'Tuner', 'BT': 'Bluetooth',
  'NET': 'HEOS Music', 'USB/IPOD': 'USB', 'USB': 'USB', 'IPD': 'iPod', 'IRP': 'Internet Radio', 'FVP': 'Favourites',
  'SERVER': 'Media Server', 'SPOTIFY': 'Spotify', 'AIRPLAY': 'AirPlay', 'MXPORT': 'M-XPort'
};
// network sources: shown like the Yamaha "amp-local" sources
var NET_INPUTS = ['NET', 'BT', 'USB/IPOD', 'USB', 'IPD', 'IRP', 'FVP', 'SERVER', 'SPOTIFY', 'AIRPLAY', 'TUNER'];

var MODES = {
  'DIRECT': 'Direct', 'PURE DIRECT': 'Pure Direct', 'STEREO': 'Stereo', 'MULTI CH STEREO': 'Multi Ch Stereo',
  'MCH STEREO': 'Multi Ch Stereo', 'MOVIE': 'Movie', 'MUSIC': 'Music', 'GAME': 'Game', 'AUTO': 'Auto',
  'STANDARD': 'Standard', 'NEURAL:X': 'DTS Neural:X', 'DOLBY SURROUND': 'Dolby Surround', 'DOLBY ATMOS': 'Dolby Atmos',
  'DOLBY DIGITAL': 'Dolby Digital', 'DOLBY D+': 'Dolby Digital+', 'DOLBY D+ +DS': 'Dolby Digital+ · Dolby Surround',
  'DOLBY D+ +NEURAL:X': 'Dolby Digital+ · Neural:X', 'DOLBY D +DS': 'Dolby Digital · Dolby Surround',
  'DOLBY D +NEURAL:X': 'Dolby Digital · Neural:X', 'DOLBY HD': 'Dolby TrueHD', 'DOLBY HD+DS': 'Dolby TrueHD · Dolby Surround',
  'DOLBY TRUEHD': 'Dolby TrueHD', 'DTS SURROUND': 'DTS Surround', 'DTS ES DSCRT6.1': 'DTS-ES Discrete 6.1',
  'DTS ES MTRX6.1': 'DTS-ES Matrix 6.1', 'DTS+DS': 'DTS · Dolby Surround', 'DTS+NEURAL:X': 'DTS · Neural:X',
  'DTS HD': 'DTS-HD', 'DTS HD MSTR': 'DTS-HD Master Audio', 'DTS HD+DS': 'DTS-HD · Dolby Surround', 'DTS:X': 'DTS:X',
  'DTS:X MSTR': 'DTS:X Master', 'DTS96/24': 'DTS 96/24', 'DTS EXPRESS': 'DTS Express', 'MULTI CH IN': 'Multi Ch In',
  'M CH IN+DS': 'Multi Ch In · Dolby Surround', 'MULTI CH IN 7.1': 'Multi Ch In 7.1', 'M CH IN+NEURAL:X': 'Multi Ch In · Neural:X',
  'ROCK ARENA': 'Rock Arena', 'JAZZ CLUB': 'Jazz Club', 'MONO MOVIE': 'Mono Movie', 'MATRIX': 'Matrix',
  'VIDEO GAME': 'Video Game', 'VIRTUAL': 'Virtual', 'AURO3D': 'Auro-3D', 'AURO2DSURR': 'Auro-2D Surround'
};

function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s/+:-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
function inputName(code) { code = clean(code).toUpperCase(); return code ? (INPUTS[code] || titleCase(code)) : null; }
function modeName(raw) { var m = clean(raw).toUpperCase(); return m ? (MODES[m] || titleCase(m)) : null; }

// "MV50" -> 50, "MV505" -> 50.5, "MV005" -> 0.5, "MV99" -> 0 (Denon uses 99 for "---", i.e. minimum)
function parseMV(raw) {
  raw = clean(raw);
  if (!/^[0-9]{2,3}$/.test(raw)) return null;
  var v = raw.length === 3 ? Number(raw) / 10 : Number(raw);
  if (v === 99) v = 0;
  return v;
}
// relative (0-98) <-> dB: 80 relative = 0 dB
function relToDb(v) { return v - 80; }
function dbToRel(db) { return db + 80; }

// only report once a status is complete (a half-known status would flash a 0 volume)
function ready(st) { return st.power === 'standby' || (st.power === 'on' && st.volume !== null); }
function newState() { return { power: null, volume: null, maxVolume: null, mute: false, input: null, mode: null }; }

// Feed one line (without the trailing \r). Returns the key that changed, or null.
function parseLine(st, line) {
  line = String(line).replace(/[\r\n]+$/, '');
  if (!line) return null;
  if (line.indexOf('MVMAX') === 0) { var mx = parseMV(line.slice(5)); if (mx !== null) st.maxVolume = mx; return null; }
  if (line.indexOf('MV') === 0) { var v = parseMV(line.slice(2)); if (v === null || v === st.volume) return null; st.volume = v; return 'volume'; }
  if (line === 'MUON' || line === 'MUOFF') { var mu = line === 'MUON'; if (mu === st.mute) return null; st.mute = mu; return 'mute'; }
  if (line === 'PWON' || line === 'PWSTANDBY' || line === 'ZMON' || line === 'ZMOFF') {
    var p = (line === 'PWON' || line === 'ZMON') ? 'on' : 'standby';
    if (p === st.power) return null; st.power = p; return 'power';
  }
  if (line.indexOf('SI') === 0) { var i = clean(line.slice(2)); if (!i || i === st.input) return null; st.input = i; return 'input'; }
  if (line.indexOf('MS') === 0 && line.indexOf('MSQUICK') !== 0 && line.indexOf('MSSMART') !== 0) {
    var m = clean(line.slice(2)); if (!m || m === st.mode) return null; st.mode = m; return 'mode';
  }
  return null;
}

// Yamaha-shaped status for the watcher
function toStatus(st) {
  var mode = st.mode ? clean(st.mode).toUpperCase() : '';
  var direct = mode === 'DIRECT' || mode === 'PURE DIRECT';
  return {
    response_code: 0,
    receiver: 'denon',
    power: st.power === 'standby' ? 'standby' : 'on',
    actual_volume: st.volume === null ? undefined : { mode: 'numeric', value: st.volume, db: relToDb(st.volume) },
    volume: st.volume === null ? 0 : st.volume * 2,
    mute: !!st.mute,
    input: st.input || null,
    sound_program: modeName(st.mode) || '',
    direct: false, // shown through sound_program ("Direct" / "Pure Direct") instead
    pure_direct: direct
  };
}

// ---------- telnet driver ----------
// opts: host, port (23), log, minBackoff (ms), maxBackoff (ms), heartbeatMs, createConnection (tests)
function createTelnetDriver(opts) {
  var em = new EventEmitter(), st = newState(), sock = null, buf = '', stopped = false, settled = false;
  var backoff = opts.minBackoff || 1000, maxBackoff = opts.maxBackoff || 60000, timer = null, hb = null;
  var log = opts.log || function () {};
  var connect = opts.createConnection || net.createConnection;
  function emit() { em.emit('status', toStatus(st)); }
  function schedule() {
    if (stopped || timer) return;
    var wait = backoff; backoff = Math.min(backoff * 2, maxBackoff);
    timer = setTimeout(function () { timer = null; open(); }, wait);
  }
  function open() {
    if (stopped) return;
    buf = '';
    var s = connect({ host: opts.host, port: opts.port || 23 });
    sock = s;
    s.setEncoding && s.setEncoding('latin1');
    s.setKeepAlive && s.setKeepAlive(true, 10000);
    s.setTimeout && s.setTimeout(0);
    s.on('connect', function () {
      log('denon telnet connected to ' + opts.host + ':' + (opts.port || 23));
      backoff = opts.minBackoff || 1000;
      st = newState(); settled = false;
      // hold the first report until all the query answers are in, so the start-up does not look like a sound mode change
      setTimeout(function () { if (sock !== s) return; settled = true; if (ready(st)) emit(); }, opts.settleMs || 700);
      // queries only; the receiver answers and then pushes every change by itself. Spaced: Denon drops commands sent faster than ~50 ms apart.
      ['PW?', 'ZM?', 'MV?', 'MU?', 'SI?', 'MS?'].forEach(function (q, n) { setTimeout(function () { if (sock === s) s.write(q + '\r'); }, n * 80); });
      em.emit('connected');
    });
    s.on('data', function (d) {
      buf += d;
      var parts = buf.split('\r');
      buf = parts.pop();
      if (buf.length > 4096) buf = '';
      var changed = false;
      parts.forEach(function (l) { if (parseLine(st, l.replace(/^\n/, ''))) changed = true; });
      em.emit('alive');
      if (changed && settled && ready(st)) emit();
    });
    s.on('error', function (e) { log('denon telnet error: ' + e.message); });
    s.on('close', function () {
      if (sock === s) sock = null;
      em.emit('disconnected');
      if (!stopped) { log('denon telnet closed (another client may hold the single telnet slot); retrying'); schedule(); }
    });
  }
  // nothing comes over the socket while nothing changes; re-emit so the watcher knows the receiver is still there
  hb = setInterval(function () { if (sock && settled && ready(st)) emit(); }, opts.heartbeatMs || 2000);
  em.start = function () { stopped = false; open(); return em; };
  em.stop = function () { stopped = true; clearInterval(hb); if (timer) clearTimeout(timer); if (sock) { try { sock.destroy(); } catch (e) {} } };
  em.state = function () { return st; };
  em.connected = function () { return !!sock; };
  return em;
}

// ---------- HTTP polling driver ----------
function xmlValue(xml, tag) {
  var m = new RegExp('<' + tag + '>\\s*(?:<value>)?([^<]*)').exec(xml);
  return m ? clean(m[1]) : null;
}
function parseLiteXml(xml, st) {
  st = st || newState();
  var p = xmlValue(xml, 'Power');
  if (p) st.power = /^ON$/i.test(p) ? 'on' : 'standby';
  var i = xmlValue(xml, 'InputFuncSelect');
  if (i) st.input = i;
  var mv = xmlValue(xml, 'MasterVolume');
  if (mv === '--') st.volume = 0;
  else if (mv !== null && mv !== '' && !isNaN(Number(mv))) st.volume = Math.max(0, dbToRel(Number(mv)));
  var mu = xmlValue(xml, 'Mute');
  if (mu) st.mute = /^on$/i.test(mu);
  return st;
}
function parseSurroundXml(xml) { return xmlValue(xml, 'surround'); }
// the web API reports inputs by name ("TV", "Blu-ray", or the user's rename); map names that are SI codes
function httpRequest(o, body, cb) {
  var done = false;
  function fin(e, t) { if (!done) { done = true; cb(e, t); } }
  var req = http.request({ host: o.host, port: o.port, path: o.path, method: body ? 'POST' : 'GET', timeout: o.timeout || 1500,
    headers: body ? { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body) } : {} }, function (res) {
    var t = ''; res.setEncoding('utf8');
    res.on('data', function (c) { t += c; if (t.length > 262144) req.destroy(new Error('response too large')); });
    res.on('end', function () { res.statusCode === 200 ? fin(null, t) : fin(new Error('HTTP ' + res.statusCode)); });
  });
  req.on('timeout', function () { req.destroy(new Error('timeout')); });
  req.on('error', fin);
  if (body) req.write(body);
  req.end();
}
var SURROUND_CMD = '<?xml version="1.0" encoding="utf-8"?>\n<tx>\n<cmd id="1">GetSurroundModeStatus</cmd>\n</tx>';
function createHttpDriver(opts) {
  var em = new EventEmitter(), st = newState(), t1 = null, t2 = null, busy = false, log = opts.log || function () {}, lastErr = null;
  var port = opts.port || 8080;
  function pollMain() {
    if (busy) return; busy = true;
    httpRequest({ host: opts.host, port: port, path: '/goform/formMainZone_MainZoneXmlStatusLite.xml' }, null, function (err, xml) {
      busy = false;
      if (err) { if (err.message !== lastErr) { lastErr = err.message; log('denon http: ' + err.message); } return; }
      lastErr = null;
      parseLiteXml(xml, st);
      em.emit('alive');
      em.emit('status', toStatus(st));
    });
  }
  function pollMode() {
    httpRequest({ host: opts.host, port: port, path: '/goform/AppCommand.xml' }, SURROUND_CMD, function (err, xml) {
      if (err) return;
      var m = parseSurroundXml(xml);
      if (m && m !== st.mode) { st.mode = m; em.emit('status', toStatus(st)); }
    });
  }
  em.start = function () { pollMain(); pollMode(); t1 = setInterval(pollMain, opts.pollMs || 500); t2 = setInterval(pollMode, opts.modePollMs || 3000); return em; };
  em.stop = function () { clearInterval(t1); clearInterval(t2); };
  em.state = function () { return st; };
  return em;
}

// setup page "Test receiver": HTTP only, so it never takes the single telnet slot
function testReceiver(host, port, cb) {
  httpRequest({ host: host, port: port || 8080, path: '/goform/formMainZone_MainZoneXmlStatusLite.xml', timeout: 2500 }, null, function (err, xml) {
    if (err) return cb(err);
    if (!/<MasterVolume>/.test(xml)) return cb(new Error('Something answered, but it is not a Denon/Marantz receiver'));
    var s = parseLiteXml(xml);
    cb(null, { model: 'Denon/Marantz receiver', version: (s.power || '?') + ', ' + (inputName(s.input) || s.input || '?') });
  });
}

module.exports = {
  INPUTS: INPUTS, NET_INPUTS: NET_INPUTS, MODES: MODES, parseMV: parseMV, relToDb: relToDb, dbToRel: dbToRel,
  inputName: inputName, modeName: modeName, newState: newState, parseLine: parseLine, ready: ready, toStatus: toStatus,
  parseLiteXml: parseLiteXml, parseSurroundXml: parseSurroundXml, createTelnetDriver: createTelnetDriver,
  createHttpDriver: createHttpDriver,
  httpGet: function (host, port, path, cb) { httpRequest({ host: host, port: port, path: path, timeout: 3000 }, null, cb); }, testReceiver: testReceiver, DEFAULT_PORTS: { denon: 23, 'denon-http': 8080 }
};
