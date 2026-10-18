# AV Overlay: notes for Claude Code

On-screen volume, an audio/video info bar and per-app sound programs for a rooted LG webOS TV paired with a Yamaha
receiver. This file is the shared project context. The maintainer's own environment (addresses, host names, personal
rules) is in `CLAUDE.local.md`, which is git-ignored and never committed.

## Repository
- One repository, `SammySco/webos-av-overlay`. `main` is always releasable; work happens on branches and pull requests.
- Layout: `runtime/` (watcher and helpers), `app/` (overlay TV app), `settings/` (settings TV app), `android/` (status
  app), `scripts/` (install, deploy, package, release, manifest), `docs/`, `.github/workflows/`.
- Docs (keep them in step with the code): `README.md` (overview, scope, quick start), `docs/INSTALL.md`,
  `docs/DOCKER.md`, `docs/TROUBLESHOOTING.md` (the one place for symptoms and fixes), `docs/HOME-ASSISTANT.md`,
  `docs/INFO-ROWS.md`, `docs/COMPATIBILITY.md`, `docs/CHANGELOG.md`, `docs/RELEASE-PROCESS.md`.
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
for the TV acceptance checklist (test the TV's own apps, not only the pages from a computer), release candidates,
tagging and the checks to run after a tag. On Windows, Git's `sh` can fail to find `npx` when Node is under
`C:\Program Files`; see the environment notes there.

## What the watcher does
- Volume: read from the receiver (`getStatus`), event-driven through the Yamaha Extended Control UDP subscription
  (port 41100) with a 2 s poll fallback. Shows half-steps and "Mute".
- Info bar (stacked left-justified lines; appears 1 s after a change, shows 5 s; the app closes itself when nothing is
  showing, so Show is a cold start; no fades): sound program (and decoder), source, receiver audio (format, rate, bit
  depth, bitrate), Plex or Jellyfin stream, receiver processing, video (size, rate, HDR) and colour. "---" readings
  while HDMI re-locks are ignored. Every line starts with its label ("Video: ..."). Each row has an on/off switch and
  a drag handle on the `/status` page (`GET /tv/row?k=<key>&v=0|1`, `GET /tv/order?o=<keys>`, stored as `hiddenRows` and
  `rowOrder`; `/setup` has the same checklist); the order drives the bar as well. Sound program and Volume are rows like
  the others. A volume change only shows the volume popup, but while the bar is up its Volume line is updated in place.
- TV-only mode: with no receiver address (`!AMP_HOST`) the bar and `/status` show only the TV-side rows (Source, App,
  Audio (TV), Plex, Jellyfin, Video, Colour), with no "Receiver not responding" title. A receiver that is set but not
  answering behaves as before. The installers skip the receiver on Enter (`none` removes a saved one; `EARC_AMP_HOST=none`
  or `-AmpHost none` when scripted; `configure.js set` takes `ampClear=yes` and `tvAudio=on|off`), and ask about
  Audio (TV) (`EARC_TV_AUDIO`), suggesting on when there is no receiver. Or clear it at `/setup`. Tested in a vm sandbox
  only, not yet on a TV without a receiver; `install.ps1` is parse-checked, not run.
- Optional "Audio (TV)" row (`tvAudio` setting, off by default): the TV's own view of its input. On HDMI it reads
  `luna://com.webos.service.extinputs.hdmi/getHDMIDiagnosticsInfo` (needs the `pipelineId` from
  `luna://com.webos.service.audio/tv/getAudioInputProperty`; the bus name without `.hdmi` hangs) and shows codec,
  channels and rate, for example "PCM · 8 ch · 48 kHz"; elsewhere (Live TV, LG apps) only the codec.
- The source row shows the TV's custom input name; the app row shows "<App> on Apple TV" or "<App> on LG TV".
- Page title and Android title: "<TV device name> - AV Info" (fetched from settingsservice at startup and every 10
  minutes; fallback "AV Info"). The status and setup pages show `AV Overlay v<version>` at the bottom.
- Video data: `luna://com.webos.service.videooutput/getStatus` with `{"subscribe":true}`, run through
  `script -q -f -c` (luna-send needs a pty). Foreground app, running apps and video come from luna subscriptions
  (3 `script` processes); 15 s and 10 s safety polls remain.
- On-demand: `GET /info` (TV bar plus an HTML page in browsers, JSON otherwise), `/status` (live page), `/status.json`,
  `/status.rows.json`, `SIGUSR1` to the watcher pid; opening the app pins the bar and opening it again hides it.
  `/logs` (live view, filter, download) and `/logs.txt?lines=N` read the log and its rotated `.1` file, redacting
  token and key shapes. Everything is served on port 41101.
- Show on TV is saved as `pinOnTv` in the settings file; at start-up the watcher restores the pinned bar after 8 s
  (retrying every 15 s, up to 8 times, until the app reports its pin state). A pinned bar that vanishes (switching
  between native apps and Live TV) is restored after 300 ms.
- Settings: `/home/root/.earc-overlay.json` on the TV (0600), written atomically (an unreadable file is copied to
  `.earc-overlay.json.bad`) by `scripts/install.sh` and the `/setup` page. `/setup` POSTs reject cross-site Origins and
  non-JSON bodies. The mutating GETs (`/info`, `/app`, `/tv/*`) have no cross-site guard: the on-TV apps call
  `http://127.0.0.1`, which browsers treat as trustworthy, so they send `Sec-Fetch-Site: cross-site` and a guard on that
  header refused the apps' own calls (Quick Access fell back to the setup page). Only `/tv/pinstate`, `/tv/qa`,
  `/tv/key` and `/status.json` send a CORS header. Plex/Jellyfin TLS is unverified unless `"verifyTls": true`. No baked-in receiver address: with none
  set the watcher idles. Plex: `/home/root/.earc-plex.json`; the token is private.
- Log: `/tmp/earc-volume-overlay.log` (dedupes repeats, rotates at 256 KB).
- Code layout (`runtime/`): `watcher.js` (main), `profiles.js` (sound rules), `setup.js` (/setup), `configure.js`
  (installer helper), `shared.js` (constants, helpers, app version), `orphan.js` (self-cleanup after the app is
  removed from the TV), `logs.js` (the `/logs` page). New runtime files must be added to the `cp` line in `scripts/package.sh` (Docker copies all of
  `runtime/`).
- Removal: webOS has no uninstall hook, so the watcher notices its own folder is gone (3 misses, about 90 s), removes
  its boot hook, pid files and state folder and exits; settings are kept (`scripts/uninstall.sh --purge` deletes them).
  Inactive in Docker.

## Sound program per app (`profiles.js`)
- Context key priority: pushed Apple TV app name (`GET /app?name=`), then Plex player product, then the LG foreground
  app (Live TV, HDMI n or webOS app title). A pushed Apple TV app name expires after 12 h without a refresh. It is kept in `/tmp/earc-pushed-app.json`, so it
  survives a watcher restart but not a TV reboot.
- Rules are edited on `/setup`; the first match wins. The receiver is only commanded when enabled, its input equals the
  TV input and the program differs.
- Spotify guard: if the Apple TV is playing Spotify and the receiver is idle on its own Spotify input (about 6 s), the
  receiver is switched to the TV input. It does not fire if the receiver's own Spotify input is playing.

## Known limits (don't retry)
- The receiver never reports an audio channel count, and the TV reports only the HDMI transport's (an Apple TV
  decodes to PCM and sends 5.1 as 8 channels, so 5.1 and 7.1 look alike); only Plex gives the real stream layout.
