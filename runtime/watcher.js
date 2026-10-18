'use strict';

// eARC Volume Overlay watcher - Yamaha MusicCast edition with signal info.
// Volume: from the receiver (Yamaha Extended Control), event-driven.
// Info card: sound program + audio signal (from the receiver) and video signal
// (from the TV's videooutput service), shown whenever any of them changes.

var http = require('http');
var dgram = require('dgram');
var execFile = require('child_process').execFile;
var fs = require('fs');
var shared = require('./shared.js');
shared.reapOrphanSubscriptions(); // helpers left by an earlier watcher that was killed hard

// Settings live in SETTINGS_FILE (written by the installer and the /setup page); environment variables are fallbacks.
var AMP_HOST = process.env.EARC_AMP_HOST || '';
var AMP_PORT = Number(process.env.EARC_AMP_PORT) || 80;
var EVENT_PORT = 41100;
// The receiver also pushes UDP events, so these polls are the fallback and the signal/now-playing ones can be slow.
var POLL_MS = 2000;
var SIGNAL_POLL_MS = 10000;
var NOW_POLL_MS = 10000;
var RESUBSCRIBE_MS = 5 * 60 * 1000;
var ROW_KEYS = shared.ROW_KEYS;
// Optional Plex source details. Config file (persistent, survives reinstalls):
//   /home/root/.earc-plex.json  {"url":"http://<server>:32400","token":"<X-Plex-Token>","player_ip":"<apple tv ip, optional>"}
var PLEX_CONFIG = process.env.EARC_PLEX_CONFIG || '/home/root/.earc-plex.json';
var PLEX_POLL_MS = 4000;
var JELLYFIN_POLL_MS = 4000;
var INFO_HTTP_PORT = Number(process.env.EARC_INFO_PORT) || 41101; // GET /info shows the bar on demand

var APP_ID = 'com.sammysco.avoverlay';
var LOG = '/tmp/earc-volume-overlay.log';
var LUNA = process.env.EARC_LUNA_SEND || '/usr/bin/luna-send';
// In Docker deployments the watcher runs on a separate machine and the TV's overlay app needs to
// make HTTP callbacks to the Docker host instead of 127.0.0.1.  Set this to the URL the TV can
// reach, e.g. http://192.168.1.5:41101.  Passed as watcherBase in every luna launch invocation.
var WATCHER_URL = process.env.EARC_WATCHER_URL || '';

var PROGRAMS = {
  straight: 'Straight', surr_decoder: 'Surround Decoder', '2ch_stereo': '2ch Stereo',
  '5ch_stereo': '5ch Stereo', '7ch_stereo': '7ch Stereo', standard: 'Standard', 'sci-fi': 'Sci-Fi',
  spectacle: 'Spectacle', adventure: 'Adventure', drama: 'Drama', mono_movie: 'Mono Movie',
  music_video: 'Music Video', munich: 'Hall in Munich', vienna: 'Hall in Vienna', chamber: 'Chamber',
  cellar_club: 'Cellar Club', roxy_theatre: 'The Roxy Theatre', bottom_line: 'The Bottom Line',
  sports: 'Sports', action_game: 'Action Game', roleplaying_game: 'Roleplaying Game'
};
var DECODERS = {
  dolby_pl2x_movie: 'Dolby PLIIx Movie', dolby_pl2x_music: 'Dolby PLIIx Music',
  dolby_pl2x_game: 'Dolby PLIIx Game', dts_neo6_cinema: 'DTS Neo:6 Cinema', dts_neo6_music: 'DTS Neo:6 Music'
};
var HDR = { dolbyvision: 'Dolby Vision', hdr10: 'HDR10', hdr10plus: 'HDR10+', 'hdr10+': 'HDR10+', hlg: 'HLG',
  technicolor: 'Technicolor HDR', none: 'SDR', sdr: 'SDR', '': 'SDR' };
var COLOUR = { dcip3d65: 'DCI-P3 D65', dcip3theater: 'DCI-P3', bt2020: 'BT.2020', bt2020ycc: 'BT.2020',
  bt2020rgb: 'BT.2020', bt709: 'BT.709', itu709: 'BT.709', bt601: 'BT.601', itu601: 'BT.601', xvycc601: 'xvYCC 601', xvycc709: 'xvYCC 709' };

var lastVolume = null, lastError = null, inFlight = false, refetch = false;
var progKey = null, audioKey = null, videoKey = null;
var profiles = null;
var state = { tvName: null, lastOk: null, volumeText: null, ampInput: null, ampLocal: false, nowPlaying: null, plexApp: null, program: null, audio: null, tvAudio: null, video: null, colour: null, source: null, processing: null, plex: null, jellyfin: null,
  volume: null, mute: false, updated: null };
var plexKey = null, plexInFlight = false;
var jellyfinKey = null, jellyfinInFlight = false;
var procKey = null;
var SETTINGS_FILE = process.env.EARC_SETTINGS || '/home/root/.earc-overlay.json';
var pinWanted = false;  // the Show on TV switch was on when the watcher last ran: put the bar back after a restart or reboot
var tvAudio = false; // show the TV's own view of the incoming audio ("Audio (TV)"); off by default
var autoInfo = true; // show the info bar by itself when the stream/amp info changes (toggle on the status page)
var CORNERS = shared.CORNERS;
var corner = 'top-left';   // where the info bar sits (the volume popup is bottom-right)
var infoShowMs = 5000;     // how long the info bar stays visible (ms)
var infoDelayMs = 1000;    // delay before it appears after a change (ms)
var infoLayout = 'stack';  // 'stack' (one row per line) or 'banner' (single horizontal line)
var hiddenRows = [];       // row keys to suppress: any of ROW_KEYS
var rowOrder = [];         // row keys in the order chosen on /status (any missing ones follow in the default order)
var VOLUME_MODES = ['numeric', 'db'];
var volumeDisplay = 'numeric'; // how the volume number is written: the receiver's numeric scale (0-97) or decibels
var volFontSize = 100;   // volume number font size as % of base (82px)
var infoFontSize = 100;  // info bar font size as % of base (24px rows, 27px title)
var soundSettings = null; // per-app sound program rules (see profiles.js)
var plexSettings = null; // {url, token, player_ip} from the settings file; falls back to the legacy PLEX_CONFIG file
var jellyfinSettings = null; // {url, apiKey, deviceName} — apiKey is private: never print, log or commit
try {
  var loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  autoInfo = loaded.autoInfo !== false;
  tvAudio = loaded.tvAudio === true;
  pinWanted = loaded.pinOnTv === true;
  if (CORNERS.indexOf(loaded.corner) >= 0) corner = loaded.corner;
  var _vd = loaded.volumeDisplay;
  if (_vd === 'amp' || _vd === 'percent' || _vd === 'percent1') _vd = 'numeric'; // migrate old values
  if (VOLUME_MODES.indexOf(_vd) >= 0) volumeDisplay = _vd;
  if (typeof loaded.ampHost === 'string' && loaded.ampHost) AMP_HOST = loaded.ampHost;
  if (Number(loaded.ampPort) > 0) AMP_PORT = Number(loaded.ampPort);
  if (loaded.plex && typeof loaded.plex === 'object') plexSettings = loaded.plex;
  if (loaded.jellyfin && typeof loaded.jellyfin === 'object') jellyfinSettings = loaded.jellyfin;
  if (loaded.sound && typeof loaded.sound === 'object') soundSettings = loaded.sound;
  if (typeof loaded.infoShowMs === 'number' && loaded.infoShowMs >= 1000 && loaded.infoShowMs <= 60000) infoShowMs = loaded.infoShowMs;
  if (typeof loaded.infoDelayMs === 'number' && loaded.infoDelayMs >= 0 && loaded.infoDelayMs <= 10000) infoDelayMs = loaded.infoDelayMs;
  if (loaded.infoLayout === 'banner') infoLayout = 'banner';
  if (Array.isArray(loaded.hiddenRows)) hiddenRows = loaded.hiddenRows.filter(function (r) { return ROW_KEYS.indexOf(r) >= 0; });
  if (Array.isArray(loaded.rowOrder)) rowOrder = loaded.rowOrder.filter(function (r, i, a) { return ROW_KEYS.indexOf(r) >= 0 && a.indexOf(r) === i; });
  if (typeof loaded.volFontSize === 'number' && loaded.volFontSize >= 50 && loaded.volFontSize <= 200) volFontSize = loaded.volFontSize;
  if (typeof loaded.infoFontSize === 'number' && loaded.infoFontSize >= 50 && loaded.infoFontSize <= 200) infoFontSize = loaded.infoFontSize;
} catch (e) {
  if (e.code !== 'ENOENT') { // unreadable or corrupt: keep a copy so the next save cannot destroy it
    try { fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bad'); fs.chmodSync(SETTINGS_FILE + '.bad', 384); } catch (e2) {}
    writeLog('settings could not be read (' + e.message + '); a copy was kept as ' + SETTINGS_FILE + '.bad');
  }
}
var saveTimer = null;
function saveSoon() { // for frequent, unimportant changes (the "seen apps" list): one write after things go quiet
  if (saveTimer) return;
  saveTimer = setTimeout(function () { saveTimer = null; saveSettings(); }, 3000);
}
function saveSettings() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    shared.writeFileAtomic(SETTINGS_FILE, JSON.stringify({ autoInfo: autoInfo, pinOnTv: tvPinned || undefined, tvAudio: tvAudio || undefined, corner: corner, volumeDisplay: volumeDisplay, ampHost: AMP_HOST, ampPort: AMP_PORT,
      infoShowMs: infoShowMs, infoDelayMs: infoDelayMs, infoLayout: infoLayout, hiddenRows: hiddenRows.length ? hiddenRows : undefined, rowOrder: rowOrder.length ? rowOrder : undefined,
      volFontSize: volFontSize !== 100 ? volFontSize : undefined, infoFontSize: infoFontSize !== 100 ? infoFontSize : undefined,
      plex: plexSettings || undefined, jellyfin: jellyfinSettings || undefined, sound: soundSettings || undefined }, null, 1)); // 0600: may hold the Plex token / Jellyfin API key
  } catch (e) { log('settings save failed: ' + e.message); }
}
var infoTimer = null, signalInFlight = false, tvPinned = false; // tvPinned: info bar held on screen (reported by the app)

