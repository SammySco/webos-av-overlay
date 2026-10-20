# Troubleshooting

Start with the log. It is the fastest way to see what the watcher is doing:

- In a browser: `http://<tv>:41101/logs` (or `http://<docker-host>:41101/logs`): live view, text filter, download as
  `/logs.txt?lines=N`. Tokens and keys are masked.
- On the TV: `ssh root@TV_IP tail -f /tmp/earc-volume-overlay.log`.
- Docker: `docker compose logs -f`.

A healthy start looks like this:

```text
service starting (yamaha 192.168.1.50, with signal info)
watching 192.168.1.50 at 42:false
```

If something is wrong and the answer is not below, open an issue and attach the relevant log lines (the log page
already masks tokens and keys, but check before you post).

## Installing

| Symptom | What to check |
|---|---|
| The installer cannot connect to the TV | Does `ssh root@TV_IP "echo ok"` work by hand? Is SSH enabled in the Homebrew Channel? Is it the right key (`TV_SSH_KEY=/path/to/key`)? A new computer has no key: copy your old one or make a new one and put its public half on the TV (INSTALL.md section 4). |
| `Permission denied (publickey,password)` | The TV does not know this computer's key. Fix the key, not the installer. |
| "No Yamaha receiver answered" | Receiver address, Network Standby on, same network, and the API test in INSTALL.md section 5. You can say yes to use the address anyway, or press Enter to skip the receiver. |
| `sh: command not found`, or `npx`/`npm` fails with `C:/Program Files/nodejs/npx: No such file or directory` (Windows) | The installer is a shell script. Use **Git Bash** or WSL, not plain PowerShell. If Node is installed under `C:\Program Files`, Git Bash can fail to run Node's `npx` shim because the folder name has a space, so building from source fails. The supported route on Windows is the **release archive**: unpack it and double-click `Install-AVOverlay.cmd` (no Git or Node needed, only the built-in OpenSSH Client). |
| `claude`, `git`, `node` or `gh` "is not recognized" straight after installing it (Windows) | The terminal you are in started before the install. Open a new terminal. In the Claude desktop app's built-in terminal, restart the app. |
| PowerShell says running scripts is disabled | Use `Install-AVOverlay.cmd`, or run `powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -TvHost root@TV_IP`. |
| The installer says it installed but nothing shows on the TV | Open `http://TV_IP:41101/status`. If it does not load, see "The watcher" below. |

## The TV apps

| Symptom | What it means and what to do |
|---|---|
| Opening the **eARC Volume Overlay** app shows a page with Enable, Disable and Test overlay, and the message `Denied method call "exec" for category "/"` | **Expected, not a fault.** webOS does not let that app call the Homebrew Channel's root service, so those three buttons cannot work. The watcher does not depend on them: the installer enables and starts it. Use the **AV Overlay Settings** icon, or `http://TV_IP:41101/setup`, to change anything. The app also shows this page if its Quick Access call is refused (see below). |
| The **AV Overlay Settings** app says "The overlay service is not running on this TV" | The app cannot read `http://127.0.0.1:41101/status.json` from the TV. Check `http://TV_IP:41101/status` from a computer: if that loads, the watcher is running and the TV apps are an older build, so redeploy (`sh scripts/deploy.sh`). If it does not load, the watcher is not running (see below). On Docker, tap **Try again / change URL** and enter `http://<docker-host>:41101`. |
| The Quick Access key (a number key assigned to the app) shows the setup page instead of the bar | The app's call to the watcher did not return 200. Check the watcher is running (`/status`) and open `/logs` for a "quick access" line. The apps and the watcher are versioned together: if the versions differ, redeploy (`sh scripts/deploy.sh`). On Docker, `WATCHER_URL` must be an address the TV can reach. |
| Pointer (Magic Remote) cannot click anything on an HDMI input | Expected. HDMI-CEC only passes key presses to a box such as an Apple TV. It works over native TV apps. |
| Pressing channel up/down while the bar is on screen | The first press dismisses the bar and is passed on, so one press still changes the channel. |

## The watcher

