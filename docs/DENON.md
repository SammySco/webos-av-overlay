# Denon / Marantz receivers

The watcher can drive the overlay from a Denon or Marantz AVR instead of a Yamaha. Developed against the
**AVR-X2400H** (its web API answers were recorded from a real unit; the telnet session fixture follows the
documented protocol).

## Pick a driver

| `ampType` | Transport | Latency | Coexists with Home Assistant? |
|---|---|---|---|
| `denon` | ASCII control protocol, TCP **23** ("telnet"). Queries `PW? ZM? MV? MU? SI? MS?` on connect, then the receiver pushes every change. Reconnects with backoff (1 s doubling to 60 s). | Instant | **Only if HA does not use telnet.** |
| `denon-http` | Polls `/goform/formMainZone_MainZoneXmlStatusLite.xml` every 0.5 s (power, input, volume, mute) and `AppCommand.xml` `GetSurroundModeStatus` every 3 s, on port **8080**. | ≤ 0.5 s | Yes |

### The single telnet client caveat
The X2400H accepts **one** connection on port 23. Home Assistant's `denonavr` integration keeps that connection
open when its **"Use telnet"** option is on (the default). With both pointed at the receiver, whichever connects
second is refused or kicks the other off, and they fight on every reconnect. Choose one:

1. Use `denon-http` on the TV (recommended when HA's telnet is on), or
2. In HA: Settings → Devices & services → Denon AVR → Configure → untick **Use telnet**, then use `denon` on the TV.
   HA then falls back to polling, so its Denon state updates a little slower.

The setup page's **Test receiver** button always tests over HTTP (8080), so it never takes the telnet slot.

## Configure
On `http://<tv>:41101/setup` → **Receiver**: choose the type, enter the receiver IP, leave the port at 80 (meaning
"driver default") or set 23 / 8080. Or in `/home/root/.earc-overlay.json`:

```json
{ "ampType": "denon-http", "ampHost": "192.168.1.110", "ampPort": 8080 }
```

Installer: `EARC_AMP_TYPE=denon-http EARC_AMP_HOST=192.168.1.110 EARC_AMP_PORT=8080 TV_HOST=root@<tv> sh scripts/deploy.sh`.

## What is shown
- **Volume**: the receiver's relative scale (0–98, half steps `MV505` = 50.5) or, with *Volume display: dB*,
  `value − 80` dB (80 = 0 dB, 98 = +18 dB). `MVMAX` lines are ignored for the volume. Mute shows as "Mute".
- **Sound program**: the `MS` mode with friendly names (`DOLBY D+ +DS` → "Dolby Digital+ · Dolby Surround",
  `MCH STEREO` → "Multi Ch Stereo", ...). Unknown modes are title-cased.
- **Input**: `SI` codes with friendly names (`TV` → "TV Audio", `BD` → "Blu-ray", `NET` → "HEOS Music").
  The TV's sound is expected on the **TV Audio** input. Network/Bluetooth/Tuner inputs are treated like Yamaha's
  "receiver-local" sources (the bar then shows the receiver input instead of the TV's video details).

## Not supported on Denon (yet)
- Per-app sound program rules (`profiles.js`) and the Spotify guard: Yamaha only. They log "not available" and do nothing.
- The audio signal row (format/rate) and now-playing: Yamaha only. (Telnet `OPINF…`/`SSINF…` queries vary by model
  and were not verified on the X2400H.)
- Front-panel volume-scale sync: Yamaha only.

## Testing without a receiver
```sh
node --test test/                 # unit tests + drivers against a fake receiver
node scripts/fake-denon.js 2323 8088   # interactive fake: type MV455, MUON, SIBD, MSSTEREO ...
EARC_AMP_TYPE=denon EARC_AMP_HOST=127.0.0.1 EARC_AMP_PORT=2323 EARC_LUNA_SEND=/bin/true EARC_SETTINGS=/tmp/s.json node runtime/watcher.js
curl localhost:41101/status.json
```
