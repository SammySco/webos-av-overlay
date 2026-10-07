#!/bin/sh
# ── AV Overlay — Docker Compose installer ───────────────────────────────────
# Checks for each prerequisite, installs anything missing, configures the
# deployment, and starts the container.
#
#   sh scripts/docker/install.sh
#
# Pre-answer prompts with environment variables or a .env file:
#   TV_HOST       root@192.168.1.50
#   TV_SSH_KEY    /home/user/.ssh/tv_key
#   WATCHER_URL   http://192.168.1.5:41101
#   AMP_HOST      192.168.1.108
#
# Works on Ubuntu, Debian (incl. Raspberry Pi OS), Fedora, RHEL, Rocky Linux,
# and any distribution that supports the get.docker.com convenience script.
set -e

# ── helpers ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  CG=$(tput setaf 2); CY=$(tput setaf 3); CR=$(tput setaf 1); CB=$(tput bold); CN=$(tput sgr0)
else
  CG=''; CY=''; CR=''; CB=''; CN=''
fi
ok()   { printf '%s✓%s  %s\n'         "$CG" "$CN" "$*"; }
warn() { printf '%s!%s  %s\n'         "$CY" "$CN" "$*"; }
info() { printf '   %s\n'             "$*"; }
die()  { printf '\n%s✗  %s%s\n\n'    "$CR" "$*" "$CN" >&2; exit 1; }
step() { printf '\n%s── %s ──%s\n'   "$CB" "$*" "$CN"; }

ask() {
  # ask "Prompt" "default"  →  prints answer to stdout; prompt to stderr
  _p=$1; _d=${2:-}
  [ -n "$_d" ] && printf '  %s [%s]: ' "$_p" "$_d" >&2 || printf '  %s: ' "$_p" >&2
  IFS= read -r _a </dev/tty 2>/dev/null || _a=''
  printf '%s' "${_a:-$_d}"
}
yn() {
  # yn "Question" y|n  →  0 = yes
  _def=${2:-y}; [ "$_def" = y ] && _h='Y/n' || _h='y/N'
  printf '  %s [%s]: ' "$1" "$_h" >&2
  IFS= read -r _a </dev/tty 2>/dev/null || _a=''
  case "${_a:-$_def}" in y|Y) return 0;; *) return 1;; esac
}

# ── locate repo root ─────────────────────────────────────────────────────────
SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
cd "$SCRIPT_DIR/../.." 2>/dev/null || true
[ -f docker-compose.yml ] || die "docker-compose.yml not found.\nRun from the repository root: sh scripts/docker/install.sh"
REPO_ROOT=$(pwd)

# ── load .env (values already in the environment take precedence) ─────────────
if [ -f .env ]; then
  while IFS= read -r _line; do
    case "$_line" in '#'*|'') continue;; esac
    _k=${_line%%=*}; _v=${_line#*=}
    eval "[ -n \"\${${_k}+x}\" ] || export ${_k}=\"\${_v}\""
  done < .env
fi

# ── platform ─────────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux) ;;
  Darwin) die "macOS not supported: Docker Desktop on Mac uses a VM — network_mode:host cannot reach your LAN.\nUse a Linux host on the same LAN as the TV and amp."; ;;
  *)     die "This script requires a Linux host."; ;;
esac
if grep -qsi 'microsoft' /proc/version 2>/dev/null; then
  warn "Running inside WSL. network_mode:host maps to the WSL2 VM — Yamaha UDP events will not reach the container."
  info "A native Linux host (your home server) is strongly recommended."
  yn "Continue anyway?" n || exit 0
fi

OS_ID='linux'; OS_LIKE=''
[ -f /etc/os-release ] && { . /etc/os-release; OS_ID=${ID:-linux}; OS_LIKE=${ID_LIKE:-}; }
is_deb() { case " $OS_ID $OS_LIKE " in *' debian '*|*' ubuntu '*|*' raspbian '*) return 0;; esac; return 1; }
is_rpm() { case " $OS_ID $OS_LIKE " in *' fedora '*|*' rhel '*|*' centos '*|*' rocky '*|*' alma '*) return 0;; esac; return 1; }

printf '\n%sAV Overlay — Docker Compose installer%s\n' "$CB" "$CN"
info "Repo: $REPO_ROOT   OS: $OS_ID${OS_LIKE:+ (like $OS_LIKE)}"

