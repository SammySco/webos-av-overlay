'use strict';

// Settings helper run on the TV by scripts/install.sh (the installer cannot prompt on-device).
//   node configure.js get          print the current non-secret settings as key=value lines
//   node configure.js set          read key=value lines from stdin and merge them into the settings file
// Secrets (the Plex token) travel on stdin only, never on a command line, and are never printed.

var fs = require('fs');

var SETTINGS_FILE = process.env.EARC_SETTINGS || '/home/root/.earc-overlay.json';
var PLEX_LEGACY = process.env.EARC_PLEX_CONFIG || '/home/root/.earc-plex.json';
var CORNERS = ['top-left', 'top-right', 'bottom-left'];
var HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; }
}

function plexNow(settings) {
  if (settings.plex && settings.plex.disabled) return null;
  if (settings.plex && settings.plex.url && settings.plex.token) return settings.plex;
  var legacy = readJson(PLEX_LEGACY);
  return legacy.url && legacy.token ? legacy : null;
}

function get() {
  var s = readJson(SETTINGS_FILE), p = plexNow(s);
  [['ampHost', s.ampHost || ''], ['ampPort', s.ampPort || ''], ['corner', s.corner || ''],
    ['autoInfo', s.autoInfo === false ? 'off' : 'on'], ['plexUrl', p ? p.url : ''],
    ['plexPlayer', p && p.player_ip ? p.player_ip : ''], ['plexTokenSet', p ? 'yes' : 'no']]
    .forEach(function (kv) { console.log(kv[0] + '=' + kv[1]); });
}

function set(input) {
  var v = {};
  input.split('\n').forEach(function (line) {
    var i = line.indexOf('=');
    if (i > 0) v[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\r$/, '');
  });
  var s = readJson(SETTINGS_FILE);
  if (v.ampHost !== undefined && v.ampHost !== '') {
    if (!HOST_RE.test(v.ampHost)) { console.error('invalid amp host'); process.exit(2); }
    s.ampHost = v.ampHost;
  }
  if (v.ampPort) {
    var port = Number(v.ampPort);
    if (!(port >= 1 && port <= 65535)) { console.error('invalid amp port'); process.exit(2); }
    s.ampPort = Math.round(port);
  }
  if (v.corner) {
    if (CORNERS.indexOf(v.corner) < 0) { console.error('invalid corner'); process.exit(2); }
    s.corner = v.corner;
  }
  if (v.autoInfo === 'on' || v.autoInfo === 'off') s.autoInfo = v.autoInfo === 'on';
  if (v.plexClear === 'yes') s.plex = { disabled: true };
  else if (v.plexUrl) {
    var cur = plexNow(s);
    var token = v.plexToken || (cur && cur.url === v.plexUrl ? cur.token : '');
    if (!/^https?:\/\/[^/ ]+/.test(v.plexUrl)) { console.error('invalid plex url'); process.exit(2); }
    if (!token) { console.error('plex token needed'); process.exit(2); }
    s.plex = { url: v.plexUrl, token: token, player_ip: v.plexPlayer || undefined };
  } else if (v.plexPlayer && plexNow(s)) {
    var p = plexNow(s);
    s.plex = { url: p.url, token: p.token, player_ip: v.plexPlayer };
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 1), { mode: 384 }); // 0600
  fs.chmodSync(SETTINGS_FILE, 384);
  console.log('settings saved');
}

var mode = process.argv[2];
if (mode === 'get') get();
else if (mode === 'set') {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (c) { buf += c; });
  process.stdin.on('end', function () { set(buf); });
} else { console.error('usage: node configure.js get|set'); process.exit(1); }