var LOG_MAX = 256 * 1024, lastLogMsg = null, logRepeats = 0;
function writeLog(m) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > LOG_MAX) fs.renameSync(LOG, LOG + '.1'); // keep one old file
    fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n');
  } catch (e) {}
}
function log(m) {
  if (m === lastLogMsg) { logRepeats++; return; }
  if (logRepeats) writeLog('(previous line repeated x' + logRepeats + ')');
  logRepeats = 0; lastLogMsg = m;
  writeLog(m);
}

var lastLaunchAt = 0;
function launch(params, id) {
  lastLaunchAt = Date.now();
  if (WATCHER_URL) params = Object.assign({ watcherBase: WATCHER_URL }, params);
  execFile(LUNA, ['-n', '1', 'luna://com.webos.applicationManager/launch',
    JSON.stringify({ id: id || APP_ID, params: params })], function (error) {
    if (error) log('launch failed: ' + error.message);
  });
}

// The overlay swallows a channel key while it dismisses itself; do the channel change through the same
// networkinput control the LG phone remote uses (socket-injected CHANNELUP/DOWN keys do nothing on this TV).
function openChannel(number) {
  execFile(LUNA, ['-n', '1', 'luna://com.webos.service.apiadapter/tv/openChannel', JSON.stringify({ channelNumber: String(number) })], function (error) {
    if (error) log('open channel failed: ' + error.message);
  });
  log('opened channel ' + number);
}

function changeChannel(up) {
  var m = up ? 'channelUp' : 'channelDown';
  execFile(LUNA, ['-n', '1', 'luna://com.webos.service.networkinput/controls/' + m, '{}'], function (error) {
    if (error) log('channel change failed: ' + error.message);
  });
  log('forwarded ' + m);
}

function ampGet(path, headers, cb) {
  if (!AMP_HOST) { cb(new Error('amp not configured - open http://<tv>:' + INFO_HTTP_PORT + '/setup')); return; }
  shared.getJson({ host: AMP_HOST, port: AMP_PORT, path: '/YamahaExtendedControl/v1' + path, headers: headers || {}, timeout: 1500, maxBytes: 65536 },
    function (err, j) { cb(err, err ? undefined : j); });
}

// Switch the amp's front-panel volume scale via the YNCA XML API (the same endpoint the web setup UI uses).
// Called when the overlay's volumeDisplay changes to/from 'db' so the front panel matches.
function syncAmpVolumeScale(toDb) {
  if (!AMP_HOST) return;
  var scale = toDb ? 'dB' : '0-97';
  var xml = '<?xml version="1.0" encoding="utf-8"?><YAMAHA_AV cmd="PUT"><Main_Zone><Volume><Scale>' + scale + '</Scale></Volume></Main_Zone></YAMAHA_AV>';
  var req = http.request({ host: AMP_HOST, port: AMP_PORT, method: 'POST', path: '/YamahaRemoteControl/ctrl',
    headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) }, timeout: 2000 },
    function (res) { res.resume(); log('amp volume scale → ' + scale); });
  req.on('timeout', function () { req.destroy(); });
  req.on('error', function (e) { log('amp volume scale sync failed: ' + e.message); });
  req.write(xml); req.end();
}

// ---------- info card ----------
// "Netflix (LG app)" / "Netflix (Apple TV)" for apps; null for inputs (the source segment already names those)
function pageTitle(d) { return d && d.tvName ? d.tvName + ' - AV Info' : 'AV Info'; }

// The name the user gave the TV (Settings > General > Device Name), read from the TV's settings service.
function fetchTvName() {
  execFile('/usr/bin/script', ['-q', '-c', LUNA + " -n 1 -f luna://com.webos.settingsservice/getSystemSettings '{\"category\":\"network\",\"keys\":[\"deviceName\"]}'", '/dev/null'],
    { timeout: 4000 }, function (err, out) {
      var m = !err && /"deviceName": *"([^"]{1,60})"/.exec(String(out));
      if (m && m[1] !== state.tvName) { state.tvName = m[1]; log('TV name: ' + state.tvName); }
    });
}
fetchTvName();
setInterval(fetchTvName, 10 * 60 * 1000);

function sourceLabel() {
  var n = profiles && state.source ? profiles.inputName(state.source) : null;
  return state.source ? (n ? state.source + ' - ' + n : state.source) : null;
}

function appLabel() {
  var c = profiles ? profiles.current() : null;
  if (!c || !c.key || (c.kind !== 'lg' && c.kind !== 'atv')) return null;
  if (c.kind === 'lg') return c.key + ' on LG TV';
  return c.key + ' on Apple TV';
}

// ---------- amp-local sources (TIDAL, net radio, ...): what the receiver itself is playing ----------
var NET_INPUTS = ['tidal', 'spotify', 'deezer', 'qobuz', 'amazon_music', 'net_radio', 'airplay', 'server', 'mc_link', 'usb', 'napster',
  'pandora', 'siriusxm', 'juke', 'radiko', 'qq_music', 'soundcloud'];
var INPUT_NAMES = { tidal: 'TIDAL', net_radio: 'NET RADIO', spotify: 'Spotify', deezer: 'Deezer', qobuz: 'Qobuz', amazon_music: 'Amazon Music',
  airplay: 'AirPlay', server: 'Server', mc_link: 'MusicCast Link', usb: 'USB', bluetooth: 'Bluetooth', tuner: 'Tuner', napster: 'Napster' };
function inputLabel(id) {
  if (!id) return null;
  if (INPUT_NAMES[id]) return INPUT_NAMES[id];
  var h = /^hdmi([0-9])$/.exec(id);
  return h ? 'Receiver HDMI ' + h[1] : String(id).split('_').join(' ');
}
// the receiver input the TV's sound arrives on (default audio1, the eARC/ARC input)
function tvInputId() { return (soundSettings && soundSettings.tvInput) || 'audio1'; }

var nowKey = null, nowInFlight = false, inputKeyed = false;
function fetchNowPlaying() {
  if (!state.ampLocal || NET_INPUTS.indexOf(state.ampInput) < 0) {
    if (state.nowPlaying) { state.nowPlaying = null; nowKey = null; }
    return;
  }
  if (nowInFlight) return;
  nowInFlight = true;
  ampGet('/netusb/getPlayInfo', null, function (err, j) {
    nowInFlight = false;
    if (err || !j || j.response_code !== 0) return;
    var who = [j.artist, j.track].filter(function (x) { return !!x; }).join(' - ');
    var text = who || null;
    if (text && j.album) text += ' (' + j.album + ')';
    if (text && j.playback && j.playback !== 'play') text = (j.playback === 'pause' ? 'Paused: ' : 'Stopped: ') + text;
    var key = [j.input, j.artist, j.track, j.playback].join('|');
    state.nowPlaying = text;
    if (nowKey === null) { nowKey = key; }
    else if (key !== nowKey) { nowKey = key; scheduleInfo('now playing ' + (text || 'nothing')); }
  });
}

// ---------- is the receiver answering? ----------
// The receiver is polled every 2 s. If no read has succeeded for STALE_MS its numbers are not current, so they are
// withheld (bar, pages and status.json) and a "not responding" note takes their place instead of the last known value.
var STALE_MS = 6000;
var startedAt = Date.now();
function ampReachable() {
  if (!AMP_HOST) return false;
  if (state.lastOk) return Date.now() - state.lastOk.getTime() < STALE_MS;
  return Date.now() - startedAt < 5000; // just started, the first read is still on its way
}
function lastSeenText() {
  if (!AMP_HOST) return 'No receiver address set (open /setup)';
  if (!state.lastOk) return 'Not reached since the overlay started';
  var secs = Math.round((Date.now() - state.lastOk.getTime()) / 1000);
  if (secs < 90) return 'Last answered ' + secs + ' s ago';
  var mins = Math.round(secs / 60);
  if (mins < 90) return 'Last answered ' + mins + ' min ago';
  return 'Last answered ' + Math.round(mins / 60) + ' h ago';
}
var lastReach = null;
function reachTick() {
  var up = ampReachable();
  if (lastReach === null) { lastReach = up; return; }
  if (up === lastReach) return;
  lastReach = up;
  log(up ? 'receiver answering again' : 'receiver not responding (' + lastSeenText() + ')');
  if (tvPinned) scheduleInfo('receiver ' + (up ? 'back' : 'not responding')); // refresh a bar that is already up; never pop one
}
setInterval(reachTick, 1000);

