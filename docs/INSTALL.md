# Installing AV Overlay, from a stock TV to Home Assistant

This guide takes you from "stock LG TV" to a working overlay with per-app Yamaha sound programs. Read the
requirements first, because the biggest one (a rooted TV) decides whether this project is for you.

> **Honesty note.** The overlay, its installer and its settings page were developed and tested on one rooted LG
> OLED and one Yamaha RX-V485. The rooting steps below are a summary of third-party projects and were *not*
> performed as part of this project; always follow the current instructions of those projects.

## 1. Requirements

### Hardware and network
| What | Notes |
|---|---|
| **LG TV running webOS that can be rooted** | Rooting depends on the exact model year and firmware. Check the compatibility lists linked in section 3 *before* doing anything else. |
| **Yamaha receiver with the Extended Control API** | Most MusicCast and recent RX-V models (tested: RX-V485 over eARC). Other brands are not supported. |
| TV and receiver on the **same network** | Wired is best. Give both a fixed address (DHCP reservation in the router). |
| A computer (Windows, macOS or Linux) | Used once to install, and to rebuild. |
| *Optional:* Apple TV, Plex server, Jellyfin server, Home Assistant | Only needed for the features that use them (sections 7 to 10). |

### Software on the computer
- **Node.js 18 or newer** (`node -v`), with `npm`.
- **Git**.
- **`ssh` and `scp`** (included with macOS, Linux and Windows 10/11 OpenSSH).
- **A POSIX shell**: macOS or Linux Terminal, or on Windows **Git Bash** (installed with Git for Windows) or WSL.
  The installer is a shell script and its questions need a real terminal. PowerShell alone will not run it.

### What the overlay does not need
No cloud account, no LG developer account, and nothing installed on the receiver or the Apple TV.

## 2. Before you start: risks

- Rooting a TV can void the warranty, and a mistake can leave the TV needing a factory reset or service.
- **Do not let the TV update its firmware** after rooting; updates can remove root or break the tools. In the TV's
  settings turn off automatic software updates, and stay offline from LG's update servers if you can (the webOS
  Brew project describes how).
- Anything you do to the TV is at your own risk. Keep a note of your TV's model and webOS version.

## 3. Root the TV and install the Homebrew Channel

This is the hard part and it is done by the **webOS Brew** community, not this project. Their site explains the
current method for each firmware: <https://www.webosbrew.org/> (start with the "Rooting" and "Homebrew Channel"
pages) and <https://rootmy.tv/> for the exploit used on supported models.

In outline:
1. **Find your webOS version and firmware**: *Settings → All Settings → Support (or General) → About This TV*.
2. **Check the compatibility list** on webosbrew.org for your model and firmware. If your firmware is newer than the
   supported range, **do not update or downgrade anything**; ask in their community first.
3. **Follow the root guide** for your firmware. It usually involves enabling developer mode on the TV with LG's
   *Developer Mode* app and then running the community's rooting tool from a computer or phone on the same network.
4. **Install the Homebrew Channel** (the guide installs it for you). Open it on the TV: if it says *root: ok* you are
   rooted.
5. **Turn on SSH** in the Homebrew Channel settings (this is how the installer reaches the TV).
6. Reboot the TV once and confirm the Homebrew Channel still shows *root: ok* (it should survive reboots).

## 4. Log in to the TV with SSH (use a key, not a password)

1. On the computer, make a key if you have none: `ssh-keygen -t ed25519`
2. Put the public key (`~/.ssh/id_ed25519.pub`) on the TV. The Homebrew Channel has a setting for the SSH public
   key, or append it to `/home/root/.ssh/authorized_keys` after logging in once with the password shown in the
   Homebrew Channel.
3. Test it: `ssh root@TV_IP "echo ok"` should print `ok` without asking for a password. If your key file is not
   the default, add `-i /path/to/key`.
4. In the Homebrew Channel settings **turn off Telnet** (it is an open root shell on your network) and reboot.
5. Give the TV a **fixed IP address** (DHCP reservation in your router).

## 5. Prepare the Yamaha receiver