# ── sudo ─────────────────────────────────────────────────────────────────────
step "Privileges"
SUDO=''
if [ "$(id -u)" = '0' ]; then
  ok "Running as root"
elif sudo -n true 2>/dev/null; then
  SUDO='sudo'; ok "sudo available"
else
  SUDO='sudo'; warn "sudo may prompt for your password during package installs"
fi

# ── git ──────────────────────────────────────────────────────────────────────
step "Git"
if command -v git >/dev/null 2>&1; then
  ok "Git $(git --version | awk '{print $3}')"
else
  warn "Git not found — installing..."
  if is_deb; then $SUDO apt-get update -qq && $SUDO apt-get install -y -q git
  elif is_rpm; then $SUDO dnf install -y git
  else die "Cannot install Git automatically on $OS_ID — install it and re-run."; fi
  ok "Git installed"
fi

# ── docker engine ────────────────────────────────────────────────────────────
step "Docker Engine"
DOCKER=docker

if docker info >/dev/null 2>&1; then
  ok "Docker $(docker --version | awk '{gsub(/,/,"",$3); print $3}')"
elif $SUDO docker info >/dev/null 2>&1; then
  # Docker works via sudo — use it and move on; suggest joining the group but don't block
  ok "Docker installed (using sudo; add yourself to the docker group to avoid sudo later)"
  DOCKER="$SUDO docker"
else
  warn "Docker not found — installing via get.docker.com..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | $SUDO sh
  elif is_deb; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -q ca-certificates curl
    $SUDO install -m 0755 -d /etc/apt/keyrings
    $SUDO curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
         -o /etc/apt/keyrings/docker.asc
    $SUDO chmod a+r /etc/apt/keyrings/docker.asc
    _cn=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$(. /etc/os-release && echo "$ID")" "$_cn" | \
      $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -q docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin
  elif is_rpm; then
    $SUDO dnf install -y dnf-plugins-core
    $SUDO dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
    $SUDO dnf install -y docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin
  else
    die "Cannot install Docker on $OS_ID.\nSee https://docs.docker.com/engine/install/ and re-run."
  fi
  $SUDO systemctl enable --now docker 2>/dev/null || true
  ok "Docker installed"
  # Add user to docker group so they don't need sudo after next login
  if [ "$(id -u)" != '0' ] && ! id -nG | grep -qw docker; then
    $SUDO usermod -aG docker "$(id -un)" 2>/dev/null || true
    warn "Added $(id -un) to the docker group (takes effect on next login)."
  fi
  DOCKER="$SUDO docker"
fi

# ── docker compose v2 ────────────────────────────────────────────────────────
step "Docker Compose"
if $DOCKER compose version >/dev/null 2>&1; then
  ok "Docker Compose $($DOCKER compose version --short 2>/dev/null || echo v2)"
else
  warn "Docker Compose plugin not found — installing..."
  if is_deb; then $SUDO apt-get install -y -q docker-compose-plugin
  elif is_rpm; then $SUDO dnf install -y docker-compose-plugin
  else die "Install the Docker Compose plugin: https://docs.docker.com/compose/install/"; fi
  ok "Docker Compose installed"
fi
COMPOSE="$DOCKER compose"

# ── ssh client ───────────────────────────────────────────────────────────────
step "SSH client"
if command -v ssh >/dev/null 2>&1; then
  ok "SSH client available"
else
  warn "SSH client not found — installing..."
  if is_deb; then $SUDO apt-get install -y -q openssh-client
  elif is_rpm; then $SUDO dnf install -y openssh-clients
  else die "Install an SSH client and re-run."; fi
  ok "SSH client installed"
fi

# ── ssh key for the tv ───────────────────────────────────────────────────────
step "SSH key for the TV"

TV_HOST=${TV_HOST:-}
[ -n "$TV_HOST" ] || TV_HOST=$(ask "TV SSH host (user@ip)" "root@192.168.1.50")
TV_IP=$(printf '%s' "$TV_HOST" | sed 's/^[^@]*@//')
info "TV: $TV_HOST"

_try_key() {
  [ -f "$1" ] || return 1
  ssh -i "$1" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=8 "$TV_HOST" true >/dev/null 2>&1
}

