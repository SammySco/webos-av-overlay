# Running the AV Overlay watcher in Docker

This guide deploys the watcher process on a separate Linux host (e.g. a home
server or Raspberry Pi) using Docker Compose.  The TV still runs the two WebOS
apps — only the watcher moves into a container.

---

## How it works

```
  ┌──────────────┐           ┌────────────────────────────┐
  │  LG TV       │           │  Docker host               │
  │              │◄──luna────│  av-overlay container      │
  │  WebOS apps  │  (SSH)    │  • polls Yamaha amp        │
  │  (IPK)       │           │  • polls Plex / Jellyfin   │
  │              │──HTTP────►│  • serves :41101/status    │
  └──────────────┘           └────────────────────────────┘
         │                           │
         ▼ HDMI eARC                 ▼ HTTP
  ┌──────────────┐           ┌────────────────────────────┐
  │  Yamaha amp  │◄──UDP────►│  :41100 (amp events)       │
  └──────────────┘           └────────────────────────────┘
```

The container proxies every `luna-send` call to the TV over SSH, so volume
pop-ups and the info bar still appear on screen.  `network_mode: host` puts the
container directly on the LAN so the amp's UDP event packets reach it.

---

## Prerequisites

You need:

| What | Why |
|------|-----|
| A Linux host on the same LAN as the TV and amp | UDP multicast / `network_mode: host` |
| Docker Engine ≥ 24 | runs the container |
| Docker Compose v2 (the `docker compose` plugin) | orchestration |
| Git | cloning the repo |
| An SSH key that has `root` access to the TV | the container calls `luna-send` via SSH |

---

## Step 1 — Install Docker Engine

### Ubuntu / Debian (including Raspberry Pi OS)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# For Raspberry Pi OS (Debian) replace 'ubuntu' with 'debian':
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                        docker-buildx-plugin docker-compose-plugin
```

Allow your user to run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
newgrp docker          # apply without logging out
```

Verify:

```bash
docker --version       # Docker version 27.x.x, ...
docker compose version # Docker Compose version v2.x.x
```

### Fedora / RHEL / Rocky Linux

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo \
     https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

---

## Step 2 — Install Git (if not already present)

```bash
# Ubuntu / Debian
sudo apt-get install -y git

# Fedora / RHEL
sudo dnf install -y git
```

---

## Step 3 — Clone this repository

```bash
git clone https://github.com/SammySco/webos-av-overlay av-overlay
cd av-overlay
```

> A shallow clone saves time if you only need the latest version:
> ```bash
> git clone --depth 1 https://github.com/SammySco/webos-av-overlay av-overlay
> ```

---

## Step 4 — Set up the SSH key for the TV

The container needs a private key that allows `root@<TV-IP>` login without a
password.  If you already have one on the PC that was used to install the TV
apps, copy it to the Docker host:

```bash
# On the PC that already has TV access — copy the key to the Docker host:
scp ~/.ssh/id_rsa user@192.168.1.5:~/.ssh/tv_id_rsa
```

If you need to create a new key pair on the Docker host:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tv_id_rsa -N "" -C "av-overlay-docker"
```

Then authorise it on the TV (run this once from the Docker host):

```bash
ssh-copy-id -i ~/.ssh/tv_id_rsa.pub root@192.168.1.50
# Accept the host key; no password prompt should appear afterwards.
```

Verify:

```bash
ssh -i ~/.ssh/tv_id_rsa -o BatchMode=yes root@192.168.1.50 echo ok
# should print:  ok
```

---

## Step 5 — Create the .env file

```bash
cp .env.example .env
nano .env          # or: vi .env
```

Set these values:

```ini
# SSH target for the TV
TV_HOST=root@192.168.1.50

# Full path to the SSH private key on this host
TV_SSH_KEY=/home/youruser/.ssh/tv_id_rsa

# URL the TV's overlay app uses to reach this watcher.
# Use this host's LAN IP — the TV must be able to reach it.
WATCHER_URL=http://192.168.1.5:41101

# Yamaha receiver IP (or leave blank and enter it via the /setup page)
AMP_HOST=192.168.1.108
```

`~` expansion does **not** work in Docker Compose env files — use the full
path for `TV_SSH_KEY`.

---

## Step 6 — Install the WebOS apps on the TV (if not already done)

> Skip this step if the overlay and settings apps are already installed.

From **this repository directory** on any machine that can SSH to the TV:

```bash
TV_HOST=root@192.168.1.50 sh scripts/install.sh
```

The installer builds the IPKs, copies them to the TV, and links the boot
hook.  When it asks for the receiver address you can press Enter to skip — you
will set it via the `/setup` page after the container is running.

> **Important:** after installing with Docker, do **not** let the TV's
> boot hook start the watcher automatically.  Disable the boot hook so only
> the Docker container runs the watcher:
>
> ```bash
> ssh root@192.168.1.50 'rm -f /var/lib/webosbrew/init.d/91-earc-volume-overlay'
> ```
>
> The WebOS overlay app (the visual layer) stays installed — only the
> background watcher process is moved to Docker.

---

## Step 7 — Build and start the container

```bash
docker compose up -d --build
```

This builds the image (≈ 30 s the first time) and starts the container in the
background.

Check it is running:

```bash
docker compose ps
# NAME          STATUS   PORTS
# av-overlay-1  running

