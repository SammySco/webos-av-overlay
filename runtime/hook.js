'use strict';

// Keeps the boot hook working after a Homebrew Channel install or update.
// Homebrew extracts the IPK without the executable bit, so a boot hook that is a symlink to runtime/91-earc-volume-overlay
// fails with "Permission denied" and the watcher no longer starts at boot. The hook is therefore a small wrapper file that
// runs the script with `sh`, which needs no executable bit. On start the watcher (re)writes the wrapper when the hook is
// missing, a symlink into this app, or an older wrapper, and restores the script's mode. Only active in a webOS app folder.

var fs = require('fs');
var path = require('path');

var HOOK = '/var/lib/webosbrew/init.d/91-earc-volume-overlay';
var MARKER = '# earc-volume-overlay boot hook';

function wrapper(script) {
  return '#!/bin/sh\n' + MARKER + ' (runs the app script with sh, so it needs no executable bit)\n' +
    'S="' + script + '"\n[ -f "$S" ] && exec /bin/sh "$S"\nexit 0\n';
}

function isOurs(hook, appDir) {
  try {
    var st = fs.lstatSync(hook);
    if (st.isSymbolicLink()) return fs.readlinkSync(hook).indexOf(appDir + path.sep) === 0;
    var txt = fs.readFileSync(hook, 'utf8');
    return txt.indexOf(MARKER) >= 0 && txt.indexOf(appDir + path.sep) >= 0;
  } catch (e) { return false; }
}

// returns 'ok' (already current), 'written', or 'skipped' (a foreign file is in the way / error)
function ensure(appDir, opts) {
  opts = opts || {};
  var hook = opts.hook || HOOK;
  var script = path.join(appDir, 'runtime', '91-earc-volume-overlay');
  try { fs.chmodSync(script, 493); } catch (e) { /* read-only or missing: the wrapper copes */ }
  var want = wrapper(script), st = null;
  try { st = fs.lstatSync(hook); } catch (e) { /* missing */ }
  if (st && !st.isSymbolicLink()) {
    var cur = '';
    try { cur = fs.readFileSync(hook, 'utf8'); } catch (e) {}
    if (cur === want) { try { fs.chmodSync(hook, 493); } catch (e) {} return 'ok'; }
    if (cur.indexOf(MARKER) < 0) return 'skipped';
  } else if (st && !isOurs(hook, appDir)) {
    return 'skipped';
  }
  try {
    try { fs.mkdirSync(path.dirname(hook)); } catch (e) { /* exists */ }
    var tmp = hook + '.tmp';
    fs.writeFileSync(tmp, want, { mode: 493 });
    fs.chmodSync(tmp, 493);
    fs.renameSync(tmp, hook);
    return 'written';
  } catch (e) { return 'skipped'; }
}

module.exports = { ensure: ensure, isOurs: isOurs, wrapper: wrapper, HOOK: HOOK, MARKER: MARKER };
