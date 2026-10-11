# AV Overlay: notes for Claude Code

On-screen volume, an audio/video info bar and per-app sound programs for a rooted LG webOS TV paired with a Yamaha
receiver. This file is the shared project context. The maintainer's own environment (addresses, host names, personal
rules) is in `CLAUDE.local.md`, which is git-ignored and never committed.

## Repository
- One repository, `SammySco/webos-av-overlay`. `main` is always releasable; work happens on branches and pull requests.
- Layout: `runtime/` (watcher and helpers), `app/` (overlay TV app), `settings/` (settings TV app), `android/` (status
  app), `scripts/` (install, deploy, package, release, manifest), `docs/`, `.github/workflows/`.
- Fork of Nikolay1243/Webos-EARC-Volume-Overlay (never push there). App ID `com.sammysco.avoverlay`, settings app
  `com.sammysco.avoverlay.settings`, Android package `com.sammysco.avoverlay.status`.
- Prose in Australian English. Never put tokens, SSH keys or Plex/Jellyfin credentials in code, issues, logs or commits.

## Test on a TV before releasing
```sh
TV_HOST=root@<tv-ip> sh scripts/deploy.sh      # builds, installs and restarts the watcher
node scripts/test-orphan.js                    # local test of the self-cleanup, no TV needed
```
`scripts/deploy.sh` clears the build cache so stale IPKs are never reused. `TV_SSH_KEY=/path/to/key` is optional.
Test a change on a branch (deploy it, use it for a few days), then open a pull request. See `docs/RELEASE-PROCESS.md`
for release candidates, tagging and the checks to run after a tag.

## What the watcher does
- Volume: read from the receiver (`getStatus`), event-driven through the Yamaha Extended Control UDP subscription
  (port 41100) with a 2 s poll fallback. Shows half-steps and "Mute".
- Info bar (stacked left-justified lines; appears 1 s after a change, shows 5 s; the app closes itself when nothing is
  showing, so Show is a cold start; no fades): sound program (and decoder), source, receiver audio (format, rate, bit
  depth, bitrate), Plex or Jellyfin stream, receiver processing, video (size, rate, HDR) and colour. "---" readings
  while HDMI re-locks are ignored.
- The source row shows the TV's custom input name; the app row shows "<App> on Apple TV" or "<App> on LG TV".
- Page title and Android title: "<TV device name> - AV Info" (fetched from settingsservice at startup and every 10
  minutes; fallback "AV Info"). The status and setup pages show `AV Overlay v<version>` at the bottom.
- Video data: `luna://com.webos.service.videooutput/getStatus` with `{"subscribe":true}`, run through
  `script -q -f -c` (luna-send needs a pty). Foreground app, running apps and video come from luna subscriptions
  (3 `script` processes); 15 s and 10 s safety polls remain.
- On-demand: `GET /info` (TV bar plus an HTML page in browsers, JSON otherwise), `/status` (live page), `/status.json`,
  `/status.rows.json`, `SIGUSR1` to the watcher pid; opening the app pins the bar and opening it again hides it.
  Everything is served on port 41101.
- Settings: `/home/root/.earc-overlay.json` on the TV (0600), written atomically (an unreadable file is copied to
  `.earc-overlay.json.bad`) by `scripts/install.sh` and the `/setup` page. `/setup` POSTs reject cross-site Origins and
  non-JSON bodies. Plex/Jellyfin TLS is unverified unless `"verifyTls": true`. No baked-in receiver address: with none
  set the watcher idles. Plex: `/home/root/.earc-plex.json`; the token is private.
- Log: `/tmp/earc-volume-overlay.log` (dedupes repeats, rotates at 256 KB).
- Code layout (`runtime/`): `watcher.js` (main), `profiles.js` (sound rules), `setup.js` (/setup), `configure.js`
  (installer helper), `shared.js` (constants, helpers, app version), `orphan.js` (self-cleanup after the app is
  removed from the TV). New runtime files must be added to the `cp` line in `scripts/package.sh` (Docker copies all of
  `runtime/`).
- Removal: webOS has no uninstall hook, so the watcher notices its own folder is gone (3 misses, about 90 s), removes
  its boot hook, pid files and state folder and exits; settings are kept (`scripts/uninstall.sh --purge` deletes them).
  Inactive in Docker.

## Sound program per app (`profiles.js`)
- Context key priority: pushed Apple TV app name (`GET /app?name=`), then Plex player product, then the LG foreground
  app (Live TV, HDMI n or webOS app title). A pushed Apple TV app name expires after 12 h without a refresh.
- Rules are edited on `/setup`; the first match wins. The receiver is only commanded when enabled, its input equals the
  TV input and the program differs.
- Spotify guard: if the Apple TV is playing Spotify and the receiver is idle on its own Spotify input (about 6 s), the
  receiver is switched to the TV input. It does not fire if the receiver's own Spotify input is playing.

## Known limits (don't retry)
- The receiver and the TV never report an audio channel count (an Apple TV decodes to PCM); only Plex can.
- The original settings app is denied `exec` by Luna ACG; a "LG Input Hook" is blocked by glibc 2.34 or newer;
  `/dev/input` is exclusively grabbed by lginput2.
- The YouTube tvOS app often does not report now-playing to Home Assistant.
- Spotify Connect to an Apple TV only works while the Spotify tvOS app is running.
- Amp-based sources (net radio, TIDAL direct, AirPlay): the context key is the receiver input, so pushed app names are
  remembered but only applied once the receiver is back on the TV input. It never switches itself from its own source
  to eARC, apart from the Spotify guard.

## Releases, in short
Versions live in `app/appinfo.json` (the source of truth for IPK and archive names), `settings/appinfo.json`,
`package.json`, `package-lock.json` (lines 3 and 9) and the issue-form examples. Bump them when cutting the release,
not earlier. A `v*` tag publishes the release (tarball, both IPKs, webosbrew manifest, Android APK) and the Docker image.
After any tag check the assets and that
`https://github.com/SammySco/webos-av-overlay/releases/latest/download/com.sammysco.avoverlay.manifest.json` returns
200 before announcing anything. Do not cut a release only to test CI.

## Working rules
- Changes outside the repo (the TV, the receiver, Home Assistant, GitHub settings) are allowed without asking first,
  as the maintainer has said, but log them in the maintainer's notes (see `CLAUDE.local.md`).
- Never commit `CLAUDE.local.md` or anything with real addresses, host names or credentials.