function orderedKeys() { // every row key, in the order set on /status (keys it does not mention keep their default order, after the others)
  return rowOrder.concat(ROW_KEYS.filter(function (k) { return rowOrder.indexOf(k) < 0; }));
}
function lab(k, text) { return text && hiddenRows.indexOf(k) < 0 ? shared.ROW_LABELS[k] + ': ' + text : null; } // one bar line: "Video: 3840x2160p ...", or null when empty or hidden
function launchInfo(pin) {
  var al = appLabel();
  var up = ampReachable();
  var tva = tvAudio ? state.tvAudio : null;
  var vol = up && state.volume !== null ? (state.mute ? 'Muted (' + (state.volumeText || state.volume) + ')' : String(state.volumeText || state.volume)) : null;
  var plex = state.plex ? state.plex.replace(/^Plex: /, '') : null, jelly = state.jellyfin ? state.jellyfin.replace(/^Jellyfin: /, '') : null;
  // fixed lines first, then the rest in the order chosen on /status; the title is only used for "Receiver not responding"
  var head, by;
  var tvOnly = !AMP_HOST; // no receiver set (for example a non-Yamaha setup): show what the TV, Plex and Jellyfin know, without receiver messages
  if (!up) {
    head = tvOnly ? [] : [lastSeenText()];
    by = { source: lab('source', sourceLabel()), app: lab('app', al), tvaudio: lab('tvaudio', tva), plex: tvOnly ? lab('plex', plex) : null, jellyfin: tvOnly ? lab('jellyfin', jelly) : null,
      video: lab('video', state.video), colour: lab('colour', state.colour) };
  }
  else if (state.ampLocal) {
    head = [inputLabel(state.ampInput) ? 'Receiver input: ' + inputLabel(state.ampInput) : null, state.nowPlaying ? 'Now playing: ' + state.nowPlaying : null];
    by = { program: lab('program', state.program), volume: lab('volume', vol), audio: lab('audio', state.audio), processing: lab('processing', state.processing) };
  } else {
    head = [];
    by = { program: lab('program', state.program), volume: lab('volume', vol), source: lab('source', sourceLabel()), app: lab('app', al), audio: lab('audio', state.audio), tvaudio: lab('tvaudio', tva), plex: lab('plex', plex), jellyfin: lab('jellyfin', jelly),
      processing: lab('processing', state.processing), video: lab('video', state.video), colour: lab('colour', state.colour) };
  }
  var segs = head.concat(orderedKeys().map(function (k) { return by[k]; })).filter(function (x) { return !!x; });
  var title = up || tvOnly ? '' : 'Receiver not responding';
  var volIdx = by.volume ? segs.indexOf(by.volume) : -1; // lets the app keep this line current when the volume changes while the bar is up
  var params = { info: { title: title, segs: segs, showMs: infoShowMs, layout: infoLayout, volIdx: volIdx, volLabel: shared.ROW_LABELS.volume }, corner: corner, volFontSize: volFontSize, infoFontSize: infoFontSize };
  log('info bar: ' + [title].concat(segs).filter(function (x) { return !!x; }).join(' | '));
  if (pin) { params.pin = true; tvPinned = true; overlayLost = false; barFg = lastFg; }
  else if (tvPinned && overlayLost) return; // the Guide or another system screen closed the bar: do not pop up over it
  launch(params);
}

function scheduleInfo(reason, delay, pin, force) {
  // a bar that is pinned on screen keeps updating even with Auto info off (that setting only stops it popping up)
  if (!autoInfo && !force && !tvPinned) { log('info change (auto info off): ' + reason); return; }
  log('info change: ' + reason);
  if (infoTimer) clearTimeout(infoTimer);
  infoTimer = setTimeout(function () {
    infoTimer = null;
    launchInfo(pin);
  }, delay === undefined ? infoDelayMs : delay);
}

// On demand: show the bar straight away from the last known state (the app's cold start is the slow
// part), then refresh from the amp/Plex and update the open bar in place.
// pin = keep it on screen until hideInfo() (or the Quick Access key) clears it.
function showInfoNow(via, pin) {
  log('info change: on demand (' + via + ')');
  if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
  launchInfo(pin);
  fetchStatus(false);
  fetchSignal();
  fetchTvAudio();
  fetchPlex();
  fetchJellyfin();
  scheduleInfo('on demand refresh', 700, pin, true);
}

function hideInfo(via) {
  log('info hide (' + via + ')');
  if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
  var wasLost = overlayLost;
  tvPinned = false;
  overlayLost = false;
  if (!wasLost) launch({ hide: true }); // nothing is on screen when the bar was already lost
}

