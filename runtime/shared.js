'use strict';

// Constants and helpers shared by watcher.js, profiles.js, setup.js and configure.js.

var http = require('http');
var https = require('https');
var fs = require('fs');
var url = require('url');

// The TV's node can be very old (0.12-era): no Object.assign / Buffer.from. Keep runtime code ES5 and use these.
function extend(target) {
  for (var i = 1; i < arguments.length; i++) {
    var s = arguments[i];
    if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) target[k] = s[k];
  }
  return target;
}
function bufferFrom(data, enc) {
  return (Buffer.from && Buffer.from !== Uint8Array.from) ? Buffer.from(data, enc) : new Buffer(data, enc); // eslint-disable-line
}
// The TV's node may lack WHATWG URL (or have it throw without ICU): fall back to the legacy parser.
function parseUrl(s) {
  try { if (url.URL) { var u = new url.URL(s); return { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + u.search }; } } catch (e) { /* fall through */ }
  var p = url.parse(String(s));
  if (!p.protocol || !p.hostname) throw new Error('Invalid URL');
  return { protocol: p.protocol, hostname: p.hostname, port: p.port || '', path: p.path || '/' };
}
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;

// The app version, from appinfo.json next to runtime/ (the TV app folder and the Docker image) or package.json
// (a source checkout); '' when neither can be read.
function readAppVersion() {
  var files = ['appinfo.json', 'package.json'];
  for (var i = 0; i < files.length; i++) {
    try {
      var v = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', files[i]), 'utf8')).version;
      if (typeof v === 'string' && /^[0-9][0-9A-Za-z.+-]{0,30}$/.test(v)) return v;
    } catch (e) { /* try the next file */ }
  }
  return '';
}
var APP_VERSION = readAppVersion();

var ROW_KEYS = ['program', 'source', 'app', 'audio', 'plex', 'jellyfin', 'processing', 'video', 'colour'];
var CORNERS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
var FONT_SIZES = [75, 100, 125, 150];

