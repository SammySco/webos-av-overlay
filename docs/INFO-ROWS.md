# What each row means

The info bar on the TV and the `/status` and `/info` pages show the same rows. On the status page every row has a
small **i** icon: hover over it for a short description, or click it to open the description under the row (click
again to close it). The text below is the same text the page uses (`ROW_HELP` in `runtime/shared.js`).

A row only appears when it has something to show, and each one can be switched on or off for the TV bar with the
switch beside its name.

| Row | What it shows |
|---|---|
| **Sound program** | The Yamaha sound program in use (for example Straight or Surround Decoder) and, for a surround decoder, which one. With sound switching on in Setup, the overlay sets this from your rules for the app that is playing. |
| **Volume** | The receiver volume, read from the Yamaha (half steps shown), or Muted. It is not the TV volume. |
| **Source** | The TV input in use: HDMI n or Live TV, with the custom name you gave the input on the TV. |
| **App** | The app that is playing: the Apple TV app sent by Home Assistant, the Plex player, or the app open on the LG TV. It decides which sound program rule applies. |
| **Audio (amp)** | The audio the receiver says it is getting: format, sample rate, bit depth and bitrate where it reports them. The receiver does not report the channel count. |
| **Audio (TV)** | The audio the TV itself sees on its input: codec, channels and sample rate. Off by default; switch it on in Setup. It works without a receiver. |
| **Plex** | Plex's own report for the stream: audio codec, channels and bitrate, video and bitrate, and whether it is Direct Play or Transcode. Needs Plex set up in Setup. |
| **Jellyfin** | Jellyfin's own report for the stream, like the Plex row: codecs, channels, bitrates and whether it is Direct Play or Transcode. Needs Jellyfin set up in Setup. |
| **Processing** | Receiver processing that is switched on: Enhancer, Adaptive DRC, Extra Bass, Dialogue level and subwoofer trim, and Bass/Treble when set by hand. |
| **Video** | The picture the TV is receiving: resolution, progressive or interlaced, frame rate and HDR format (Dolby Vision, HDR10, SDR). |
| **Colour** | The colour format and range of the signal and its colour space, for example RGB Full and DCI-P3 D65. |

## Rows that only appear in some situations

| Row | When and what |
|---|---|
| **Receiver** | Shown when the Yamaha is not answering. The receiver rows are hidden until it responds again. |
| **Last contact** | When the receiver last answered, or why it did not. |
| **Receiver input** | The input the Yamaha itself is on. Shown instead of the TV rows when the receiver is playing its own source, such as TIDAL or AirPlay. |
| **Now playing** | The track or station the receiver is playing from its own source. |

These four have no on/off switch, because they only show when something is wrong or the receiver is on its own source.

## Notes

- Rows can be reordered by dragging the handle at the right of a row. An open description closes while you drag.
- Descriptions are only on the web page; the TV bar shows just the values.