// ---------- pinned bar closed by the Guide / system UI ----------
// Opening the Guide makes webOS close the overlay window while the watcher still believes it is pinned. Waiting for
// a channel change (picked in the Guide) and then re-pinning restores it without popping up over the Guide itself.
// The running-app list and the foreground app arrive by luna subscription; only the channel is polled, and only while the bar is away.
var lostAt = 0, overlayLost = false, lastChannel = null, restoreTimer = null, lastFg = null;
var barFg = null; // the foreground app when the pinned bar was last known to be on screen
var QUIET_APPS = ['com.webos.app.home', 'com.webos.app.livemenu', 'com.webos.app.notification'];
function scheduleRestore(why, ms) {
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(function () { restoreTimer = null; if (tvPinned) showInfoNow(why, true); }, ms);
}
function evaluateLost(prevFg) {
  if (!tvPinned || !overlayLost) return;
  // The Guide only exists on Live TV, so on an HDMI input a vanished bar is not the Guide: bring it back
  // (something else, such as a system pop-up, closed the window).
  if (lastFg && lastFg.indexOf('com.webos.app.hdmi') === 0 && !restoreTimer) {
    log('bar vanished on ' + lastFg + ' with no input change; restoring it');
    scheduleRestore('bar vanished', 300);
  }
  // The foreground app changing while the bar is away means the new input or screen is up: bring the bar back
  // without waiting for the video state to settle (that can take many seconds when the TV retunes or locks HDMI).
  if (prevFg && lastFg && prevFg !== lastFg && QUIET_APPS.indexOf(lastFg) < 0) {
    log('foreground app changed to ' + lastFg + ' while the bar was away; restoring it');
    scheduleRestore('app change', 1200);
  }
}
function onForegroundChange(id, prev) { lastFg = id; evaluateLost(prev); }
function onRunning(j) {
  if (!tvPinned) { overlayLost = false; return; }
  if (!j) return;
  if (JSON.stringify(j).indexOf('"' + APP_ID + '"') >= 0) { overlayLost = false; barFg = lastFg; return; }
  if (overlayLost || Date.now() - lastLaunchAt < 3000) return; // a launch in progress is not yet in the list
  overlayLost = true; lostAt = Date.now();
  log('pinned bar went away (foreground ' + lastFg + '); waiting for a channel/app change');
  // the foreground app can change before the running list does: compare with where the bar was last seen
  evaluateLost(barFg);
}
function pollChannel() {
  if (!tvPinned || !overlayLost) { lastChannel = null; return; }
  shared.lunaJson(LUNA, 'luna://com.webos.service.apiadapter/tv/getCurrentChannel', function (c) {
    var n = c && c.channelNumber !== undefined ? String(c.channelNumber) : null;
    if (n === null || !tvPinned) return;
    var prev = lastChannel;
    lastChannel = n;
    if (overlayLost && prev !== null && prev !== n) {
      log('channel changed to ' + n + ' while the bar was away; restoring it');
      scheduleRestore('channel change (guide)', 2500);
    }
  });
}
setInterval(pollChannel, 1000);
// safety net in case the running-app subscription misses a change
setInterval(function () {
  if (tvPinned) shared.lunaJson(LUNA, 'luna://com.webos.applicationManager/running', onRunning);
}, 10000);
process.on('SIGUSR1', function () { showInfoNow('signal'); });
function esc(t) {
  return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function snapshot() {
  var up = ampReachable();
  return { version: shared.APP_VERSION, tvName: state.tvName, sourceLabel: sourceLabel(), reachable: up, receiverSet: !!AMP_HOST, lastOk: state.lastOk ? state.lastOk.toISOString() : null, receiverNote: up ? null : lastSeenText(),
    program: up ? state.program : null, volume: up ? state.volume : null, mute: state.mute, source: state.source, audio: up ? state.audio : null, tvAudio: tvAudio ? state.tvAudio : null,
    plex: state.plex, jellyfin: state.jellyfin, processing: up ? state.processing : null, video: state.video, colour: state.colour, pinned: tvPinned, autoInfo: autoInfo, volumeText: up ? state.volumeText : null, ampInput: up ? state.ampInput : null, ampLocal: up && state.ampLocal, nowPlaying: up ? state.nowPlaying : null, app: profiles ? profiles.current().key : null, appKind: profiles ? profiles.current().kind : null, appLabel: appLabel(),
    updated: state.updated ? state.updated.toISOString() : null };
}

// Rows are [label, value, key, shown]: key is a ROW_KEYS name (the row can be switched on or off for the TV bar), shown is whether the
// bar currently includes it; rows that are not on the bar have no key.
function infoRows(d) {
  function R(key, v) { return [shared.ROW_LABELS[key], v, key, hiddenRows.indexOf(key) < 0]; }
  var volume = d.volume === null ? null : (d.mute ? 'Muted (' + (d.volumeText || d.volume) + ')' : (d.volumeText || d.volume));
  var rows;
  if (d.reachable === false && d.receiverSet === false) { // no receiver configured: only what the TV, Plex and Jellyfin know
    rows = [R('source', d.sourceLabel || d.source), R('app', d.appLabel), R('tvaudio', d.tvAudio), R('plex', d.plex ? d.plex.replace(/^Plex: /, '') : null),
      R('jellyfin', d.jellyfin ? d.jellyfin.replace(/^Jellyfin: /, '') : null), R('video', d.video), R('colour', d.colour)];
  } else if (d.reachable === false) { // withhold the receiver's numbers; show what the TV knows plus why they are missing
    rows = [['Receiver', 'Not responding'], ['Last contact', d.receiverNote], R('source', d.sourceLabel || d.source), R('app', d.appLabel), R('tvaudio', d.tvAudio), R('video', d.video), R('colour', d.colour)];
  } else if (d.ampLocal) { // the receiver is playing its own source: the TV's video and app details would be misleading
    rows = [R('program', d.program), R('volume', volume), ['Receiver input', inputLabel(d.ampInput)], ['Now playing', d.nowPlaying], R('audio', d.audio), R('processing', d.processing)];
  } else {
    rows = [R('program', d.program), R('volume', volume), R('source', d.sourceLabel || d.source), R('app', d.appLabel), R('audio', d.audio), R('tvaudio', d.tvAudio),
      R('plex', d.plex ? d.plex.replace(/^Plex: /, '') : null), R('jellyfin', d.jellyfin ? d.jellyfin.replace(/^Jellyfin: /, '') : null),
      R('processing', d.processing), R('video', d.video), R('colour', d.colour)];
  }
  rows = rows.filter(function (r) { return r[1] !== null && r[1] !== undefined && r[1] !== ''; });
  // the switchable rows go in the chosen order; rows that are not switchable (Volume, ...) keep their places
  var order = orderedKeys();
  var keyed = rows.filter(function (r) { return r[2]; }).sort(function (a, b) { return order.indexOf(a[2]) - order.indexOf(b[2]); }), n = 0;
  return rows.map(function (r) { return r[2] ? keyed[n++] : r; });
}
function rowHtml(r) {
  var sw = r[2] ? '<span class="rs' + (r[3] ? ' on' : '') + '"></span>' : '';
  var hk = r[2] || r[0], help = shared.ROW_HELP[hk];
  var hi = help ? '<button type="button" class="hi" data-h="' + esc(hk) + '" title="' + esc(help) + '" aria-label="About ' + esc(r[0]) + '">i</button>' : '';
  return '<tr><th' + (r[2] ? ' class="rt" data-k="' + r[2] + '" title="Show this row on the TV"' : '') + '><div class="rl">' + sw + '<span>' + esc(r[0]) + '</span>' + hi + '</div></th><td>' + esc(r[1]) + '</td><td class="rh"' + (r[2] ? ' data-d="' + r[2] + '" title="Drag to reorder">&#8801;' : '>') + '</td></tr>';
}

function infoPage(shownOnTv) {
  var d = snapshot();
  var body = infoRows(d).map(rowHtml).join('');
  return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(pageTitle(d)) + '</title><style>' +
    ':root{color-scheme:dark}*{box-sizing:border-box}html,body{height:100%}' +
    'body{margin:0;padding:max(10px,1.2vh) 14px;font:16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#111114;color:#eee;overflow:hidden}' +
    'main{max-width:720px;margin:0 auto;height:100%;display:flex;flex-direction:column;gap:max(6px,1vh)}' +
    'h1{font-size:clamp(15px,2.6vh,22px);font-weight:600;margin:0}p#meta{margin:0;color:#8b8b93;font-size:clamp(11px,1.7vh,14px)}' +
    '.box{flex:0 1 auto;min-height:0;overflow-y:auto}' +
    'table{width:100%;border-collapse:collapse;background:#1b1b20;border:1px solid #2c2c33;border-radius:12px;overflow:hidden;font-size:clamp(11px,1.95vh,16px)}' +
    'th,td{text-align:left;padding:.45em .7em;border-bottom:1px solid #2a2a30;vertical-align:top;line-height:1.25}tr:last-child th,tr:last-child td{border-bottom:0}' +
    'th{width:38%;color:#9a9aa2;font-weight:500}td{color:#f2f2f5}th.rt{cursor:pointer;-webkit-user-select:none;user-select:none}' +
    '.rl{display:flex;align-items:center;gap:.5em}.rs{flex:0 0 auto;position:relative;width:1.9em;height:1.1em;border-radius:1em;background:#3a3a42;transition:background .15s}' +
    '.rs:after{content:"";position:absolute;top:.14em;left:.14em;width:.82em;height:.82em;border-radius:50%;background:#fff;transition:left .15s}' +
    '.rs.on{background:#34a853}.rs.on:after{left:.98em}' +
    '.hi{flex:0 0 auto;width:1.35em;height:1.35em;margin-left:.15em;padding:0;border-radius:50%;border:1px solid #55555e;background:transparent;color:#9a9aa2;font:italic 600 .85em Georgia,serif;line-height:1;cursor:help}.hi:hover,.hi:focus-visible{color:#fff;border-color:#9a9aa2}' +
    'tr.hr td{background:#16161a;color:#b4b4bc;font-size:.92em;padding:.4em .7em .55em 1.2em}' +
    'td.rh{width:2.4em;padding:.45em .3em;text-align:center;color:#6b6b73;font-size:1.2em;line-height:1;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}tr.drag{background:#26262d}' +
    'nav{flex:0 0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
    'footer{flex:0 0 auto;text-align:center;color:#6b6b73;font-size:clamp(10px,1.5vh,12px)}' +
    '.tg{display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;font-size:clamp(11px,1.8vh,15px);color:#eee;background:#1b1b20;border:1px solid #2c2c33;border-radius:12px;padding:.55em .7em;cursor:pointer;text-align:left;line-height:1.15}' +
    '.sw{flex:0 0 auto;position:relative;width:2.6em;height:1.5em;border-radius:1em;background:#3a3a42;transition:background .15s}' +
    '.sw:after{content:"";position:absolute;top:.17em;left:.17em;width:1.16em;height:1.16em;border-radius:50%;background:#fff;transition:left .15s}' +
    '.tg.on .sw{background:#34a853}.tg.on .sw:after{left:1.27em}' +
    'nav a{grid-column:span 1;font:inherit;font-size:clamp(11px,1.8vh,15px);color:#ddd;text-decoration:none;background:#2a2a31;border:1px solid #3a3a42;border-radius:12px;padding:.55em .7em;text-align:center}' +
    '.links{display:contents}' +
    // short landscape screens (a phone on its side): the table on the left, the toggles stacked on the right
    '@media (orientation:landscape) and (max-height:520px){body{padding:6px 12px}main{max-width:none;display:grid;grid-template-columns:1fr 200px;grid-template-rows:auto auto 1fr auto;column-gap:12px;row-gap:2px}footer{grid-column:1/-1;grid-row:4}' +
    'h1{grid-column:1/-1;font-size:clamp(14px,5vh,18px)}p#meta{grid-column:1/-1}.box{grid-column:1;grid-row:3}' +
    'table{font-size:clamp(10px,4vh,14px)}th,td{padding:.28em .6em}' +
    'nav{grid-column:2;grid-row:3;grid-template-columns:1fr;align-content:start;gap:6px}.tg,nav a{font-size:clamp(11px,4.2vh,14px);padding:.45em .6em}}' +
    '</style></head><body><main><h1 id="ttl">' + esc(pageTitle(d)) + '</h1><p id="meta">' +
    (shownOnTv ? 'Also shown on the TV. ' : '') +
    (d.updated ? 'Updated ' + esc(new Date(d.updated).toLocaleTimeString('en-AU')) : '') +
    '</p><div class="box"><table id="rows">' + (body || '<tr><td>No data yet</td></tr>') + '</table></div>' +
    '<nav><button class="tg' + (d.pinned ? ' on' : '') + '" id="tv" type="button">Show on TV<span class="sw"></span></button>' +
    '<button class="tg on" id="live" type="button">Live refresh<span class="sw"></span></button>' +
    '<button class="tg' + (autoInfo ? ' on' : '') + '" id="auto" type="button">Auto info<span class="sw"></span></button>' +
    '<a href="/setup">Setup</a><a href="/status.json">JSON</a><a href="/logs">Logs</a></nav>' +
    '<footer>AV Overlay' + (shared.APP_VERSION ? ' v' + esc(shared.APP_VERSION) : '') + '</footer></main>' +
    '<script>(function(){var pinned=' + (d.pinned ? 'true' : 'false') + ',live=true,timer=null,auto=' + (autoInfo ? 'true' : 'false') + ',' +
    'au=document.getElementById("auto"),tv=document.getElementById("tv"),lv=document.getElementById("live"),rows=document.getElementById("rows"),meta=document.getElementById("meta");' +
    'function esc(t){return String(t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
    'var HELP=' + JSON.stringify(shared.ROW_HELP).replace(/</g, '\\u003c') + ',openHelp={};' +
    'function helpRow(t){return"<tr class=\\"hr\\"><td colspan=\\"3\\">"+esc(t)+"</td></tr>"}' +
    'function toggleHelp(b){var k=b.getAttribute("data-h"),tr=b.parentNode;while(tr&&tr.tagName!=="TR")tr=tr.parentNode;if(!tr||!HELP[k])return;var nx=tr.nextSibling;' +
    'if(nx&&nx.classList&&nx.classList.contains("hr")){nx.parentNode.removeChild(nx);delete openHelp[k]}else{openHelp[k]=1;tr.insertAdjacentHTML("afterend",helpRow(HELP[k]))}}' +
    'function setOn(b,on){if(on)b.classList.add("on");else b.classList.remove("on")}' +
    'function showAuto(on){auto=!!on;setOn(au,auto)}' +
    'au.onclick=function(){fetch("/tv/auto?v="+(auto?"0":"1"),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){showAuto(j.autoInfo)}).catch(function(){})};' +
    'function paint(d){if(d.title){document.title=d.title;var h=document.getElementById("ttl");if(h)h.textContent=d.title}if(d.rows){rows.innerHTML=d.rows.map(function(r){var hk=r[2]||r[0],hp=HELP[hk];return"<tr><th"+(r[2]?" class=\\"rt\\" data-k=\\""+r[2]+"\\" title=\\"Show this row on the TV\\"":"")+"><div class=\\"rl\\">"+(r[2]?"<span class=\\"rs"+(r[3]?" on":"")+"\\"></span>":"")+"<span>"+esc(r[0])+"</span>"+(hp?"<button type=\\"button\\" class=\\"hi\\" data-h=\\""+esc(hk)+"\\" title=\\""+esc(hp)+"\\" aria-label=\\"About "+esc(r[0])+"\\">i</button>":"")+"</div></th><td>"+esc(r[1])+"</td><td class=\\"rh\\""+(r[2]?" data-d=\\""+r[2]+"\\" title=\\"Drag to reorder\\">&#8801;":">")+"</td></tr>"+(hp&&openHelp[hk]?helpRow(hp):"")}).join("")||"<tr><td>No data yet</td></tr>"}' +
    'if(d.autoInfo!==undefined)showAuto(d.autoInfo);' +
    'pinned=!!d.pinned;setOn(tv,pinned);if(d.updated)meta.textContent="Updated "+new Date(d.updated).toLocaleTimeString("en-AU")}' +
    'rows.onclick=function(e){var t=e.target;if(t.classList&&t.classList.contains("hi")){toggleHelp(t);return}while(t&&t!==rows&&!(t.getAttribute&&t.getAttribute("data-k")))t=t.parentNode;if(!t||t===rows)return;var s=t.querySelector(".rs"),on=s&&s.classList.contains("on");if(s)setOn(s,!on);' +
    'fetch("/tv/row?k="+encodeURIComponent(t.getAttribute("data-k"))+"&v="+(on?"0":"1"),{cache:"no-store"}).then(function(r){return r.json()}).then(function(){poll()}).catch(function(){poll()})};' +
    'var dragRow=null;function rowOf(el){while(el&&el!==rows){if(el.tagName==="TR")return el;el=el.parentNode}return null}' +
    'rows.addEventListener("pointerdown",function(e){var h=e.target;if(!h.getAttribute||!h.getAttribute("data-d"))return;dragRow=rowOf(h);if(!dragRow)return;openHelp={};Array.prototype.slice.call(rows.querySelectorAll("tr.hr")).forEach(function(x){x.parentNode.removeChild(x)});dragRow.classList.add("drag");if(h.setPointerCapture)h.setPointerCapture(e.pointerId);e.preventDefault()});' +
    'rows.addEventListener("pointermove",function(e){if(!dragRow)return;var tr=rowOf(document.elementFromPoint(e.clientX,e.clientY));if(!tr||tr===dragRow||!tr.querySelector("[data-d]"))return;var b=tr.getBoundingClientRect();tr.parentNode.insertBefore(dragRow,e.clientY>b.top+b.height/2?tr.nextSibling:tr)});' +
    'function endDrag(){if(!dragRow)return;dragRow.classList.remove("drag");dragRow=null;var ks=Array.prototype.map.call(rows.querySelectorAll("[data-d]"),function(c){return c.getAttribute("data-d")});' +
    'fetch("/tv/order?o="+ks.join(","),{cache:"no-store"}).then(function(){poll()}).catch(function(){poll()})}' +
    'rows.addEventListener("pointerup",endDrag);rows.addEventListener("pointercancel",endDrag);' +
    'function poll(){if(dragRow)return;fetch("/status.rows.json",{cache:"no-store"}).then(function(r){return r.json()}).then(paint).catch(function(){})}' +
    'tv.onclick=function(){fetch(pinned?"/tv/hide":"/tv/show",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){pinned=!!j.pinned;setOn(tv,pinned);window.setTimeout(poll,900)}).catch(function(){})};' +
    'function setLive(on){live=on;setOn(lv,on);if(timer){window.clearInterval(timer);timer=null}if(on){poll();timer=window.setInterval(poll,5000)}}' +
    'lv.onclick=function(){setLive(!live)};setLive(true)}());</script></body></html>';
}

// ---------- /setup (settings form, see setup.js) ----------
function applySettings(v) {
  // work out the Plex / Jellyfin changes first, so a refusal leaves everything untouched
  var newPlex, newJellyfin;
  if (v.plexClear) newPlex = { disabled: true };
  else if (v.plexUrl !== undefined) {
    if (!v.plexUrl) newPlex = { disabled: true };
    else {
      var cur = readPlexConfig();
      var token = v.plexToken || (cur && cur.url === v.plexUrl ? cur.token : '');
      if (!token) return { error: 'Enter the Plex token for this server' };
      newPlex = { url: v.plexUrl, token: token, player_ip: v.plexPlayer || undefined, verifyTls: cur && cur.verifyTls === true ? true : undefined };
    }
  }
  if (v.jellyfinClear) newJellyfin = { disabled: true };
  else if (v.jellyfinUrl !== undefined) {
    if (!v.jellyfinUrl) newJellyfin = { disabled: true };
    else {
      var jcur = readJellyfinConfig();
      var apiKey = v.jellyfinApiKey || (jcur && jcur.url === v.jellyfinUrl ? jcur.apiKey : '');
      if (!apiKey) return { error: 'Enter the Jellyfin API key for this server' };
      newJellyfin = { url: v.jellyfinUrl, apiKey: apiKey, deviceName: v.jellyfinDevice || undefined, verifyTls: jcur && jcur.verifyTls === true ? true : undefined };
    }
  }

  var ampChanged = false;
  if (v.ampHost !== undefined && v.ampHost !== AMP_HOST) { AMP_HOST = v.ampHost; ampChanged = true; }
  if (v.ampPort !== undefined && v.ampPort !== AMP_PORT) { AMP_PORT = v.ampPort; ampChanged = true; }
  if (v.corner) corner = v.corner;
  if (v.volumeDisplay && VOLUME_MODES.indexOf(v.volumeDisplay) >= 0) {
    var prevVolumeDisplay = volumeDisplay;
    volumeDisplay = v.volumeDisplay;
    if (volumeDisplay !== prevVolumeDisplay) syncAmpVolumeScale(volumeDisplay === 'db');
  }
  if (v.autoInfo !== undefined) autoInfo = v.autoInfo;
  if (v.tvAudio !== undefined && v.tvAudio !== tvAudio) { tvAudio = v.tvAudio; state.tvAudio = null; tvAudioKey = null; if (tvAudio) fetchTvAudio(); }
  if (typeof v.infoShowMs === 'number') infoShowMs = v.infoShowMs;
  if (typeof v.infoDelayMs === 'number') infoDelayMs = v.infoDelayMs;
  if (v.infoLayout !== undefined) infoLayout = v.infoLayout;
  if (v.hiddenRows !== undefined) hiddenRows = v.hiddenRows;
  if (typeof v.volFontSize === 'number' && v.volFontSize >= 50 && v.volFontSize <= 200) volFontSize = v.volFontSize;
  if (typeof v.infoFontSize === 'number' && v.infoFontSize >= 50 && v.infoFontSize <= 200) infoFontSize = v.infoFontSize;
  if (v.sound) soundSettings = v.sound;
  if (newPlex) { plexSettings = newPlex; legacyPlex.at = 0; }
  if (newJellyfin) jellyfinSettings = newJellyfin;
  saveSettings();
  log('settings saved (amp ' + (AMP_HOST || 'not set') + ':' + AMP_PORT + ', corner ' + corner + ', auto info ' + (autoInfo ? 'on' : 'off') +
    ', plex ' + (readPlexConfig() ? 'on' : 'off') + ', jellyfin ' + (readJellyfinConfig() ? 'on' : 'off') + ')');
  if (ampChanged) {
    lastVolume = null; progKey = null; audioKey = null; procKey = null; lastError = null;
    state.volume = null; state.program = null; state.audio = null; state.processing = null;
    fetchStatus(true); fetchSignal();
  }
  fetchPlex();
  fetchJellyfin();
  return {};
}

var profiles = require('./profiles.js')({
  ampGet: function (path, cb) { ampGet(path, null, cb); },
  log: log,
  luna: LUNA,
  getSound: function () { return soundSettings; },
  setSound: function (o) { soundSettings = o; saveSoon(); },
  getPlexApp: function () { return state.plexApp || null; },
  inputLabel: inputLabel,
  onForeground: onForegroundChange,
  onContext: function (key, kind) { if (key && (kind === 'lg' || kind === 'atv')) scheduleInfo('app ' + key + (kind === 'lg' ? ' (LG app)' : ' (Apple TV)')); }
});

var setupHandler = require('./setup.js')({
  profiles: profiles,
  getSound: function () { return soundSettings; },
  corners: CORNERS,
  volumeModes: VOLUME_MODES,
  getSettings: function () {
    var p = readPlexConfig(), j = readJellyfinConfig();
    return { ampHost: AMP_HOST, ampPort: AMP_PORT, autoInfo: autoInfo, tvAudio: tvAudio, corner: corner, volumeDisplay: volumeDisplay,
      infoShowMs: infoShowMs, infoDelayMs: infoDelayMs, infoLayout: infoLayout, hiddenRows: hiddenRows,
      plexUrl: p ? p.url : '', plexPlayer: p && p.player_ip ? p.player_ip : '', plexTokenSet: !!p,
      jellyfinUrl: j ? j.url : '', jellyfinDevice: j && j.deviceName ? j.deviceName : '', jellyfinApiKeySet: !!j,
      volFontSize: volFontSize, infoFontSize: infoFontSize };
  },
  getPlexSecret: function () { return readPlexConfig(); },
  getJellyfinSecret: function () { return readJellyfinConfig(); },
  applySettings: applySettings
});

var logsHandler = require('./logs.js')({ logFile: LOG, title: function () { return state.tvName ? state.tvName + ' - Logs' : 'AV Overlay - Logs'; } });

var APP_PATHS = ['/tv/pinstate', '/tv/qa', '/tv/key', '/status.json'];
var MUTATING_PATHS = ['/info', '/app', '/tv/show', '/tv/hide', '/tv/pinstate', '/tv/qa', '/tv/auto', '/tv/row', '/tv/order', '/tv/key'];
http.createServer(function (req, res) {
  var path = req.url.split('?')[0];
  var wantsHtml = /text\/html/.test(req.headers.accept || '');
  var headers = { 'Cache-Control': 'no-store' };
  // The overlay app (an on-TV page, a different origin) calls the /tv paths, and the settings app probes /status.json
  // before opening /setup; both need to read the answer.
  if (APP_PATHS.indexOf(path) >= 0) headers['Access-Control-Allow-Origin'] = '*';
  // A page on another site must not change anything through an <img>, fetch or iframe (these are plain GETs).
  // Modern browsers say so in Sec-Fetch-Site; the TV's old browser sends neither header, and a top-level
  // navigation (the user clicking a link) is allowed.
  if (MUTATING_PATHS.indexOf(path) >= 0 && req.headers['sec-fetch-site'] === 'cross-site' && req.headers['sec-fetch-dest'] !== 'document') {
    res.writeHead(403, headers); res.end(); return;
  }
  if (setupHandler(req, res, path)) return;
  if (logsHandler(req, res, path)) return;
  if (path === '/info') {
    showInfoNow('http ' + req.socket.remoteAddress);
    // give the amp/Plex refresh a moment so the page shows current values
    setTimeout(function () {
      if (wantsHtml) { headers['Content-Type'] = 'text/html; charset=utf-8'; res.writeHead(200, headers); res.end(infoPage(true)); }
      else { headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, info: snapshot() })); }
    }, 600);
  } else if (path === '/tv/show' || path === '/tv/hide' || path === '/tv/pinstate') {
    var via = 'http ' + req.socket.remoteAddress;
    if (path === '/tv/show') showInfoNow(via, true);
    else if (path === '/tv/hide') hideInfo(via);
    else {
      tvPinned = /[?&]v=1(&|$)/.test(req.url); // the app reports Quick Access pin/unpin
      log('overlay reported ' + (tvPinned ? 'pinned' : 'unpinned'));
      if (tvPinned) lastPinReport = Date.now();
      if (tvPinned && lastLaunchAt) log('app answered ' + (Date.now() - lastLaunchAt) + ' ms after the last launch');
    }
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, pinned: path === '/tv/show' ? true : path === '/tv/hide' ? false : tvPinned }));
  } else if (path === '/app') {
    var qn = /[?&]name=([^&]*)/.exec(req.url), appName = '';
    if (qn) { try { appName = decodeURIComponent(qn[1].replace(/[+]/g, ' ')); } catch (e) { appName = ''; } }
    profiles.push(/[?&]clear=1(&|$)/.test(req.url) ? '' : appName);
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, app: profiles.current().key }));
  } else if (path === '/tv/qa') {
    // The app was launched with no parameters (the LG Quick Access key). The watcher's own pin state decides, so the
    // key still toggles when webOS started a fresh copy of the app that knows nothing about the bar.
    var qaVia = 'quick access ' + req.socket.remoteAddress, qaHide = tvPinned;
    if (qaHide) hideInfo(qaVia); else showInfoNow(qaVia, true);
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, action: qaHide ? 'hide' : 'pin' }));
  } else if (path === '/tv/auto') {
    var av = /[?&]v=([01])/.exec(req.url);
    if (av) { autoInfo = av[1] === '1'; saveSettings(); log('auto info ' + (autoInfo ? 'on' : 'off')); }
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, autoInfo: autoInfo }));
  } else if (path === '/tv/row') { // switch one row on or off for the TV bar (the /status page's row switches)
    var rq = /[?&]k=([a-z]+)&v=([01])/.exec(req.url);
    if (rq && ROW_KEYS.indexOf(rq[1]) >= 0) {
      hiddenRows = hiddenRows.filter(function (r) { return r !== rq[1]; });
      if (rq[2] === '0') hiddenRows.push(rq[1]);
      saveSettings();
      log('row ' + rq[1] + ' ' + (rq[2] === '1' ? 'shown' : 'hidden') + ' on the bar');
      if (tvPinned) scheduleInfo('rows changed', 300);
    }
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, hiddenRows: hiddenRows }));
  } else if (path === '/tv/order') { // reorder the rows (the /status page's drag handles); o = comma-separated keys in the new order
    var oq = /[?&]o=([a-z,]*)/.exec(req.url), sub = [];
    (oq ? oq[1].split(',') : []).forEach(function (k) { if (ROW_KEYS.indexOf(k) >= 0 && sub.indexOf(k) < 0) sub.push(k); });
    if (sub.length > 1) { // the rows listed take the places they held before, in the new order (rows with no data right now stay where they are)
      var cur = orderedKeys(), slots = [];
      cur.forEach(function (k, i) { if (sub.indexOf(k) >= 0) slots.push(i); });
      sub.forEach(function (k, j) { cur[slots[j]] = k; });
      rowOrder = cur;
      saveSettings();
      log('row order: ' + rowOrder.join(', '));
      if (tvPinned) scheduleInfo('rows reordered', 300);
    }
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, rowOrder: orderedKeys() }));
  } else if (path === '/tv/key') {
    var kq = req.url.split('?')[1] || '';
    log('overlay got key ' + kq);
    // the overlay swallowed a channel key while dismissing itself: carry it out
    // query forms: "33&fwd=1&pin=1" (channel key), "chan=20&fwd=1&pin=1" (typed number), plain "<code>" (diagnostic)
    var kp = {};
    kq.split('&').forEach(function (p) {
      var i = p.indexOf('=');
      if (i > 0) kp[p.slice(0, i)] = p.slice(i + 1); else if (p) kp.code = p;
    });
    if (kp.fwd === '1') {
      // The overlay says whether it was pinned when the key arrived. Its own unpin report can overtake this request,
      // and the watcher forgets the state when it restarts, so the app's word wins.
      var wasPinned = kp.pin === '1' || (kp.pin === undefined && tvPinned);
      tvPinned = wasPinned;
      var tuned = false;
      if (/^[0-9]{1,4}$/.test(kp.chan || '')) { openChannel(kp.chan); tuned = true; }
      else if (kp.code === '33' || kp.code === '34') {
        // wait for the overlay window to close: the control sends a key to whichever window has focus
        setTimeout(function () { changeChannel(kp.code === '33'); }, 700);
        tuned = true;
      }
      // bring the bar back for the new channel once it has settled (stale values first, refreshed in place)
      if (tuned) setTimeout(function () { showInfoNow('channel change', wasPinned); }, 2700);
    }
    res.writeHead(204, headers); res.end();
  } else if (path === '/status' || path === '/') {
    headers['Content-Type'] = 'text/html; charset=utf-8'; res.writeHead(200, headers); res.end(infoPage(false));
  } else if (path === '/status.rows.json') {
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers);
    var snap = snapshot();
    res.end(JSON.stringify({ title: pageTitle(snap), rows: infoRows(snap), pinned: tvPinned, autoInfo: autoInfo, updated: snap.updated }));
  } else if (path === '/status.json') {
    headers['Content-Type'] = 'application/json'; res.writeHead(200, headers); res.end(JSON.stringify(snapshot()));
  } else { res.writeHead(404, headers); res.end(); }
}).on('error', function (e) { log('info http error: ' + e.message); })
  .listen(INFO_HTTP_PORT, '0.0.0.0', function () { log('on-demand info at http://<tv>:' + INFO_HTTP_PORT + '/info'); });