docker compose logs -f
# 2026-10-08T... listening for amp events on udp/41100
# 2026-10-08T... on-demand info at http://<tv>:41101/info
# 2026-10-08T... watching 192.168.1.108 at 42:false
```

If the amp is not yet configured you will see:

```
service starting (yamaha not configured, with signal info)
```

That is expected — configure it in Step 8.

---

## Step 8 — Configure the receiver (and optionally Plex / Jellyfin)

Open the setup page in any browser:

```
http://192.168.1.5:41101/setup
```

Enter the Yamaha receiver's IP address and click **Save**.  The status page
at `http://192.168.1.5:41101/status` should soon show the current sound
program and volume.

To add Plex or Jellyfin stream details, expand the relevant section ("Plex (optional)" or
"Jellyfin (optional)") and enter the server URL and token/API key.  Press **Test Plex** or
**Test Jellyfin** to verify the connection before saving.

To verify the TV overlay still works, open:

```
http://192.168.1.5:41101/info
```

The info bar should appear on the TV.

---

## Step 9 — (Optional) start automatically on boot

```bash
sudo systemctl enable docker          # Docker itself starts on boot

# The container's restart: unless-stopped policy handles the rest.
# Confirm it survives a reboot:
sudo reboot
# After reboot:
docker compose -f /path/to/av-overlay/docker-compose.yml ps
```

To run Compose as a systemd service instead:

```bash
sudo nano /etc/systemd/system/av-overlay.service
```

```ini
[Unit]
Description=AV Overlay watcher
After=docker.service network-online.target
Requires=docker.service

[Service]
WorkingDirectory=/home/youruser/av-overlay
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now av-overlay
```

---

## Updating

```bash
cd av-overlay
git pull
docker compose up -d --build
```

The new image is built and the container is replaced with zero downtime
(the old container keeps running until the new one is ready).

---

## Logs and troubleshooting

```bash
# Follow live logs
docker compose logs -f

# Check the SSH proxy (should print "ok")
docker compose exec av-overlay \
    sh -c 'ssh -o BatchMode=yes "${EARC_TV_HOST}" echo ok'

# Inspect the settings file inside the container
docker compose exec av-overlay cat /data/earc-overlay.json

# Restart after a config change
docker compose restart

# Stop and remove the container (data volume is preserved)
docker compose down

# Stop and remove the container AND wipe stored settings
docker compose down -v
```

### The TV shows "Show on TV" does nothing

- Check `WATCHER_URL` in `.env` — it must be reachable from the TV, not from
  the Docker host.
- Make sure port 41101 is not blocked by the Docker host's firewall:
  ```bash
  sudo ufw allow 41101/tcp   # if using ufw
  ```

### Amp events are not instant (only polling)

`network_mode: host` is required for UDP events to work.  Confirm the
container is in host mode:

```bash
docker inspect av-overlay-av-overlay-1 | grep NetworkMode
# "NetworkMode": "host"
```

If you are on Docker Desktop (Mac/Windows) `network_mode: host` maps to the
VM's network, not your LAN — UDP events will not work there.  Use a Linux
host.

### SSH connection refused or key rejected

```bash
# Test from inside the container
docker compose exec av-overlay \
    ssh -i /run/secrets/tv_ssh_key \
    -o StrictHostKeyChecking=no \
    root@192.168.1.50 echo ok
```

If that fails, check:
1. The TV is on and reachable (`ping 192.168.1.50`).
2. The SSH key at `TV_SSH_KEY` in `.env` is the correct private key.
3. The public key is in `/home/root/.ssh/authorized_keys` on the TV.

---

## Architecture notes

| Feature | How it works in Docker |
|---------|----------------------|
| Volume pop-up / info bar | watcher → SSH → `luna-send` on TV |
| Amp events (instant) | Yamaha UDP → Docker host port 41100 |
| Amp polling (fallback) | watcher → HTTP → amp |
| Plex session details | watcher → HTTP → Plex server |
| Jellyfin session details | watcher → HTTP → Jellyfin server |
| TV video/source info | watcher → SSH → `luna-send -i` subscribe on TV |
| Foreground app / running apps | watcher → SSH → `luna-send -i` subscribe on TV (15 s and 10 s safety polls) |
| Pin-state / key forwarding | WebOS app → HTTP → `WATCHER_URL:41101` |
| Settings page | any browser → `http://<docker-host>:41101/setup` |