TV_SSH_KEY=${TV_SSH_KEY:-}
# Expand a leading ~ to $HOME (sh does not expand ~ in variable assignments)
case "$TV_SSH_KEY" in '~'/*) TV_SSH_KEY="$HOME/${TV_SSH_KEY#~/}";; esac
_good_key=''

# Test the env / .env key first
if [ -n "$TV_SSH_KEY" ] && _try_key "$TV_SSH_KEY"; then
  _good_key=$TV_SSH_KEY
fi

# Auto-probe common locations
if [ -z "$_good_key" ]; then
  for _k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ecdsa" \
            "$HOME/.ssh/tv_id_ed25519" "$HOME/.ssh/tv_id_rsa"; do
    if _try_key "$_k"; then
      info "Found working key: $_k"
      _good_key=$_k
      break
    fi
  done
fi

# Offer to create and authorise a new key
if [ -z "$_good_key" ]; then
  warn "No existing SSH key can reach $TV_HOST."
  info "(The TV may be unreachable, or none of the standard key files are authorised.)"
  yn "Create a new SSH key pair and authorise it on the TV?" || \
    die "An SSH key that can reach the TV is required. See docs/DOCKER.md Step 4."

  _new_key="$HOME/.ssh/tv_id_ed25519"
  if [ ! -f "$_new_key" ]; then
    ssh-keygen -t ed25519 -f "$_new_key" -N "" -C "av-overlay-docker" >/dev/null
    ok "New key pair created: $_new_key"
  else
    ok "Key $_new_key already exists — reusing it"
  fi

  info "Copying public key to $TV_HOST (you may be prompted for the TV root password):"
  if command -v ssh-copy-id >/dev/null 2>&1; then
    ssh-copy-id -i "${_new_key}.pub" "$TV_HOST" || \
      die "Could not copy the key. Check the TV is on and SSH is enabled (port 22)."
  else
    # Manual fallback when ssh-copy-id is not available
    _pub=$(cat "${_new_key}.pub")
    ssh "$TV_HOST" "mkdir -p /root/.ssh; chmod 700 /root/.ssh; \
      printf '%s\n' '$_pub' >> /root/.ssh/authorized_keys; \
      chmod 600 /root/.ssh/authorized_keys" || \
      die "Could not copy the key. Check the TV is on and SSH is enabled."
  fi

  if _try_key "$_new_key"; then
    ok "Key authorised — passwordless login works"
    _good_key=$_new_key
  else
    die "Key was copied but login still fails. Check /root/.ssh/authorized_keys on the TV."
  fi
fi
TV_SSH_KEY=$_good_key
ok "SSH key: $TV_SSH_KEY"

# ── .env file ────────────────────────────────────────────────────────────────
step "Configuring .env"

# Try to detect this host's LAN IP on the path to the TV
_lan_ip=$(ip route get "$TV_IP" 2>/dev/null \
          | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)
[ -n "$_lan_ip" ] || _lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)

_def_watcher=${WATCHER_URL:-}
[ -n "$_def_watcher" ] || [ -z "$_lan_ip" ] || _def_watcher="http://$_lan_ip:41101"

WATCHER_URL=$(ask "Watcher URL (reachable from the TV, not 127.0.0.1)" \
              "${_def_watcher:-http://192.168.1.5:41101}")
AMP_HOST=$(ask "Yamaha receiver IP address (or leave blank to set via /setup later)" \
           "${AMP_HOST:-}")

cat > .env <<ENVEOF
# Generated by scripts/docker/install.sh on $(date -u '+%Y-%m-%d')
TV_HOST=${TV_HOST}
TV_SSH_KEY=${TV_SSH_KEY}
WATCHER_URL=${WATCHER_URL}
AMP_HOST=${AMP_HOST}
ENVEOF
chmod 600 .env
ok ".env written"

# ── webos apps on the tv ─────────────────────────────────────────────────────
step "WebOS overlay apps on the TV"

_app_path=''
for _base in /media/developer/apps/usr/palm/applications \
             /media/cryptofs/apps/usr/palm/applications; do
  if ssh -i "$TV_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TV_HOST" \
       "[ -f '$_base/com.sammysco.avoverlay/runtime/watcher.js' ]" 2>/dev/null; then
    _app_path=$_base/com.sammysco.avoverlay
    break
  fi
done

_disable_hook=false

if [ -n "$_app_path" ]; then
  ok "Overlay app is installed on the TV ($_app_path)"
  if yn "Make Docker the primary watcher? (disables the TV's boot hook)" n; then
    _disable_hook=true
  else
    info "Skipping — the TV-local watcher continues to run. You can switch later by removing"
    info "  /var/lib/webosbrew/init.d/91-earc-volume-overlay  on the TV."
  fi
else
  warn "Overlay app not found on the TV"
  if yn "Install the WebOS overlay app on the TV now?"; then
    if ! command -v npm >/dev/null 2>&1; then
      warn "npm is not installed — it is needed to build the IPK packages"
      if is_deb; then
        $SUDO apt-get install -y -q nodejs npm
      elif is_rpm; then
        $SUDO dnf install -y nodejs npm
      else
        die "Install Node.js / npm then re-run: https://nodejs.org"
      fi
    fi
    info "Building and installing IPKs (takes ≈ 1 min)..."
    TV_HOST="$TV_HOST" TV_SSH_KEY="$TV_SSH_KEY" \
      EARC_AMP_HOST="${AMP_HOST:-}" EARC_NONINTERACTIVE=1 \
      sh scripts/install.sh
    ok "WebOS apps installed"
    _disable_hook=true
  else
    info "Skipping — run later: TV_HOST=$TV_HOST sh scripts/install.sh"
    info "The Docker watcher will still run; the TV overlay needs the IPK to display anything."
  fi
fi

# Disable the TV's boot hook only when the user has committed to Docker as the watcher
if [ "$_disable_hook" = true ]; then
  _hook=$(ssh -i "$TV_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8 "$TV_HOST" \
    "[ -e /var/lib/webosbrew/init.d/91-earc-volume-overlay ] && echo active || echo inactive" \
    2>/dev/null || echo unknown)
  if [ "$_hook" = active ]; then
    warn "TV boot hook is active — disabling it (Docker is the watcher now)"
    ssh -i "$TV_SSH_KEY" -o BatchMode=yes "$TV_HOST" \
      'rm -f /var/lib/webosbrew/init.d/91-earc-volume-overlay
       _pid=$(cat /tmp/earc-volume-overlay.pid 2>/dev/null || true)
       [ -z "$_pid" ] || kill "$_pid" 2>/dev/null || true' 2>/dev/null
    ok "Boot hook removed; TV-side watcher stopped"
  elif [ "$_hook" = inactive ]; then
    ok "TV boot hook already disabled"
  else
    info "Could not check TV boot hook state (SSH may have timed out)"
  fi
fi

# ── build and start ──────────────────────────────────────────────────────────
step "Building and starting the container"
$COMPOSE up -d --build
ok "Container started"

# ── verify ───────────────────────────────────────────────────────────────────
step "Verifying"
_port=${INFO_PORT:-41101}
_tries=15; _up=false
printf '  Waiting for watcher'
while [ "$_tries" -gt 0 ]; do
  if curl -sf "http://127.0.0.1:$_port/status.json" >/dev/null 2>&1; then
    _up=true; break
  fi
  printf '.'; sleep 2; _tries=$((_tries - 1))
done
printf '\n'

if [ "$_up" = true ]; then
  ok "Watcher is responding on port $_port"
  _reach=$(curl -sf "http://127.0.0.1:$_port/status.json" 2>/dev/null \
           | grep -o '"reachable":[a-z]*' | cut -d: -f2 || echo '')
  if [ "$_reach" = true ]; then
    ok "Receiver is reachable"
  elif [ -n "$AMP_HOST" ]; then
    warn "Receiver at $AMP_HOST not reachable yet — check AMP_HOST or visit http://127.0.0.1:$_port/setup"
  else
    info "No receiver address set — visit http://127.0.0.1:$_port/setup to configure one"
  fi
else
  warn "Watcher did not respond after 30 s — last logs:"
  $COMPOSE logs --tail 20
  info ""
  info "Check for errors above and re-run, or see docs/DOCKER.md for troubleshooting."
fi

# ── summary ──────────────────────────────────────────────────────────────────
printf '\n%s────────────────────────────────────────%s\n' "$CB" "$CN"
if [ "$_up" = true ]; then
  ok "Installation complete"
else
  warn "Installation complete (watcher not yet responding — check logs)"
fi
printf '\n'
info "Status page:  http://127.0.0.1:${_port}/status"
info "Setup page:   http://127.0.0.1:${_port}/setup"
info "From the TV:  ${WATCHER_URL}/status"
info ""
info "Logs:    $COMPOSE logs -f"
info "Restart: $COMPOSE restart"
info "Update:  git pull && $COMPOSE up -d --build"
printf '%s────────────────────────────────────────%s\n\n' "$CB" "$CN"