// ---------- amp status (volume + program) ----------
function readVolume(s) {
  var av = s.actual_volume;
  if (av && typeof av.value === 'number') return av.value;
  return Number(s.volume) / 2;
}

// The number shown for the volume. 'numeric' mirrors the receiver's 0-97 display; 'db' shows decibels.
function volumeText(s, value) {
  if (volumeDisplay === 'db') {
    var av = s.actual_volume, db = (av && av.mode === 'db') ? value : value - 80.5; // numeric 0-97 maps to -80.5 .. +16.5 dB
    return db.toFixed(1) + ' dB';
  }
  return value % 1 ? value.toFixed(1) : String(value);
}

// Yamaha reports subwoofer trim and tone in 0.5 dB steps
function dB(steps) {
  var v = (Number(steps) || 0) * 0.5;
  return (v > 0 ? '+' : '') + (v % 1 ? v.toFixed(1) : String(v)) + ' dB';
}

// The app may be mid-close (info bar finishing) when the volume changes, which drops the launch;
// repeating it shortly afterwards guarantees the popup appears (a relaunch just refreshes it).
var volTimer = null;
function showVolume(value, mute) {
  launch({ volume: value, mute: mute, text: state.volumeText, output: 'yamaha', volFontSize: volFontSize, infoFontSize: infoFontSize });
  if (volTimer) clearTimeout(volTimer);
  volTimer = setTimeout(function () {
    volTimer = null;
    launch({ volume: state.volume, mute: state.mute, text: state.volumeText, output: 'yamaha', volFontSize: volFontSize, infoFontSize: infoFontSize });
  }, 600);
}

