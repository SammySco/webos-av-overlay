'use strict';

// Per-app sound programs for a Yamaha receiver.
//
// The watcher works out "what is being watched" (the context key) and, when it changes, looks the key up in the
// user's rules and sets the receiver's sound program (plus the surround decoder type for "surr_decoder").
//
// Context key, most specific first:
//   1. an app name pushed to /app?name=... (Home Assistant sends the Apple TV app), while the TV is on an HDMI input
//   2. the Plex player product (for example "Infuse") while a Plex session is playing on an HDMI input
//   3. the LG foreground app: "Live TV", "HDMI 1", or the title of a webOS app such as "Netflix"
// Nothing is changed unless "enabled" is on, the receiver is on the configured TV input, and a rule (or the
// default) matches. The receiver is only commanded when its current program differs from the target.

var shared = require('./shared.js');

var DEFAULT_PROGRAMS = ['munich', 'vienna', 'chamber', 'cellar_club', 'roxy_theatre', 'bottom_line', 'sports', 'action_game',
  'roleplaying_game', 'music_video', 'standard', 'spectacle', 'sci-fi', 'adventure', 'drama', 'mono_movie', '2ch_stereo',
  '5ch_stereo', 'surr_decoder', 'straight'];
var DEFAULT_DECODERS = ['dolby_pl2x_movie', 'dolby_pl2x_music', 'dolby_pl2x_game', 'dts_neo6_cinema', 'dts_neo6_music'];
// Apple TV app names as Home Assistant reports them (the "app_name" attribute); the user can type others
var ATV_APPS = ['Netflix', 'Disney+', 'Prime Video', 'YouTube', 'Stan', 'TV', 'Apple Music', 'Spotify', 'TIDAL', 'Infuse', 'Plex',
  'Kayo', 'BINGE', 'SBS On Demand', '9Now', '10', 'Paramount+', 'Max', 'ABC iview', 'Apple Podcasts', 'Apple Arcade'];
// the receiver's own sources, named as the overlay names them (see inputLabel in the watcher)
var AMP_SOURCES = ['TIDAL', 'NET RADIO', 'Spotify', 'AirPlay', 'Bluetooth', 'USB', 'Deezer', 'Qobuz', 'Amazon Music', 'Server',
  'MusicCast Link', 'Tuner', 'Napster'];
var SETTLE_MS = 2000;      // wait for the input to settle after a change, as the old Home Assistant automation did
var FOREGROUND_POLL_MS = 15000; // safety net only: the foreground app arrives by subscription
var GUARD_MS = 2000;
var PUSHED_TTL_MS = 12 * 60 * 60 * 1000; // a pushed Apple TV app name is forgotten after this long without a refresh
var SEEN_MAX = 40;
var RULES_MAX = 40;
var IGNORED_APPS = ['com.webos.app.home', 'com.webos.app.livemenu', 'com.webos.app.livedmost', 'com.sammysco.avoverlay',
  'com.sammysco.avoverlay.settings', 'com.webos.app.notification', 'com.webos.app.systemui', 'com.webos.app.starfish_flutter_systemui',
  'com.webos.app.channeledit', 'com.webos.app.connectionwizard'];

