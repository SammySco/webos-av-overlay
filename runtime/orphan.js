'use strict';

// Self-cleanup when the app is removed from the TV.
// webOS and the Homebrew Channel have no uninstall hook, so removing the app leaves the boot hook and the running
// watcher behind. While running on the TV, the watcher checks that its own files still exist; once they have been
// missing for several checks in a row (so an in-place upgrade is not mistaken for a removal) it removes the boot
// hook, the pid files and the state directory, then asks the watcher to exit. Settings files are never touched
// (use scripts/uninstall.sh --purge for those). Inactive outside the TV's app folder, so Docker is unaffected.

var fs = require('fs');
var path = require('path');

var DEFAULTS = {
  hook: '/var/lib/webosbrew/init.d/91-earc-volume-overlay',
  pidFiles: ['/tmp/earc-volume-overlay.pid', '/var/lib/earc-volume-overlay/watcher.pid'],
  stateDir: '/var/lib/earc-volume-overlay',
  checkMs: 30 * 1000,
  misses: 3
};

// The app folder, but only when the watcher runs from a webOS app folder; '' otherwise (Docker, development).
function appDirFor(runtimeDir, appId) {
  var dir = path.dirname(runtimeDir);
  var tail = '/usr/palm/applications/' + appId;
  return dir.replace(/\\/g, '/').slice(-tail.length) === tail ? dir : '';
}

// Removes the boot hook (only if it is a symlink into this app), the pid files and the state directory.
function cleanup(appDir, opts, log) {
  var removed = [];
  try {
    if (fs.lstatSync(opts.hook).isSymbolicLink() && fs.readlinkSync(opts.hook).indexOf(appDir + path.sep) === 0) {
      fs.unlinkSync(opts.hook);
      removed.push('boot hook');
    }
  } catch (e) { /* no hook, or not ours */ }
  opts.pidFiles.forEach(function (f) {
    try { fs.unlinkSync(f); removed.push(f); } catch (e) { /* already gone */ }
  });
  try {
    if (fs.existsSync(opts.stateDir)) {
      fs.readdirSync(opts.stateDir).forEach(function (n) { try { fs.unlinkSync(path.join(opts.stateDir, n)); } catch (e) {} });
      fs.rmdirSync(opts.stateDir);
      removed.push(opts.stateDir);
    }
  } catch (e) { /* leave it */ }
  log('app removed from the TV: cleaned up ' + (removed.length ? removed.join(', ') : 'nothing') + '; settings files kept');
}

// Starts the check. Returns a stop function, or null when inactive. onOrphaned runs after cleanup (the watcher exits).
function start(config) {
  var appDir = appDirFor(config.runtimeDir, config.appId);
  if (!appDir) return null;
  var opts = {};
  Object.keys(DEFAULTS).forEach(function (k) { opts[k] = config[k] !== undefined ? config[k] : DEFAULTS[k]; });
  var marker = path.join(config.runtimeDir, 'watcher.js');
  var missing = 0;
  var timer = setInterval(function () {
    try {
      fs.statSync(marker);
      missing = 0;
    } catch (e) {
      if (e && e.code === 'ENOENT') missing++;   // other errors (I/O trouble) never count as removal
      else return;
    }
    if (missing < opts.misses) return;
    clearInterval(timer);
    cleanup(appDir, opts, config.log);
    if (config.onOrphaned) config.onOrphaned();
  }, opts.checkMs);
  if (timer.unref) timer.unref();
  return function () { clearInterval(timer); };
}

module.exports = { start: start, appDirFor: appDirFor, cleanup: cleanup };