function handleStatus(s) {
  if (!s || s.response_code !== 0) return;
  if (profiles) profiles.onAmpStatus(s);
  if (s.power !== 'on') { // standby: forget the readings so nothing stale is shown, and re-baseline when it wakes
    lastVolume = null; progKey = null; audioKey = null; procKey = null;
    state.volume = null; state.volumeText = null; state.program = null; state.audio = null; state.processing = null; state.nowPlaying = null; nowKey = null;
    return;
  }

  var value = readVolume(s), mute = !!s.mute, current = value + ':' + mute;
  state.volume = value; state.volumeText = volumeText(s, value); state.mute = mute; state.updated = new Date();
  if (lastVolume === null) { lastVolume = current; log('watching ' + AMP_HOST + ' at ' + current); }
  else if (current !== lastVolume) {
    lastVolume = current;
    log('volume ' + current);
    showVolume(value, mute);
  }

  var prog = s.direct ? 'Direct' : (PROGRAMS[s.sound_program] || s.sound_program || '');
  if (!s.direct && s.sound_program === 'surr_decoder' && DECODERS[s.surr_decoder_type]) {
    prog += ' · ' + DECODERS[s.surr_decoder_type];
  }
  state.program = prog;

  var local = !!s.input && s.input !== tvInputId();
  var inputChanged = s.input !== state.ampInput;
  state.ampInput = s.input || null;
  state.ampLocal = local;
  if (inputChanged) {
    nowKey = null; state.nowPlaying = null;
    if (inputKeyed) { scheduleInfo('receiver input ' + (inputLabel(s.input) || 'none')); fetchSignal(); }
    inputKeyed = true;
    fetchNowPlaying();
  }

  var proc = [];
  if (s.enhancer) proc.push('Enhancer');
  if (s.adaptive_drc) proc.push('Adaptive DRC');
  if (s.extra_bass) proc.push('Extra Bass');
  if (typeof s.dialogue_level === 'number' && s.dialogue_level > 0) proc.push('Dialogue ' + s.dialogue_level);
  if (typeof s.subwoofer_volume === 'number' && s.subwoofer_volume !== 0) proc.push('Sub ' + dB(s.subwoofer_volume));
  var tc = s.tone_control;
  if (tc && tc.mode === 'manual' && (tc.bass || tc.treble)) proc.push('Bass ' + dB(tc.bass) + ' Treble ' + dB(tc.treble));
  state.processing = proc.join(' · ') || null;
  var pk = proc.join('|');
  if (procKey === null) { procKey = pk; }
  else if (pk !== procKey) { procKey = pk; scheduleInfo('processing ' + (state.processing || 'none')); }
  if (progKey === null) { progKey = prog; }
  else if (prog !== progKey) { progKey = prog; scheduleInfo('program ' + prog); fetchSignal(); }
}