module.exports = function createProfiles(ctx) {
  var features = null, featuresAt = 0;
  var pushed = null;                 // {name, at}
  var fg = { id: null, title: null };
  var titles = {}, titlesAt = 0;     // launch point id -> title
  var tvApps = [], inputNames = {};  // installed webOS app titles, custom input names ('HDMI 1' -> 'Apple TV')
  var lastKey = null, lastKind = null, timer = null, busy = false;
  var last = { key: null, rule: null, program: null, decoder: null, result: 'not run yet', at: null };
  var ampInput = null;

  function lists() {
    return {
      programs: (features && features.programs) || DEFAULT_PROGRAMS,
      decoders: (features && features.decoders) || DEFAULT_DECODERS,
      inputs: (features && features.inputs) || []
    };
  }

  function loadFeatures(cb) {
    if (features && Date.now() - featuresAt < 10 * 60 * 1000) return cb && cb(features);
    ctx.ampGet('/system/getFeatures', function (err, j) {
      if (!err && j && j.zone) {
        var z = j.zone.filter(function (x) { return x.id === 'main'; })[0] || {};
        features = {
          programs: z.sound_program_list || null,
          decoders: (z.surr_decoder_type_list || []).filter(function (d) { return d !== 'toggle'; }),
          inputs: ((j.system || {}).input_list || []).map(function (i) { return i.id; })
        };
        featuresAt = Date.now();
      }
      if (cb) cb(features);
    });
  }

  function cfg() {
    var s = ctx.getSound() || {};
    return {
      enabled: !!s.enabled,
      tvInput: typeof s.tvInput === 'string' && s.tvInput ? s.tvInput : 'audio1',
      appInput: typeof s.appInput === 'string' ? s.appInput : '',
      def: s.default && s.default.program ? s.default : null,
      rules: Array.isArray(s.rules) ? s.rules : [],
      seen: Array.isArray(s.seen) ? s.seen : []
    };
  }

  // ---------- webOS foreground app ----------
  function lunaJson(uri, cb) { shared.lunaJson(ctx.luna, uri, cb); }

  function loadTitles(cb) {
    titlesAt = Date.now();
    lunaJson('luna://com.webos.applicationManager/listLaunchPoints', function (j) {
      var apps = [];
      ((j && j.launchPoints) || []).forEach(function (lp) {
        if (!lp.id || !lp.title) return;
        titles[lp.id] = lp.title;
        var h = /^com\.webos\.app\.hdmi(\d)$/.exec(lp.id);
        if (h) { inputNames['HDMI ' + h[1]] = lp.title; return; }
        if (lp.systemApp || lp.hidden || /^(org\.webosbrew|com\.sammysco)/.test(lp.id) || IGNORED_APPS.indexOf(lp.id) >= 0) return;
        apps.push(lp.title);
      });
      if (apps.length) tvApps = apps.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
      if (cb) cb();
    });
  }

  function foregroundOf(j) { // the plain reply names the foreground app; otherwise pick the focused card
    if (j && j.appId) return j.appId;
    var list = (j && j.foregroundAppInfo) || [];
    var cards = list.filter(function (e) { return e.windowType === '_WEBOS_WINDOW_TYPE_CARD'; });
    var e = cards.filter(function (c) { return c.windowGroupOwner === true; })[0] || cards[0];
    return e ? e.appId : null;
  }

  function readForeground(cb) {
    lunaJson('luna://com.webos.applicationManager/getForegroundAppInfo', function (j) { cb(foregroundOf(j)); });
  }

  function friendly(id) {
    if (!id) return null;
    var m = /^com\.webos\.app\.hdmi(\d)$/.exec(id);
    if (m) return 'HDMI ' + m[1];
    if (id === 'com.webos.app.livetv') return 'Live TV';
    if (IGNORED_APPS.indexOf(id) >= 0) return null;
    return titles[id] || id;
  }

  // ---------- context ----------
  function pushedName() { // the Apple TV app Home Assistant last reported, unless that report is stale
    if (pushed && Date.now() - pushed.at > PUSHED_TTL_MS) { ctx.log('app pushed: expired (' + pushed.name + ')'); pushed = null; }
    return pushed ? pushed.name : null;
  }

  function contextKey() {
    var c = cfg();
    if (ampInput && ampInput !== c.tvInput && ctx.inputLabel) return ctx.inputLabel(ampInput); // TIDAL, NET RADIO, ...
    var base = friendly(fg.id);
    if (base && base.indexOf('HDMI') === 0) {
      var pn = pushedName();
      if (pn && (!c.appInput || c.appInput === base)) return pn;
      var pa = ctx.getPlexApp();
      if (pa) return pa;
    }
    return base;
  }

  // Where the key came from: an input ('input'), an app on the Apple TV ('atv', also Plex players) or an LG app ('lg').
  // A rule can be limited to one of these, so "Netflix" on the Apple TV and the LG Netflix app can differ.
  function contextKind() {
    if (ampInput && ampInput !== cfg().tvInput) return 'amp';
    var base = friendly(fg.id);
    if (!base) return null;
    if (base.indexOf('HDMI') === 0) {
      var c = cfg();
      if (pushedName() && (!c.appInput || c.appInput === base)) return 'atv';
      if (ctx.getPlexApp()) return 'atv';
      return 'input';
    }
    return base === 'Live TV' ? 'input' : 'lg';
  }

  function rememberSeen(key) {
    if (!key) return;
    var s = ctx.getSound() || {};
    var seen = Array.isArray(s.seen) ? s.seen.slice() : [];
    var i = seen.map(function (x) { return x.toLowerCase(); }).indexOf(key.toLowerCase());
    if (i === 0) return;
    if (i > 0) seen.splice(i, 1);
    seen.unshift(key);
    s.seen = seen.slice(0, SEEN_MAX);
    ctx.setSound(s);
  }

  function findRule(key, kind, c) {
    var k = String(key).toLowerCase();
    var rules = c.rules, anyMatch = null;
    for (var i = 0; i < rules.length; i++) {
      if (!rules[i] || String(rules[i].app || '').trim().toLowerCase() !== k) continue;
      var rk = rules[i].kind || 'any';
      if (rk === kind) return rules[i];          // a rule for exactly this kind of source wins
      if (rk === 'any' && !anyMatch) anyMatch = rules[i];
    }
    return anyMatch;
  }

  // ---------- applying ----------
  function note(result) {
    if (last.result !== result) ctx.log('sound program: ' + result);
    last.result = result;
    last.at = new Date().toISOString();
  }

  function setAmp(path, cb) { ctx.ampGet(path, function (err, j) { cb(!err && j && j.response_code === 0); }); }

  function apply(target, key, ruleName, s, done) {
    var sameProgram = s.sound_program === target.program;
    var sameDecoder = target.program !== 'surr_decoder' || !target.decoder || s.surr_decoder_type === target.decoder;
    last.key = key; last.rule = ruleName; last.program = target.program; last.decoder = target.decoder || null;
    if (sameProgram && sameDecoder) { note(key + ': already ' + target.program + (target.decoder ? ' / ' + target.decoder : '')); return done(); }
    setAmp('/main/setSoundProgram?program=' + encodeURIComponent(target.program), function (ok) {
      if (!ok) { note(key + ': the receiver refused ' + target.program); return done(); }
      if (target.program === 'surr_decoder' && target.decoder && !sameDecoder) {
        setAmp('/main/setSurroundDecoderType?type=' + encodeURIComponent(target.decoder), function (ok2) {
          note(key + ' -> ' + target.program + ' / ' + target.decoder + (ok2 ? '' : ' (decoder not accepted)'));
          done();
        });
      } else {
        note(key + ' -> ' + target.program);
        done();
      }
    });
  }

  function run(force) {
    var c = cfg();
    if (!c.enabled && !force) return;
    if (busy) { schedule(500); return; }
    busy = true;
    ctx.ampGet('/main/getStatus', function (err, s) {
      var done = function () { busy = false; };
      if (err || !s || s.response_code !== 0) { note('receiver not reachable'); return done(); }
      ampInput = s.input;
      if (s.power !== 'on') { note('receiver is off'); return done(); }
      var key = contextKey();
      if (!key) { note('nothing to match (home screen or unknown input)'); return done(); }
      rememberSeen(key);
      var rule = findRule(key, contextKind(), c);
      if (s.input !== c.tvInput) { // the receiver is playing one of its own sources: only an explicit rule applies, never the default
        if (!rule) { note(key + ': receiver source with no rule - left alone'); return done(); }
        return apply(rule, key, rule.app, s, done);
      }
      var target = rule || c.def;
      if (!target || !target.program) { note(key + ': no rule and no default - left alone'); return done(); }
      apply(target, key, rule ? rule.app : '(default)', s, done);
    });
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; run(false); }, ms === undefined ? SETTLE_MS : ms);
  }

  // ---------- Spotify guard ----------
  // Spotify Connect to the Apple TV sends the sound over HDMI, but the receiver stays on its own idle Spotify input, so
  // nothing is heard. When the Apple TV says Spotify is playing, the receiver is on a network source that is not playing
  // and the TV is on the Apple TV's input, switch the receiver to the TV input. Connect straight to the receiver is left
  // alone because the receiver is then playing.
  var guardHits = 0, guardBusy = false;
  function guardTick() {
    var c = cfg();
    var pn = pushedName();
    var onAtv = pn && /^spotify$/i.test(pn) && /^HDMI/.test(friendly(fg.id) || '') &&
      (!c.appInput || c.appInput === friendly(fg.id));
    if (!c.enabled || !onAtv || ampInput !== 'spotify' || guardBusy) { guardHits = 0; return; }
    guardBusy = true;
    ctx.ampGet('/netusb/getPlayInfo', function (err, p) {
      guardBusy = false;
      var playing = !err && p && p.playback === 'play';
      if (err || !p || playing) { guardHits = 0; return; }
      if (++guardHits < 3) return; // about 6 s of silence, so a track change or a quick tap does not trigger it
      guardHits = 0;
      setAmp('/main/setInput?input=' + encodeURIComponent(c.tvInput), function (ok) {
        ctx.log('Spotify guard: Apple TV is playing Spotify while the receiver was idle on ' + ampInput + ' -> ' +
          (ok ? 'switched the receiver to ' + c.tvInput : 'the receiver refused the input change'));
        if (ok) { ampInput = c.tvInput; noteContext(); schedule(); }
      });
    });
  }

  // ---------- inputs from the watcher ----------
  function setForeground(id) { // called for every foreground-app report (subscription and safety poll)
    var prev = fg.id;
    var f = friendly(id);
    if (id && f && !titles[id] && !/^(HDMI|Live)/.test(f) && Date.now() - titlesAt > 60000) loadTitles();
    fg.id = id;
    if (id !== prev && ctx.onForeground) ctx.onForeground(id, prev);
    noteContext();
  }

  // The context (what is being watched) may change from several directions; one place reacts to it.
  function noteContext() {
    var key = contextKey(), kind = contextKind();
    if (key === lastKey && kind === lastKind) return;
    lastKey = key; lastKind = kind;
    if (key) rememberSeen(key);
    if (ctx.onContext) ctx.onContext(key, kind);
    schedule();
  }

  function push(name) {
    name = String(name || '').trim().slice(0, 60);
    pushed = name ? { name: name, at: Date.now() } : null;
    ctx.log('app pushed: ' + (name || '(cleared)'));
    if (name) rememberSeen(name);
    noteContext();
  }

  function onAmpStatus(s) { // switching the receiver to the TV input counts as a change
    if (!s) return;
    var was = ampInput;
    ampInput = s.input;
    if (was !== null && was !== s.input) { noteContext(); schedule(); }
  }

  function onPlexApp() { noteContext(); }

  var guard = setInterval(guardTick, GUARD_MS); // always on: cheap unless Spotify is playing on the Apple TV
  if (guard.unref) guard.unref();
  var fgPoll = setInterval(function () { readForeground(setForeground); }, FOREGROUND_POLL_MS);
  if (fgPoll.unref) fgPoll.unref();
  shared.lunaSubscribe(ctx.luna, 'luna://com.webos.applicationManager/getForegroundAppInfo', '{"subscribe":true}',
    function (j) { setForeground(foregroundOf(j)); }, ctx.log, 'foreground');
  loadTitles();
  loadFeatures();

  return {
    push: push,
    ruleFor: function (key, kind) { return findRule(key, kind, cfg()); },
    inputName: function (label) { var n = inputNames[label]; return n && n !== label ? n : null; },
    currentInputName: function () { var b = friendly(fg.id); return b && inputNames[b] && inputNames[b] !== b ? inputNames[b] : null; },
    onAmpStatus: onAmpStatus,
    onPlexApp: onPlexApp,
    foreground: function () { return fg.id; },
    applyNow: function () { run(true); },
    // everything the rule editor offers in its app/input drop-down
    choices: function () {
      var inputs = [{ value: 'Live TV', label: 'Live TV' }];
      for (var n = 1; n <= 4; n++) {
        var name = inputNames['HDMI ' + n];
        inputs.push({ value: 'HDMI ' + n, label: 'HDMI ' + n + (name && name !== 'HDMI ' + n ? ' - ' + name : '') });
      }
      return { inputs: inputs, tvApps: tvApps.slice(), atv: ATV_APPS.slice(), amp: AMP_SOURCES.slice(), seen: cfg().seen.slice() };
    },
    refreshTitles: function (cb) { loadTitles(cb); },
    lists: function (cb) { loadFeatures(function () { cb(lists()); }); },
    current: function () {
      var c = cfg();
      return { key: contextKey(), kind: contextKind(), foreground: fg.id, pushed: pushedName(), plexApp: ctx.getPlexApp(),
        enabled: c.enabled, last: last, seen: c.seen };
    },
    // validates and normalises the "sound" block posted by the setup page
    validate: function (b) {
      var L = lists();
      if (!b || typeof b !== 'object') return { error: 'Sound settings are missing' };
      var out = { enabled: !!b.enabled };
      var ti = String(b.tvInput || 'audio1').trim();
      if (!/^[a-z0-9_]{1,24}$/.test(ti)) return { error: 'The receiver input name is not valid' };
      out.tvInput = ti;
      var ai = String(b.appInput || '').trim();
      if (ai && !/^HDMI [1-4]$/.test(ai)) return { error: 'The app input must be HDMI 1-4 or empty' };
      out.appInput = ai;
      function target(t, label) {
        if (!t || !t.program) return { value: null };
        if (L.programs.indexOf(t.program) < 0) return { error: label + ': unknown sound program' };
        var o = { program: t.program };
        if (t.program === 'surr_decoder' && t.decoder) {
          if (L.decoders.indexOf(t.decoder) < 0) return { error: label + ': unknown surround decoder' };
          o.decoder = t.decoder;
        }
        return { value: o };
      }
      var d = target(b.default, 'Default');
      if (d.error) return d;
      out.default = d.value;
      var rules = Array.isArray(b.rules) ? b.rules : [];
      if (rules.length > RULES_MAX) return { error: 'At most ' + RULES_MAX + ' rules' };
      out.rules = [];
      for (var i = 0; i < rules.length; i++) {
        var app = String(rules[i].app || '').trim();
        if (!app) continue;
        if (app.length > 60 || /[\u0000-\u001f]/.test(app)) return { error: 'Rule ' + (i + 1) + ': the app name is not valid' };
        var t = target(rules[i], 'Rule "' + app + '"');
        if (t.error) return t;
        if (!t.value) return { error: 'Rule "' + app + '": choose a sound program' };
        t.value.app = app;
        var kind = String(rules[i].kind || 'any');
        if (['any', 'input', 'lg', 'atv', 'amp'].indexOf(kind) < 0) return { error: 'Rule "' + app + '": unknown source type' };
        t.value.kind = kind;
        out.rules.push(t.value);
      }
      out.seen = cfg().seen;
      return { value: out };
    }
  };
};
