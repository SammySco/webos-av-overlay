'use strict';

// Constants and helpers shared by watcher.js, profiles.js, setup.js and configure.js.

var http = require('http');
var https = require('https');
var fs = require('fs');
var URL = require('url').URL;
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;

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
      var u = new URL(o.url);
      opts = { protocol: u.protocol, host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search };
    } else {
      opts = { protocol: o.protocol || 'http:', host: o.host, port: o.port, path: o.path };
    }
    opts.headers = o.headers || {};
    opts.timeout = o.timeout || 2500;
    var mod = opts.protocol === 'https:' ? https : http;
    if (opts.protocol === 'https:') opts.rejectUnauthorized = o.verifyTls === true;
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

module.exports = { ROW_KEYS: ROW_KEYS, CORNERS: CORNERS, FONT_SIZES: FONT_SIZES, getJson: getJson, lunaJson: lunaJson,
  lunaSubscribe: lunaSubscribe, writeFileAtomic: writeFileAtomic };
