'use strict';
// Local test for runtime/orphan.js (no TV needed): node scripts/test-orphan.js
var fs = require('fs');
var os = require('os');
var path = require('path');
var orphan = require('../runtime/orphan.js');

var failures = 0;
function check(name, ok) { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failures++; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

function fixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
  var appDir = path.join(root, 'media', 'developer', 'apps', 'usr', 'palm', 'applications', 'com.sammysco.avoverlay');
  fs.mkdirSync(path.join(appDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'runtime', 'watcher.js'), '// watcher');
  fs.writeFileSync(path.join(appDir, 'runtime', '91-earc-volume-overlay'), '#!/bin/sh');
  var initd = path.join(root, 'init.d'); fs.mkdirSync(initd);
  var state = path.join(root, 'state'); fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'watcher.pid'), '123');
  var pid = path.join(root, 'earc.pid'); fs.writeFileSync(pid, '123');
  var settings = path.join(root, 'earc-overlay.json'); fs.writeFileSync(settings, '{"ampHost":"x"}');
  var hook = path.join(initd, '91-earc-volume-overlay');
  fs.symlinkSync(path.join(appDir, 'runtime', '91-earc-volume-overlay'), hook);
  return { root: root, appDir: appDir, hook: hook, state: state, pid: pid, settings: settings,
    cfg: function (extra) {
      var c = { runtimeDir: path.join(appDir, 'runtime'), appId: 'com.sammysco.avoverlay', hook: hook,
        pidFiles: [pid, path.join(state, 'watcher.pid')], stateDir: state, checkMs: 20, misses: 3,
        log: function (m) { c.logged.push(m); }, logged: [], onOrphaned: function () { c.orphaned = true; } };
      Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
      return c;
    } };
}

(async function () {
  // appDirFor
  check('appDirFor accepts a webOS app folder',
    orphan.appDirFor('/media/developer/apps/usr/palm/applications/com.sammysco.avoverlay/runtime', 'com.sammysco.avoverlay') ===
    '/media/developer/apps/usr/palm/applications/com.sammysco.avoverlay');
  check('appDirFor is empty in Docker', orphan.appDirFor('/app/runtime', 'com.sammysco.avoverlay') === '');
  check('appDirFor is empty for another app id',
    orphan.appDirFor('/media/developer/apps/usr/palm/applications/other/runtime', 'com.sammysco.avoverlay') === '');

  // 1. removal cleans up, keeps settings
  var f = fixture(), c = f.cfg();
  var stop = orphan.start(c);
  check('start returns a stop function on the TV layout', typeof stop === 'function');
  await wait(100);
  check('running app is left alone', !c.orphaned && fs.existsSync(f.hook));
  rmrf(f.appDir);
  await wait(250);
  check('removal: onOrphaned called', c.orphaned === true);
  check('removal: boot hook removed', !fs.existsSync(f.hook) && !(function () { try { fs.lstatSync(f.hook); return true; } catch (e) { return false; } })());
  check('removal: pid file and state dir removed', !fs.existsSync(f.pid) && !fs.existsSync(f.state));
  check('removal: settings kept', fs.existsSync(f.settings));
  check('removal: logged once with "settings files kept"', c.logged.length === 1 && /settings files kept/.test(c.logged[0]));
  rmrf(f.root);

  // 2. upgrade (folder missing briefly) is not a removal
  f = fixture(); c = f.cfg({ misses: 5 });
  orphan.start(c);
  var saved = fs.readFileSync(path.join(f.appDir, 'runtime', 'watcher.js'));
  fs.rmSync(path.join(f.appDir, 'runtime', 'watcher.js'));
  await wait(50);                                   // about two checks
  fs.writeFileSync(path.join(f.appDir, 'runtime', 'watcher.js'), saved);
  await wait(300);
  check('upgrade: brief absence does not clean up', !c.orphaned && fs.existsSync(f.hook) && fs.existsSync(f.state));
  rmrf(f.root);

  // 3. a hook that points elsewhere is not ours
  f = fixture(); c = f.cfg();
  fs.unlinkSync(f.hook); fs.writeFileSync(path.join(f.root, 'other'), 'x'); fs.symlinkSync(path.join(f.root, 'other'), f.hook);
  orphan.start(c);
  rmrf(f.appDir);
  await wait(250);
  check('foreign hook: orphaned, but the other symlink is untouched', c.orphaned === true && fs.existsSync(f.hook));
  rmrf(f.root);

  // 4. Docker / development layout does nothing
  f = fixture(); c = f.cfg({ runtimeDir: '/app/runtime' });
  check('docker layout: start returns null', orphan.start(c) === null);
  rmrf(f.root);

  console.log(failures ? failures + ' FAILED' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