- The Magic Remote pointer cannot click items on an HDMI input (the Apple TV only gets key presses over CEC). The
  overlay app keeps a 1x1 input region and ignores key codes 1536 and up (pointer activity); an empty region left the
  full-screen overlay swallowing the pointer over native apps.
- The overlay app's own Enable/Disable/Test overlay page (`app/index.html`, shown when you open the app, or when its
  Quick Access call fails) is denied `exec` by Luna ACG: it shows `Denied method call "exec" for category "/"`. Expected;
  the installer enables the watcher and the separate Settings app replaces that page. A "LG Input Hook" is blocked by
  glibc 2.34 or newer; `/dev/input` is exclusively grabbed by lginput2.
- Do not add a `Sec-Fetch-Site` / cross-site guard to the control GETs. The on-TV apps call `http://127.0.0.1`, which
  browsers treat as trustworthy, so they send `cross-site` themselves; a guard refused Quick Access. And do not narrow
  CORS without checking the settings app, which reads `/status.json` cross-origin. See `docs/RELEASE-PROCESS.md`.
- The YouTube tvOS app often does not report now-playing to Home Assistant.
- Spotify Connect to an Apple TV only works while the Spotify tvOS app is running.
- Amp-based sources (net radio, TIDAL direct, AirPlay): the context key is the receiver input, so pushed app names are
  remembered but only applied once the receiver is back on the TV input. It never switches itself from its own source
  to eARC, apart from the Spotify guard.

## Releases, in short
Versions live in `app/appinfo.json` (the source of truth for IPK and archive names), `settings/appinfo.json`,
`package.json`, `package-lock.json` (lines 3 and 9) and the issue-form examples. Bump them when cutting the release,
not earlier, and add the version's entry to `docs/CHANGELOG.md` first. A `v*` tag publishes the release (tarball, both IPKs, webosbrew manifest, Android APK) and the Docker image.
After any tag check the assets and that
`https://github.com/SammySco/webos-av-overlay/releases/latest/download/com.sammysco.avoverlay.manifest.json` returns
200 before announcing anything. Do not cut a release only to test CI.

## Working rules
- Changes outside the repo (the TV, the receiver, Home Assistant, GitHub settings) are allowed without asking first,
  as the maintainer has said, but log them in the maintainer's notes (see `CLAUDE.local.md`).
- Never commit `CLAUDE.local.md` or anything with real addresses, host names or credentials.