function fetchStatus(subscribe) {
  if (inFlight) { refetch = true; return; }
  inFlight = true;
  var headers = subscribe ? { 'X-AppName': 'MusicCast/1.0(earc-overlay)', 'X-AppPort': String(EVENT_PORT) } : null;
  ampGet('/main/getStatus', headers, function (err, j) {
    inFlight = false;
    if (err) { if (err.message !== lastError) { lastError = err.message; log('amp unreachable: ' + err.message); } }
    else { lastError = null; state.lastOk = new Date(); handleStatus(j); }
    if (refetch) { refetch = false; fetchStatus(false); }
  });
}

// ---------- amp signal info (audio format) ----------
function fetchSignal() {
  if (signalInFlight) return;
  signalInFlight = true;
  ampGet('/main/getSignalInfo', null, function (err, j) {
    signalInFlight = false;
    if (err || !j || j.response_code !== 0 || !j.audio) return;
    var a = j.audio, parts = [];
    // During HDMI re-lock the amp briefly reports '---'; ignore those so the bar
    // never shows a dropout and transitions don't count as changes.
    if (!a.format || a.format === '---' || !a.fs || a.fs === '---') return;
    parts.push(a.format);
    if (a.fs) parts.push(a.fs);
    if (a.bit) parts.push(a.bit);
    var key = parts.join('|');
    if (a.bitrate > 0) parts.push(a.bitrate + ' kbps');
    state.audio = parts.join(' · ');
    if (audioKey === null) { audioKey = key; }
    else if (key !== audioKey) { audioKey = key; scheduleInfo('audio ' + state.audio); }
  });
}