1. Connect the receiver to the network and give it a **fixed IP address**.
2. Turn **Network Standby** on (so the receiver answers while it is "off").
3. Know which receiver input the TV uses. For eARC/ARC it is normally `audio1` (labelled TV or ARC).
4. Check the API answers (from the computer): `curl http://RECEIVER_IP/YamahaExtendedControl/v1/system/getDeviceInfo`
   should return JSON with `"response_code":0` and your model name.

## 6. Install the overlay

```bash
git clone https://github.com/SammySco/webos-av-overlay
cd webos-av-overlay
TV_HOST=root@TV_IP sh scripts/install.sh
```
(`TV_SSH_KEY=/path/to/key` is optional if your default SSH key works.) On Windows run it in **Git Bash**, or, with the release archive,
just double-click **`Install-AVOverlay.cmd`**: it uses Windows PowerShell and the built-in OpenSSH Client, needs no
Git or Node, and asks the same questions. From a terminal:
`powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -TvHost root@TV_IP` (add `-SshKey C:\path\to\key` if your key is not the default).

The installer builds two packages, installs them (the overlay and the **AV Overlay** settings icon), and asks:
- **Receiver IP address**: it checks from the TV that a Yamaha receiver answers there.
- **Plex** (optional): server URL, token (typing is hidden) and the player's IP. Press `n` to skip.
- **Auto info**: whether the info bar appears by itself when something changes.
- **Info bar position**: top-left, top-right or bottom-left.

