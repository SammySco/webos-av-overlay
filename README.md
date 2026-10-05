# AV Overlay for LG webOS

On-screen volume and stream information for a rooted LG webOS TV that sends its audio to a
**Yamaha receiver** (tested on an RX-V485 over eARC). It is a fork of
[Nikolay1243/Webos-EARC-Volume-Overlay](https://github.com/Nikolay1243/Webos-EARC-Volume-Overlay),
which showed a numeric volume; this version reads the receiver directly and adds an info bar.

- **Volume popup** (bottom-right) whenever the receiver's volume or mute changes, including half steps.
- **Info bar** with the sound program, source, audio format, Plex stream details (optional),
  amp processing, video format/HDR and colour. It appears when something changes (switchable), on
  demand, or pinned on screen.
- **Status page** at `http://<tv>:41101/status` with Show/Hide on TV, a live view, and an Auto info switch.
- **Setup page** at `http://<tv>:41101/setup`, also opened by the **AV Overlay Settings** icon on the TV home screen.
- **Sound program per app**: pick the receiver's sound program for Live TV, each HDMI input, webOS apps (Netflix,
  YouTube, ...), Plex players and, with a small Home Assistant automation, each Apple TV app. See
  [docs/HOME-ASSISTANT.md](docs/HOME-ASSISTANT.md).
- Endpoints for automation: `/info`, `/status.json`, `/tv/show`, `/tv/hide`, `/app?name=...`.

## Requirements

- An LG TV that is **rooted** with the [Homebrew Channel](https://www.webosbrew.org/) installed.
  Rooting is not covered here and can void your warranty. Firmware updates can remove root.
- **SSH access to the TV as root**, ideally with a key (`TV_SSH_KEY`).
- A **Yamaha receiver with the Extended Control API** (most MusicCast and recent RX-V models), on the same network
  as the TV. Other brands are not supported.
- On your computer: **Node.js 18+**, `ssh`/`scp`, and a POSIX shell (macOS, Linux, or Git Bash/WSL on Windows).
- Optional: a Plex server and its token, for stream details when playing from Plex.

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide, from rooting the TV to Home Assistant.

## Install

```sh
git clone https://github.com/SammySco/webos-av-overlay.git
cd webos-av-overlay
TV_HOST=root@TV_IP_ADDRESS TV_SSH_KEY=/path/to/key sh scripts/install.sh
```

The installer builds two packages (the overlay and the **AV Overlay Settings** launcher app), installs them,
asks a few questions, and starts the service:

| Question | Notes |
|---|---|
| Yamaha receiver IP/hostname | Checked from the TV; required for the overlay to do anything |
| Plex server URL, token, player IP | Optional. The token prompt is hidden and the token is only sent over SSH |
| Auto info on/off | Show the info bar by itself when something changes |
| Info bar position | top-left, top-right or bottom-left |

Every answer can be supplied as an environment variable instead (see the top of `scripts/install.sh`), and
`EARC_NONINTERACTIVE=1` skips all questions. Settings are stored on the TV in `/home/root/.earc-overlay.json`
(readable by root only) and can be changed any time at `/setup` or from the TV home screen.

The setup and status pages have no password and are meant for your home network only.

## Change settings later

Open **AV Overlay Settings** on the TV home screen, or browse to `http://<tv>:41101/setup`. Changes apply immediately.

## Uninstall

```sh
TV_HOST=root@TV_IP_ADDRESS TV_SSH_KEY=/path/to/key sh scripts/uninstall.sh          # keeps your settings
TV_HOST=root@TV_IP_ADDRESS TV_SSH_KEY=/path/to/key sh scripts/uninstall.sh --purge  # also deletes them
```

## Troubleshooting

On the TV, `tail -f /tmp/earc-volume-overlay.log`. A healthy start looks like:

```text
service starting (yamaha 192.168.1.50, with signal info)
watching 192.168.1.50 at 42:false
```

- *"amp not configured"*: enter the receiver address at `/setup`.
- *"amp unreachable"*: check the address, that the receiver is on, and that "Network Standby" is enabled on it.
- Remote channel up/down while the info bar is on screen: the first key press dismisses the bar and is
  passed on to Live TV, so one press still changes the channel.

## How it works

A root-side Node.js watcher on the TV subscribes to the receiver's events (with a poll as a fallback), reads the
TV's video output state, and optionally Plex. It launches a transparent web app to draw the volume popup and the
info bar, and serves the status and setup pages on port 41101. The app closes itself when nothing is showing,
because an open overlay window takes the remote's key focus.

## Development disclosure

The original project was developed with substantial assistance from OpenAI Codex. This fork's additions were
developed with Claude Code, with testing on a real rooted LG webOS TV and a Yamaha RX-V485 by the maintainer.

## Safety

This is unofficial software for rooted TVs. Firmware updates can change private webOS services or remove root
access. Keep a known recovery path for your TV and review scripts before running them.

## Licence

MIT