// GET a URL and parse the body as JSON.  cb(err, json, statusCode); json is null when the body is not JSON.
//   o.url              full URL (a string), or o.host/o.port/o.path/o.protocol
//   o.headers, o.timeout (ms, default 2500), o.maxBytes (default 256 KB)
//   o.verifyTls        https only: verify the certificate (default off, media servers often use self-signed ones)
function getJson(o, cb) {
  var finished = false;
  function done(err, j, code) { if (finished) return; finished = true; cb(err, j, code); }
  var opts;
  try {
    if (o.url) {
      var u = parseUrl(o.url);
      opts = { protocol: u.protocol, host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.path };
    } else {
      opts = { protocol: o.protocol || 'http:', host: o.host, port: o.port, path: o.path };
    }
    opts.headers = o.headers || {};
    opts.timeout = o.timeout || 2500;
    var mod = opts.protocol === 'https:' ? https : http;
    if (opts.protocol === 'https:') { opts.rejectUnauthorized = o.verifyTls === true; if (!/^[\d.:]+$/.test(opts.host)) opts.servername = opts.host; } // explicit SNI for older node
    var max = o.maxBytes || 262144;
    var req = mod.get(opts, function (res) {
      var body = '', size = 0;
      res.setEncoding('utf8');
      res.on('data', function (c) {
        size += c.length;
        if (size > max) { req.destroy(new Error('response too large')); return; }
        body += c;
      });
      res.on('end', function () { var j = null; try { j = JSON.parse(body); } catch (e) {} done(null, j, res.statusCode); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { done(e); });
  } catch (e) { done(e); }
}

// Run luna-send once (it needs a pty on these TVs, hence script(1)); cb(parsedJson | null)
function lunaJson(luna, uri, params, cb) {
  if (typeof params === 'function') { cb = params; params = '{}'; }
  execFile('/usr/bin/script', ['-q', '-c', luna + ' -n 1 -f ' + uri + " '" + (params || '{}') + "'", '/dev/null'], { timeout: 4000 },
    function (err, out) {
      if (err) return cb(null);
      var text = String(out).replace(/\r/g, ''), i = text.indexOf('{');
      try { cb(JSON.parse(text.slice(i))); } catch (e) { cb(null); }
    });
}

// Keep a luna-send subscription running; onJson(obj) gets every message.  Restarts itself when luna-send exits.
// Returns {stop()}.
function lunaSubscribe(luna, uri, params, onJson, log, name) {
  var proc = null, stopped = false;
  function start() {
    var cmd = luna + " -i '" + uri + "' '" + params + "'";
    proc = spawn('/usr/bin/script', ['-q', '-f', '-c', cmd, '/dev/null']);
    var pending = '';
    proc.stdout.on('data', function (chunk) {
      pending += String(chunk);
      var lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(function (line) {
        line = line.replace(/\r/g, '').trim();
        if (line.charAt(0) !== '{') return;
        try { onJson(JSON.parse(line)); } catch (e) { log(name + ' parse error: ' + e.message); }
      });
    });
    proc.on('error', function (e) { log(name + ' subscription failed: ' + e.message); });
    proc.on('exit', function (code) {
      proc = null;
      if (stopped) return;
      log(name + ' subscription ended (' + code + '), restarting in 5s');
      setTimeout(start, 5000);
    });
  }
  start();
  return { stop: function () { stopped = true; try { if (proc) proc.kill(); } catch (e) {} } };
}

// Write a settings file atomically (temp file + rename) with mode 0600, so a crash mid-write cannot leave a truncated file.
function writeFileAtomic(file, text) {
  var tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 384 });
  fs.chmodSync(tmp, 384);
  fs.renameSync(tmp, file);
}

// Jellyfin 10.11+ ignores the legacy X-Emby/X-MediaBrowser token headers: use the Authorization scheme.
function jellyfinAuth(key) {
  return { Authorization: 'MediaBrowser Client="AV Overlay", Device="webOS TV", DeviceId="earc-volume-overlay", Version="1", Token="' + String(key || '').replace(/["\\\r\n]/g, '') + '"' };
}

// Jellyfin clients that run on the TV itself (the source is then not an HDMI input)
var JELLYFIN_TV_APPS = /^(org\.moonfin\.webos|org\.jellyfin\.webos)$|moonfin|jellyfin/i;
function isJellyfinTvApp(appId) { return !!appId && JELLYFIN_TV_APPS.test(appId); }

function pickJellyfinSession(list, cfg, onTv) {
  var active = list.filter(function (s) { return s && !!s.NowPlayingItem; });
  if (cfg.deviceName) {
    var dn = cfg.deviceName.toLowerCase();
    return active.filter(function (s) {
      return (s.DeviceName || '').toLowerCase().indexOf(dn) >= 0 ||
             (s.Client || '').toLowerCase().indexOf(dn) >= 0;
    })[0] || null;
  }
  if (onTv) {
    // prefer the session of the TV's own client (Moonfin / Jellyfin for webOS) over other devices
    var mine = active.filter(function (s) { return /moonfin|webos|lg/i.test((s.Client || '') + ' ' + (s.DeviceName || '')); })[0];
    if (mine) return mine;
  }
  return active[0] || null;
}

module.exports = {
  isJellyfinTvApp: isJellyfinTvApp, pickJellyfinSession: pickJellyfinSession,  extend: extend, bufferFrom: bufferFrom,  jellyfinAuth: jellyfinAuth,  parseUrl: parseUrl, APP_VERSION: APP_VERSION, ROW_KEYS: ROW_KEYS, CORNERS: CORNERS, FONT_SIZES: FONT_SIZES, getJson: getJson, lunaJson: lunaJson,
  lunaSubscribe: lunaSubscribe, writeFileAtomic: writeFileAtomic };
