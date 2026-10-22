# Changelog

Newest first. Versions are tagged `vX.Y.Z`; the app version in `app/appinfo.json` is the source of truth. Release
steps are in [RELEASE-PROCESS.md](RELEASE-PROCESS.md).

## Unreleased

### Fixed
- Audio (TV) row: the raw TV replies are now logged once per failing step, not once in total. On a C1 (webOS 6) the
  missing audio call used up the only log line, so the HDMI fallback's reply was never shown. The HDMI audio line is
  also read case-insensitively ("9ch" as well as "9Ch"), and MAT (how an Apple TV sends Atmos) shows as "Dolby MAT".
  Not yet confirmed on a C1.

## 2.5.2

### Fixed
- A muted receiver stays muted when you switch between Live TV and an HDMI input. The TV re-syncs its own (unmuted)
  state to the receiver over eARC at each switch, which un-muted it; the watcher now mutes it again if that happens
  within 4 s of an input change. Confirmed on a TV.

## 2.5.1

### Fixed
- The pinned bar no longer flickers on an HDMI input: its restore is held while a TV menu (quick menu, settings,
  input picker) or the home screen is up, and backs off if the bar keeps vanishing.
- Audio (TV) row: when the TV's audio call gives no `pipelineId` (older webOS), the HDMI service is asked by port
  alone. The raw replies are logged once if nothing usable comes back. Not yet confirmed on other models.
- The `/setup` page (opened by the AV Overlay Settings app) can now be driven with the TV remote: section headers
  are focusable and OK opens them, the arrow keys move between controls (skipping those inside closed
  sections), and OK toggles checkboxes. Not yet
  confirmed on a TV; Magic Remote pointer clicks are still being investigated.

## 2.5.0

The first release from the single consolidated repository (Android app, release candidates and the shared project
notes now live here), with new info bar rows and controls, and a log page.

### Added
- **Audio (TV) row** (optional, off by default): the audio the TV itself sees on its input, with or without a
  receiver. Codec, channel count and sample rate on an HDMI input; the codec on Live TV and LG apps.
- **Choose and order the info bar rows**: each row has an on/off switch and a drag handle on `/status`, and the same
  list is at `/setup`. Stored as `hiddenRows` and `rowOrder`.
- **TV-only mode**: leave the receiver address empty and the bar shows only what the TV, Plex and Jellyfin know. The
  installers skip the receiver on Enter, and `none` removes a saved one.
- **`/logs` page**: live view, text filter and download (`/logs.txt?lines=N`), with tokens and keys masked.
- **Show on TV is remembered** across a watcher or TV restart (the bar returns about 8 seconds after start), and the
  last Apple TV app sent by Home Assistant is kept across a watcher restart.
- Row descriptions: an **i** icon beside each row explains it ([INFO-ROWS.md](INFO-ROWS.md)).
- Magic Remote friendly: the pointer keeps working over native apps with the bar showing, and pointer movement does
  not dismiss the bar. A pinned bar is restored after switching between Live TV and apps.
- Documentation: a single [TROUBLESHOOTING.md](TROUBLESHOOTING.md), this changelog, and a scope section in the README.

### Changed
- `/status.json` sends a CORS header so the **AV Overlay Settings** app can probe the watcher from the TV.
  CORS headers are otherwise limited to `/tv/pinstate`, `/tv/qa` and `/tv/key`.
- Review fixes: shell quoting, how luna subscriptions restart, and detection of a failed IPK install.
- Docs corrected for the single-repository layout.

### Removed
- A cross-site guard on the control addresses (`/info`, `/app`, `/tv/*`) was written for this release and then
  removed before it shipped. The TV's own apps call `http://127.0.0.1`, which browsers treat as trustworthy, so they
  send `Sec-Fetch-Site: cross-site` and the guard refused the apps' own calls (Quick Access fell back to the setup
  page). The control addresses are plain GETs with no password, like the pages. Saving settings at `/setup` still
  requires a matching Origin and a JSON body.

### Known limits
- The main **eARC Volume Overlay** app's page (Enable, Disable, Test overlay) shows `Denied method call "exec"`: webOS
  does not let that app call the Homebrew Channel's root service. The watcher does not need it.
- Not tested on a TV with no receiver at all, or on receivers other than the Yamaha RX-V485.
- Windows: building from source in Git Bash can fail when Node is installed under a path with a space; use the
  release archive and `Install-AVOverlay.cmd`.

## 2.4.x

- 2.4.3: Docker build fix (`app/appinfo.json` kept in the build context) and a build-only Docker check on pull requests.
- 2.4.2: the watcher cleans up after itself when the app is removed from the TV; the version shows on `/status` and
  `/setup`.
- 2.4.1: the webosbrew manifest is attached to every release.
- 2.4.0: review fixes, luna subscriptions instead of polling, safer settings file handling.

## 2.1 to 2.3

- 2.3.0: Android companion app and docs.
- 2.2.0: TV name in the title, toggle UI, source and app labels, Spotify guard, `deploy.sh`.
- 2.1.x: sound program rules for the receiver's own sources, "Receiver not responding" instead of stale values, the
  Quick Access toggle fix, Windows installer, receiver sources, volume number setting.
- 2.1.0: first version of this fork: volume, stream info and per-app sound programs for LG webOS with a Yamaha receiver.