Then it starts the service. Check it:
- Open `http://TV_IP:41101/status`. It should show the sound program, volume, audio and video.
- Change the receiver volume. A number should appear bottom-right on the TV.
- Press **Show on TV** on the status page. The info bar should appear.
- Open `http://TV_IP:41101/setup` (or the **AV Overlay** icon on the TV's home screen) to change anything later.

Optional on the TV: *long-press an unused number key → assign it to the AV Overlay app* (LG's Quick Access). Opening
the app that way pins the bar; opening it again hides it.

Updates later: `git pull`, then redeploy with `TV_HOST=root@TV_IP sh scripts/deploy.sh` (your settings are kept).
Removal: `sh scripts/uninstall.sh` (add `--purge` to delete your settings too).

## 7. Plex (optional)

Shows codec, channels, bitrate and Direct Play/Transcode for what Plex (or Infuse through Plex) is playing.
1. **Server URL**: `http://PLEX_SERVER_IP:32400`.
2. **Token**: in Plex Web open any item, *Get Info → View XML*; the address contains `X-Plex-Token=...`.
   Treat it like a password and rotate it if it leaks (Plex account settings).
3. Enter the URL and token at `/setup` (or in the installer) and press **Test Plex**.
4. If several Plex clients play at once, set the **Player IP** to the one you care about (for example the Apple TV).

## 8. Jellyfin (optional)

Shows codec, channels, bitrate and Direct Play/Transcode for what Jellyfin is playing.
1. **Server URL**: `http://JELLYFIN_SERVER_IP:8096`.
2. **API key**: in Jellyfin open *Dashboard → API Keys → + (Add API Key)* and give it a name such as
   `AV Overlay`. The key is shown once — copy and treat it like a password.
3. Enter the URL and API key at `/setup` (the **AV Overlay Settings** icon) under "Jellyfin (optional)"
   and press **Test Jellyfin**. The API key is never logged or sent back to the browser.
4. If several Jellyfin clients play at once, set the **Device / client name** to the one you care about
   (for example `Infuse` or `Apple TV`).

## 9. Sound programs per app (Yamaha)

At `/setup`, **Sound program per app (Yamaha)**:
1. Set **Receiver input the TV is on** (usually `audio1`) and, if you use an Apple TV, **Input the Apple TV is on**
   (for example HDMI 1).
2. Choose a **Default** (used when no rule matches).
3. **Add rule** for each app or input. The drop-down offers Live TV, HDMI inputs, **LG apps** installed on the TV,
   **Apple TV apps**, and names seen recently; pick a sound program (and a decoder for Surround Decoder). A rule picked
   as "(LG app)" only applies to the LG app and one picked as "(Apple TV)" only to the Apple TV, so the same app
   name can differ between them. The tick boxes above the list hide groups you do not use.
4. Tick **Switch the sound program automatically** and press **Save**. The "Right now" line shows what is detected.

The receiver is only changed when it is on the TV input and its program actually differs.

## 10. Home Assistant (needed only to detect Apple TV apps)

The TV and receiver cannot tell which app is open on an Apple TV, so Home Assistant reports it. Skip this section if
you do not use an Apple TV, or do not need per-app programs for it. LG apps, Live TV, HDMI inputs and Plex players
are detected on the TV itself.

1. **Add the Apple TV to Home Assistant**: *Settings → Devices & services → Add integration → Apple TV*, and pair it
   (a code is shown on the TV screen). You get a `media_player` entity whose `app_name` attribute names the app.
   Check it under *Developer Tools → States*.
2. **configuration.yaml**: add one `rest_command:` block (a second block with the same key replaces the first):
   ```yaml
   rest_command:
     av_overlay_app:
       url: "http://TV_IP:41101/app?name={{ name | urlencode }}"
       method: get
   ```
   Optionally also a status page button (`earc_show_info`) and sensors; the full recommended file is in
   [HOME-ASSISTANT.md](HOME-ASSISTANT.md). Check the configuration and restart Home Assistant.
3. **Automation**: *Settings → Automations → Create → three dots → Edit in YAML*, clear the box and paste the
   automation from [HOME-ASSISTANT.md](HOME-ASSISTANT.md), changing the entity name to your Apple TV. (In the editor
   paste a single automation with no leading dash and no `id`.)
4. **Test**: start an app on the Apple TV. Within a couple of seconds the TV's info bar and
   `http://TV_IP:41101/status` show "App: ... (Apple TV)" and, if a rule matches, the receiver changes program.
   If nothing arrives, run `rest_command.av_overlay_app` from *Developer Tools → Actions* with a test `name`, and
   look at `tail -f /tmp/earc-volume-overlay.log` on the TV for "app pushed".

## 11. Android companion app (optional)

An Android app wraps the `/status` page in a full-screen WebView so you can check and control the overlay from
your phone. The app title follows the TV's device name (e.g. *Living Room TV - AV Info*).

1. Download **AV-Overlay-status.apk** from the [latest release](https://github.com/SammySco/webos-av-overlay/releases/latest).
2. On the phone, allow installs from unknown sources (*Settings → Apps → Special app access → Install unknown apps*,
   then allow your browser or file manager).
3. Open the APK to install it.
4. Open the app and enter the TV's IP address when prompted (for example `192.168.1.50`).

The app requires Android 7.0 or later. Your phone must be on the same Wi-Fi network as the TV.
The address can be changed any time from the app's menu → **Change TV address**.

## 12. Hardening and housekeeping

- Telnet off (section 4), TV and receiver on fixed addresses, Home Assistant and the TV on the same network.
- The status and setup pages have **no password**: keep them on your home network and do not expose port 41101 to
  the internet.
- Use an SSH key and, if you set one, change the TV's root password.
- After any TV firmware or Homebrew Channel change, re-open the status page; if the overlay is not running, run the
  installer again.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| Installer cannot connect | `ssh root@TV_IP` works by hand? SSH enabled in the Homebrew Channel? Correct key? |
| "No Yamaha receiver answered" | Receiver address, Network Standby on, same network, API test from section 5. |
| No volume number | `/status` shows the volume? Log: `ssh root@TV_IP tail -f /tmp/earc-volume-overlay.log`. "amp not configured" means no receiver address (set it at `/setup`). |
| Info bar never appears | Auto info is off at `/setup`, or use **Show on TV** on the status page. |
| Remote keys act oddly while the bar is up | Report it with the log; the overlay is built to leave the remote alone. |
| App not detected on Apple TV | Home Assistant automation not firing: check its trace, the `rest_command` name, and the "app pushed" log line. |
| Receiver changes at odd times | Check the "Right now" line and the rules at `/setup`, and turn the feature off to compare. |
| Nothing works after a TV update | Root may have been removed; check the Homebrew Channel, see webosbrew.org. |

## 14. What was and was not tested for this guide

Tested by the maintainer on one OLED and one RX-V485: sections 4 to 10, including a clean reinstall. Not tested by
this project: the rooting itself (section 3), Home Assistant versions other than a recent one, receivers other
than the RX-V485, and Windows beyond Git Bash.
