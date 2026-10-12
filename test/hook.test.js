const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const hook = require('../runtime/hook.js');
const orphan = require('../runtime/orphan.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
  const appDir = path.join(root, 'usr/palm/applications/com.sammysco.avoverlay');
  fs.mkdirSync(path.join(appDir, 'runtime'), { recursive: true });
  const script = path.join(appDir, 'runtime/91-earc-volume-overlay');
  // stand-in for the real script: proves it ran via sh and that $0 still resolves to the app folder
  fs.writeFileSync(script, '#!/bin/sh\necho "ran $(dirname "$(dirname "$(readlink -f "$0")")")"\n', { mode: 0o644 });
  return { root, appDir, script, hook: path.join(root, 'init.d/91-earc-volume-overlay') };
}

test('old symlink to a non-executable script is replaced by a working sh wrapper', () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.hook));
  fs.symlinkSync(f.script, f.hook);
  assert.throws(() => execFileSync(f.hook)); // Permission denied, as on the TV
  fs.chmodSync(f.script, 0o644);
  assert.strictEqual(hook.ensure(f.appDir, { hook: f.hook }), 'written');
  assert.ok(!fs.lstatSync(f.hook).isSymbolicLink());
  fs.chmodSync(f.script, 0o644); // Homebrew strips the bit again on the next update
  assert.strictEqual(execFileSync(f.hook).toString().trim(), 'ran ' + f.appDir);
  assert.strictEqual(hook.ensure(f.appDir, { hook: f.hook }), 'ok');
  fs.rmSync(f.root, { recursive: true, force: true });
});
test('missing hook is created; foreign hook is left alone', () => {
  const f = fixture();
  assert.strictEqual(hook.ensure(f.appDir, { hook: f.hook }), 'written');
  fs.writeFileSync(f.hook, '#!/bin/sh\necho someone else\n');
  assert.strictEqual(hook.ensure(f.appDir, { hook: f.hook }), 'skipped');
  assert.match(fs.readFileSync(f.hook, 'utf8'), /someone else/);
  fs.rmSync(f.root, { recursive: true, force: true });
});
test('orphan cleanup removes the wrapper hook', () => {
  const f = fixture();
  hook.ensure(f.appDir, { hook: f.hook });
  orphan.cleanup(f.appDir, { hook: f.hook, pidFiles: [], stateDir: path.join(f.root, 'nostate') }, () => {});
  assert.ok(!fs.existsSync(f.hook));
  fs.rmSync(f.root, { recursive: true, force: true });
});
test('package.sh sets the exec bit before packaging', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/package.sh'), 'utf8'), /chmod 755 "\$STAGE\/runtime\/91-earc-volume-overlay"/);
});
