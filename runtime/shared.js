'use strict';

// Constants and helpers shared by watcher.js, profiles.js, setup.js and configure.js.

var http = require('http');
var https = require('https');
var fs = require('fs');
var URL = require('url').URL;
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

var ROW_KEYS = ['program', 'volume', 'source', 'app', 'audio', 'tvaudio', 'plex', 'jellyfin', 'processing', 'video', 'colour'];
var ROW_LABELS = { program: 'Sound program', volume: 'Volume', source: 'Source', app: 'App', audio: 'Audio (amp)', tvaudio: 'Audio (TV)', plex: 'Plex',
  jellyfin: 'Jellyfin', processing: 'Processing', video: 'Video', colour: 'Colour' }; // names used on the bar, /status and /setup
// What each row means: the hover text and the click-to-open line next to every row on /status and /info (the same text is in docs/INFO-ROWS.md).
// Rows without a ROW_KEYS name are looked up by their label.
var ROW_HELP = {
  program: 'The Yamaha sound program in use (for example Straight or Surround Decoder) and, for a surround decoder, which one. With sound switching on in Setup, the overlay sets this from your rules for the app that is playing.',
  volume: 'The receiver volume, read from the Yamaha (half steps shown), or Muted. It is not the TV volume.',
  source: 'The TV input in use: HDMI n or Live TV, with the custom name you gave the input on the TV.',
  app: 'The app that is playing: the Apple TV app sent by Home Assistant, the Plex player, or the app open on the LG TV. It decides which sound program rule applies.',
  audio: 'The audio the receiver says it is getting: format, sample rate, bit depth and bitrate where it reports them. The receiver does not report the channel count.',
  tvaudio: 'The audio the TV itself sees on its input: codec, channels and sample rate. Off by default; switch it on in Setup. It works without a receiver.',
  plex: "Plex's own report for the stream: audio codec, channels and bitrate, video and bitrate, and whether it is Direct Play or Transcode. Needs Plex set up in Setup.",
  jellyfin: "Jellyfin's own report for the stream, like the Plex row: codecs, channels, bitrates and whether it is Direct Play or Transcode. Needs Jellyfin set up in Setup.",
  processing: 'Receiver processing that is switched on: Enhancer, Adaptive DRC, Extra Bass, Dialogue level and subwoofer trim, and Bass/Treble when set by hand.',
  video: 'The picture the TV is receiving: resolution, progressive or interlaced, frame rate and HDR format (Dolby Vision, HDR10, SDR).',
  colour: 'The colour format and range of the signal and its colour space, for example RGB Full and DCI-P3 D65.',
  'Receiver': 'Shown when the Yamaha is not answering. The receiver rows are hidden until it responds again.',
  'Last contact': 'When the receiver last answered, or why it did not.',
  'Receiver input': 'The input the Yamaha itself is on. Shown instead of the TV rows when the receiver is playing its own source, such as TIDAL or AirPlay.',
  'Now playing': 'The track or station the receiver is playing from its own source.'
};
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
      // a connection cut off mid-body must still end the request, or callers' in-flight flags would stay set for good
      res.on('error', function (e) { done(e); });
      res.on('aborted', function () { done(new Error('connection closed early')); });
      res.on('close', function () { done(new Error('connection closed early')); }); // ignored when 'end' already reported
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { done(e); });
  } catch (e) { done(e); }
}

// Quote a string for the shell (script -c takes one command string).
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

// Run luna-send once (it needs a pty on these TVs, hence script(1)); cb(parsedJson | null)
function lunaJson(luna, uri, params, cb) {
  if (typeof params === 'function') { cb = params; params = '{}'; }
  execFile('/usr/bin/script', ['-q', '-c', shq(luna) + ' -n 1 -f ' + shq(uri) + ' ' + shq(params || '{}'), '/dev/null'], { timeout: 4000 },
    function (err, out) {
      if (err) return cb(null);
      var text = String(out).replace(/\r/g, ''), i = text.indexOf('{');
      try { cb(JSON.parse(text.slice(i))); } catch (e) { cb(null); }
    });
}

// Keep a luna-send subscription running; onJson(obj) gets every message.  Restarts itself when luna-send exits.
// Returns {stop()}.
var liveSubs = [];
// Stop every luna subscription helper (the `script` processes), so none outlives the watcher.
function stopAllSubscriptions() { liveSubs.slice().forEach(function (s) { s.stop(); }); }
// Helpers left behind by an earlier watcher that was killed hard (they are re-parented to init). Call once at start-up,
// before any subscription of this process exists.
function reapOrphanSubscriptions() {
  try { require('child_process').execSync("pkill -f 'script -q -f -c .*luna-send.* -i .?luna://' 2>/dev/null; true", { timeout: 3000 }); } catch (e) {}
}
function lunaSubscribe(luna, uri, params, onJson, log, name) {
  var proc = null, stopped = false, restarting = false;
  // 'exit' is not guaranteed after a failed spawn, so both it and 'error' come here; only one restart is ever pending
  function restartSoon() {
    if (stopped || restarting) return;
    restarting = true;
    setTimeout(function () { restarting = false; if (!stopped) start(); }, 5000);
  }
  function start() {
    var cmd = shq(luna) + ' -i ' + shq(uri) + ' ' + shq(params);
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
    proc.on('error', function (e) { log(name + ' subscription failed: ' + e.message); proc = null; restartSoon(); });
    proc.on('exit', function (code) {
      proc = null;
      if (stopped) return;
      log(name + ' subscription ended (' + code + '), restarting in 5s');
      restartSoon();
    });
  }
  start();
  var sub = { stop: function () { stopped = true; try { if (proc) proc.kill(); } catch (e) {} var i = liveSubs.indexOf(sub); if (i >= 0) liveSubs.splice(i, 1); } };
  liveSubs.push(sub);
  return sub;
}

// Write a settings file atomically (temp file + rename) with mode 0600, so a crash mid-write cannot leave a truncated file.
function writeFileAtomic(file, text) {
  var tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 384 });
  fs.chmodSync(tmp, 384);
  fs.renameSync(tmp, file);
}

module.exports = { APP_VERSION: APP_VERSION, ROW_KEYS: ROW_KEYS, ROW_LABELS: ROW_LABELS, ROW_HELP: ROW_HELP, CORNERS: CORNERS, FONT_SIZES: FONT_SIZES, getJson: getJson, shq: shq, lunaJson: lunaJson,
  lunaSubscribe: lunaSubscribe, stopAllSubscriptions: stopAllSubscriptions, reapOrphanSubscriptions: reapOrphanSubscriptions, writeFileAtomic: writeFileAtomic };