// ---------- Audio (TV): what the TV itself sees on its input (optional, off by default) ----------
// HDMI inputs: the TV's HDMI diagnostics ("HDMI status" in the hidden menu) give codec, channel count and rate of the
// incoming stream, with or without a receiver. Other sources (Live TV, LG apps): only the codec the TV decodes.
var tvAudioInFlight = false, tvAudioKey = null;
var TV_CODEC = { pcm: 'PCM', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', aac: 'AAC', dts: 'DTS', mp3: 'MP3', truehd: 'TrueHD' };
function setTvAudio(text) {
  state.tvAudio = text;
  var key = text || '';
  if (tvAudioKey === null) { tvAudioKey = key; return; } // baseline: no pop-up
  if (key !== tvAudioKey) { tvAudioKey = key; scheduleInfo('LG TV audio ' + (text || 'none')); }
}
function fetchTvAudio() {
  if (!tvAudio || tvAudioInFlight) return;
  tvAudioInFlight = true;
  var hdmi = /^HDMI (\d)$/.exec(state.source || '');
  shared.lunaJson(LUNA, 'luna://com.webos.service.audio/tv/getAudioInputProperty', function (p) {
    var ap = p && p.audioInputProperty && p.audioInputProperty[0];
    if (!ap) { tvAudioInFlight = false; return; }
    var codec = ap.codec ? (TV_CODEC[String(ap.codec).toLowerCase()] || String(ap.codec).toUpperCase()) : null;
    if (!hdmi || !ap.pipelineId) { tvAudioInFlight = false; setTvAudio(codec); return; }
    shared.lunaJson(LUNA, 'luna://com.webos.service.extinputs.hdmi/getHDMIDiagnosticsInfo',
      JSON.stringify({ pipelineId: ap.pipelineId, port: Number(hdmi[1]) }), function (d) {
        tvAudioInFlight = false;
        var line = d && d.HDMIdiagnostics && d.HDMIdiagnostics.general && d.HDMIdiagnostics.general.sublist_3;
        var f = /^(.+?)\s+(\d+)Ch\s+(\d+)Hz/.exec(line || ''); // e.g. "PCM 8Ch 48000Hz"
        setTvAudio(f ? f[1] + ' · ' + f[2] + ' ch · ' + (Number(f[3]) / 1000) + ' kHz' : codec);
      });
  });
}

// ---------- TV video output (luna subscription; needs a pty, hence `script`) ----------
function fmtRate(r) {
  r = Number(r) || 0;
  var s = (Math.round(r * 1000) / 1000).toString();
  return s + ' fps';
}

function handleVideo(resp) {
  if (!resp || !resp.video) return;
  var v = null;
  for (var i = 0; i < resp.video.length; i++) if (resp.video[i].sink === 'MAIN') v = resp.video[i];
  if (!v || !v.connected || !v.width) return; // TV UI / no signal: keep last state
  var vi = v.videoInfo || {};
  var hdr = HDR[String(vi.hdrType || '').toLowerCase()] || vi.hdrType || 'SDR';
  var scan = v.scanType === 'interlaced' ? 'i' : 'p';
  state.video = v.width + '×' + v.height + scan + ' · ' + fmtRate(v.frameRate) + ' · ' + hdr;

  var isSdr = hdr === 'SDR';
  var csOrder = isSdr ? [vi.colormetry] : [vi.additionalColormetry, vi.colormetry];
  var cs = csOrder.filter(function (c) { return c && c !== 'NODATA'; })[0] || (isSdr ? 'BT.709' : '');
  var range = /rgb/i.test(vi.pixelEncoding || '') ? vi.rgbRange : vi.ycbcrRange;
  var enc = vi.pixelEncoding ? vi.pixelEncoding.replace(/^YCBCR/i, 'YCbCr ') : '';
  if (enc && range) enc += ' ' + range.charAt(0) + range.slice(1).toLowerCase();
  var colour = [];
  if (enc) colour.push(enc);
  if (cs) colour.push(COLOUR[cs.toLowerCase()] || cs);
  state.colour = colour.join(' · ') || null;

  var app = v.appId || '';
  var m = app.match(/hdmi(\d)/);
  var prevSource = state.source;
  state.source = m ? 'HDMI ' + m[1] : (/livetv|tvsource|dtv/i.test(app + v.connectedSource) ? 'Live TV' : (v.connectedSource === 'VDEC' ? 'LG TV apps' : (v.connectedSource || null))); // VDEC = the TV's own video decoder (apps running on the TV)
  // Switching input closes the overlay window; bring a pinned bar back once the new input has settled.
  if (tvPinned && prevSource && state.source && prevSource !== state.source) {
    log('input changed to ' + state.source + ' while pinned; restoring the bar');
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(function () { restoreTimer = null; if (tvPinned) showInfoNow('input change', true); }, 1200);
  }

  var key = [v.width, v.height, scan, v.frameRate, hdr, app].join('|');
  if (videoKey === null) { videoKey = key; log('video baseline ' + state.video); }
  else if (key !== videoKey) { videoKey = key; scheduleInfo('video ' + state.video); fetchSignal(); fetchTvAudio(); }
}

var subscriptions = [];
function startVideoWatch() {
  subscriptions.push(shared.lunaSubscribe(LUNA, 'luna://com.webos.service.videooutput/getStatus', '{"subscribe":true}', handleVideo, log, 'video'));
  subscriptions.push(shared.lunaSubscribe(LUNA, 'luna://com.webos.applicationManager/running', '{"subscribe":true}', onRunning, log, 'running'));
}

// ---------- Plex Media Server session details (source codec / channels / bitrate) ----------
var PLEX_AUDIO = { truehd: 'TrueHD', eac3: 'DD+', ac3: 'Dolby Digital', aac: 'AAC', flac: 'FLAC', opus: 'Opus',
  mp3: 'MP3', pcm: 'PCM', alac: 'ALAC', vorbis: 'Vorbis' };
var PLEX_DTS = { ma: 'DTS-HD MA', hra: 'DTS-HD HRA', x: 'DTS:X', es: 'DTS-ES', '96_24': 'DTS 96/24' };

var legacyPlex = { at: 0, val: null }; // the old standalone Plex file, re-read at most every 30 s
function readPlexConfig() {
  if (plexSettings && plexSettings.disabled) return null;
  if (plexSettings && plexSettings.url && plexSettings.token) return plexSettings;
  if (Date.now() - legacyPlex.at > 30000) {
    legacyPlex.at = Date.now();
    try { var c = JSON.parse(fs.readFileSync(PLEX_CONFIG, 'utf8')); legacyPlex.val = (c && c.url && c.token) ? c : null; }
    catch (e) { legacyPlex.val = null; }
  }
  return legacyPlex.val;
}

function plexAudio(a) {
  if (!a) return null;
  var codec = String(a.codec || '').toLowerCase(), name;
  if (codec === 'dca' || codec === 'dts') name = PLEX_DTS[String(a.profile || '').toLowerCase()] || 'DTS';
  else name = PLEX_AUDIO[codec] || codec.toUpperCase();
  var title = (a.extendedDisplayTitle || '') + ' ' + (a.displayTitle || '');
  if (/atmos/i.test(title)) name += ' Atmos';
  if (/dts:x/i.test(title) && name.indexOf('DTS:X') < 0) name = 'DTS:X';
  var ch = a.audioChannelLayout ? String(a.audioChannelLayout).replace(/\(.*\)/, '') : '';
  if (!ch && a.channels) ch = { 1: '1.0', 2: '2.0', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' }[a.channels] || (a.channels + 'ch');
  if (ch === 'stereo') ch = '2.0';
  if (ch === 'mono') ch = '1.0';
  var out = name + (ch ? ' ' + ch : '');
  if (a.bitrate) out += ' · ' + a.bitrate + ' kbps';
  return out;
}

function plexSummary(md) {
  var media = (md.Media || [])[0] || {}, part = (media.Part || [])[0] || {}, streams = part.Stream || [];
  var a = null, v = null;
  streams.forEach(function (st) {
    if (st.streamType === 2 && (st.selected || !a)) a = st;
    if (st.streamType === 1 && !v) v = st;
  });
  var bits = [];
  var audio = plexAudio(a);
  if (audio) bits.push(audio);
  if (v && v.displayTitle) bits.push(v.displayTitle);
  if (media.bitrate) bits.push((Math.round(media.bitrate / 100) / 10) + ' Mbps');
  var tc = md.TranscodeSession;
  var decision = !tc ? 'Direct Play' :
    (tc.videoDecision === 'transcode' || tc.audioDecision === 'transcode') ? 'Transcode' : 'Direct Stream';
  bits.push(decision);
  return { text: 'Plex: ' + bits.join(' · '), key: [md.ratingKey, a && a.id, decision].join('|') };
}

function pickSession(list, cfg) {
  var live = list.filter(function (md) {
    var pl = md.Player || {};
    return /playing|paused|buffering/.test(pl.state || '');
  });
  if (cfg.player_ip) return live.filter(function (md) { return (md.Player || {}).address === cfg.player_ip; })[0] || null;
  return live.filter(function (md) {
    var pl = md.Player || {};
    return /tvos|apple ?tv|infuse/i.test([pl.platform, pl.product, pl.title, pl.device].join(' '));
  })[0] || null;
}

function clearPlex() {
  state.plex = null; plexKey = null;
  if (state.plexApp) { state.plexApp = null; if (profiles) profiles.onPlexApp(); }
}

function fetchPlex() {
  if (plexInFlight) return;
  if (!state.source || state.source.indexOf('HDMI') !== 0) { clearPlex(); return; } // only while on the Apple TV input
  var cfg = readPlexConfig();
  if (!cfg) { clearPlex(); return; }
  plexInFlight = true;
  shared.getJson({ url: cfg.url.replace(/\/+$/, '') + '/status/sessions', headers: { 'Accept': 'application/json', 'X-Plex-Token': cfg.token },
    timeout: 2500, verifyTls: cfg.verifyTls === true }, function (err, j, code) {
    plexInFlight = false;
    if (err) { log('plex: ' + err.message); return; }
    if (code !== 200) { log('plex: HTTP ' + code); return; }
    if (!j) { log('plex: parse error'); return; }
    var md = pickSession((j.MediaContainer || {}).Metadata || [], cfg);
    if (!md) { clearPlex(); return; }
    var sum = plexSummary(md);
    state.plex = sum.text;
    var product = ((md.Player || {}).product || '').slice(0, 40) || null;
    if (product !== state.plexApp) { state.plexApp = product; if (profiles) profiles.onPlexApp(); }
    if (sum.key !== plexKey) { plexKey = sum.key; scheduleInfo(sum.text); }
  });
}

// ---------- Jellyfin (optional media info) ----------
function readJellyfinConfig() {
  if (jellyfinSettings && jellyfinSettings.disabled) return null;
  if (jellyfinSettings && jellyfinSettings.url && jellyfinSettings.apiKey) return jellyfinSettings;
  return null;
}

function jellyfinAudio(a) {
  if (!a) return null;
  var title = (a.DisplayTitle || '').trim();
  if (title) {
    if (a.BitRate) title += ' · ' + Math.round(a.BitRate / 1000) + ' kbps';
    return title;
  }
  var codec = String(a.Codec || '').toLowerCase();
  var codecNames = { truehd: 'TrueHD', eac3: 'DD+', ac3: 'Dolby Digital', aac: 'AAC',
    flac: 'FLAC', opus: 'Opus', mp3: 'MP3', dca: 'DTS', dts: 'DTS', vorbis: 'Vorbis' };
  var name = codecNames[codec] || codec.toUpperCase();
  var ch = String(a.ChannelLayout || '');
  if (!ch && a.Channels) ch = { 1: '1.0', 2: '2.0', 6: '5.1', 7: '6.1', 8: '7.1' }[a.Channels] || (a.Channels + 'ch');
  var out = name + (ch ? ' ' + ch : '');
  if (a.BitRate) out += ' · ' + Math.round(a.BitRate / 1000) + ' kbps';
  return out;
}

function jellyfinSummary(session) {
  var item = session.NowPlayingItem || {}, streams = item.MediaStreams || [];
  var audio = null, video = null;
  streams.forEach(function (s) {
    if (s.Type === 'Audio' && (s.IsDefault || !audio)) audio = s;
    if (s.Type === 'Video' && !video) video = s;
  });
  var bits = [];
  var audioLabel = jellyfinAudio(audio);
  if (audioLabel) bits.push(audioLabel);
  if (video && video.DisplayTitle) bits.push(video.DisplayTitle);
  var tc = session.TranscodingInfo;
  var decision = !tc ? 'Direct Play' : (tc.IsVideoDirect && tc.IsAudioDirect) ? 'Direct Stream' : 'Transcode';
  bits.push(decision);
  return { text: 'Jellyfin: ' + bits.join(' · '), key: [(item.Id || ''), (audio && audio.Index), decision].join('|') };
}

function pickJellyfinSession(list, cfg) {
  var active = list.filter(function (s) { return !!s.NowPlayingItem; });
  if (cfg.deviceName) {
    var dn = cfg.deviceName.toLowerCase();
    return active.filter(function (s) {
      return (s.DeviceName || '').toLowerCase().indexOf(dn) >= 0 ||
             (s.Client || '').toLowerCase().indexOf(dn) >= 0;
    })[0] || null;
  }
  return active[0] || null;
}

function clearJellyfin() { state.jellyfin = null; jellyfinKey = null; }

function fetchJellyfin() {
  if (jellyfinInFlight) return;
  if (!state.source || state.source.indexOf('HDMI') !== 0) { clearJellyfin(); return; }
  var cfg = readJellyfinConfig();
  if (!cfg) { clearJellyfin(); return; }
  jellyfinInFlight = true;
  shared.getJson({ url: cfg.url.replace(/\/+$/, '') + '/Sessions', headers: { Accept: 'application/json', 'X-MediaBrowser-Token': cfg.apiKey },
    timeout: 2500, verifyTls: cfg.verifyTls === true }, function (err, list, code) {
    jellyfinInFlight = false;
    if (err) { log('jellyfin: ' + err.message); return; }
    if (code !== 200) { log('jellyfin: HTTP ' + code); return; }
    if (!Array.isArray(list)) { if (list === null) log('jellyfin: parse error'); clearJellyfin(); return; }
    var session = pickJellyfinSession(list, cfg);
    if (!session) { clearJellyfin(); return; }
    var sum = jellyfinSummary(session);
    state.jellyfin = sum.text;
    if (sum.key !== jellyfinKey) { jellyfinKey = sum.key; scheduleInfo(sum.text); }
  });
}

// ---------- amp UDP events ----------
var sock = dgram.createSocket('udp4');
sock.on('message', function (msg) {
  try {
    var ev = JSON.parse(String(msg)), m = ev.main;
    if (ev.netusb && (ev.netusb.play_info_updated || ev.netusb.preset_info_updated)) fetchNowPlaying();
    if (!m) return;
    if (m.signal_info_updated) fetchSignal();
    if (m.volume !== undefined || m.mute !== undefined || m.power !== undefined ||
        m.sound_program !== undefined || m.direct !== undefined || m.enhancer !== undefined ||
        m.dialogue_level !== undefined || m.subwoofer_volume !== undefined || m.input !== undefined || m.status_updated) fetchStatus(false);
  } catch (e) {}
});
sock.on('error', function (e) { log('udp error: ' + e.message); });
sock.bind(EVENT_PORT, function () { log('listening for amp events on udp/' + EVENT_PORT); });

function stop() {
  try { sock.close(); } catch (e) {}
  subscriptions.forEach(function (sub) { sub.stop(); });
  shared.stopAllSubscriptions();
  process.exit(0);
}
// a stray exception should not take the overlay down until the next reboot
process.on('uncaughtException', function (e) { log('uncaught exception: ' + (e && e.stack || e)); });
process.on('unhandledRejection', function (e) { log('unhandled rejection: ' + (e && e.stack || e)); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', function () { try { shared.stopAllSubscriptions(); } catch (e) {} });

// Show on TV is a saved preference: any change of tvPinned (the page switch, Quick Access, the remote dismissing the bar) is written
// to the settings file, and a restart or TV reboot puts the bar back. The TV may still be booting, so retry until the app confirms.
var savedPin = pinWanted, lastPinReport = 0;
if (pinWanted) tvPinned = true; // the bar stays wanted (and saved as on) until the user switches it off
var pinSaver = setInterval(function () { if (tvPinned !== savedPin) { savedPin = tvPinned; saveSettings(); } }, 2000);
if (pinSaver.unref) pinSaver.unref();
function restorePin(attempt) {
  if (!pinWanted || lastPinReport || (attempt > 0 && !tvPinned)) return; // done, or the user switched it off meanwhile
  log('restoring the pinned bar after a restart' + (attempt ? ' (attempt ' + (attempt + 1) + ')' : ''));
  showInfoNow('restore pin after restart', true);
  if (attempt < 8) setTimeout(function () { if (!lastPinReport && tvPinned) restorePin(attempt + 1); }, 15000);
}
if (pinWanted) setTimeout(function () { restorePin(0); }, 8000);

log('service starting (yamaha ' + (AMP_HOST || 'not configured') + ', with signal info)');
// the app can be removed from the Homebrew Channel without any uninstall hook; clean up after ourselves then (TV only)
require('./orphan.js').start({ runtimeDir: __dirname, appId: APP_ID, log: log, onOrphaned: stop });
fetchStatus(true);
fetchSignal();
startVideoWatch();
setInterval(function () { fetchStatus(true); }, RESUBSCRIBE_MS);
setInterval(function () { fetchStatus(false); }, POLL_MS);
setInterval(fetchSignal, SIGNAL_POLL_MS);
setInterval(fetchTvAudio, SIGNAL_POLL_MS);
setInterval(fetchPlex, PLEX_POLL_MS);
setInterval(fetchJellyfin, JELLYFIN_POLL_MS);
setInterval(fetchNowPlaying, NOW_POLL_MS); // fallback for network sources whose events are missed