| Symptom | What to check |
|---|---|
| `http://TV_IP:41101/status` does not load | The watcher is not running. Reboot the TV (it starts at boot), or run the installer again. After a TV firmware or Homebrew Channel change, root may be gone: check the Homebrew Channel shows *root: ok*. |
| Nothing works after a TV update | Root may have been removed; see webosbrew.org. Do not update firmware on a rooted TV. |
| The bar never appears | Auto info is off at `/setup`: use **Show on TV** on the status page. |
| Pinned bar gone after a restart | It comes back by itself about 8 seconds after the watcher starts. If not, press **Show on TV** again and check the log. |
| The bar vanishes when you switch between Live TV and apps | A pinned bar is restored within a moment. If it does not come back, check the log for "pinned bar went away". |
| The TV's input picker or settings flicker or do not show with Show on TV on | The bar waits for those menus to close before it returns. If one still misbehaves, send the `/logs` lines around it: the "went away" lines show what the TV was running. |
| A page on another web site or dashboard cannot read or change things | By design the setup page rejects settings saved from another site (the Origin must match the TV's address). The control addresses (`/info`, `/app`, `/tv/...`) are plain GETs with no password, so keep port 41101 on your home network. |

## The receiver

| Symptom | What to check |
|---|---|
| "amp not configured" | No receiver address is set. Enter it at `/setup`, or ignore it if you are using the TV-only info bar on purpose. |
| "amp unreachable" / "Receiver not responding" | Check the address, that the receiver is on, and that **Network Standby** is on. While it is not answering the bar says "Receiver not responding" with when it last answered, and the receiver's numbers (volume, sound program, audio) are hidden rather than showing a stale value. `/status.json` has `reachable` and `lastOk`. |
| No volume popup | `/status` shows a volume? Check the log. The popup only appears when the receiver's volume or mute changes. |
| Volume changes are slow to show | Events from the receiver are not reaching the watcher, so it is using the 2 second poll. Docker: `network_mode: host` is needed (Linux only). |
| The receiver changes sound program at odd times | Check the "Right now" line and the rules at `/setup`; turn **Switch the sound program automatically** off to compare. |
| Audio (TV) row missing | Is **Show "Audio (TV)"** ticked at `/setup`? It is off by default. Then change the input or press **Show on TV**: it appears once the TV reports a value. If it stays empty, open an issue with your TV model and webOS version. |

## Plex, Jellyfin, Home Assistant

| Symptom | What to check |
|---|---|
| **Test Plex** or **Test Jellyfin** fails | URL (`http://SERVER:32400` or `:8096`), the token or API key, and that the server is reachable from the TV (or from the Docker host). |
| The wrong Plex or Jellyfin session shows | Set the **Player IP** (Plex) or **Device / client name** (Jellyfin) at `/setup`. |
| App not detected on an Apple TV | The Home Assistant automation is not firing: check its trace, the `rest_command` name, and the "app pushed" line in the log. |
| A dashboard button does nothing | Call the overlay with a `rest_command` from Home Assistant itself, or embed the status page in an iframe card. See HOME-ASSISTANT.md. |

## Docker

| Symptom | What to check |
|---|---|
| **Show on TV** does nothing | `WATCHER_URL` in `.env` must be reachable from the **TV**, not just from the Docker host. Check the host firewall allows 41101/tcp. |
| SSH connection refused or key rejected | `docker compose exec av-overlay ssh -i /run/secrets/tv_ssh_key -o StrictHostKeyChecking=no root@TV_IP echo ok`. Then check the TV is on, `TV_SSH_KEY` points at the right private key (full path, no `~`), and the public key is in `/home/root/.ssh/authorized_keys` on the TV. |
| Two watchers running (the TV's own and Docker's) | The TV's own watcher must not run when Docker does: remove the boot hook and stop the running watcher (DOCKER.md step 6). |
| Events are not instant | Docker Desktop (Mac or Windows) cannot do host networking to your LAN. Use a Linux host. |

## After you update

- Update the TV with `TV_HOST=root@TV_IP sh scripts/deploy.sh` (settings are kept). Docker: `git pull` then
  `docker compose up -d --build`, and redeploy the TV apps too, because the apps and the watcher are versioned together.
- The watcher's version shows at the bottom of `/status` and `/setup` (`AV Overlay v<version>`). The TV apps' version
  is in `/media/developer/apps/usr/palm/applications/com.sammysco.avoverlay/appinfo.json` on the TV. If they differ,
  deploy again.
