#!/bin/sh
# Installs the overlay (and the home-screen settings app) on a rooted LG TV, asks for the settings it needs,
# and starts the watcher.
#
#   TV_HOST=root@TV_IP sh scripts/install.sh
#
# Optional environment (skips the matching question; set EARC_NONINTERACTIVE=1 to never ask):
#   TV_SSH_KEY            private key for ssh
#   EARC_AMP_HOST         Yamaha receiver IP address or hostname
#   EARC_AMP_PORT         receiver port (default 80)
#   EARC_PLEX_URL         Plex server URL, e.g. http://192.168.1.10:32400
#   EARC_PLEX_TOKEN       Plex token (never put this in shell history; the prompt hides it)
#   EARC_PLEX_PLAYER_IP   only show the Plex session from this player
#   EARC_AUTO_INFO        on|off  show the info bar by itself when the stream/amp info changes
#   EARC_CORNER           top-left|top-right|bottom-left
# Everything can be changed later at http://TV_IP:41101/setup or from the AV Overlay Settings app.
set -eu
cd "$(dirname "$0")/.."
: "${TV_HOST:?Set TV_HOST, for example root@TV_IP_ADDRESS}"
APP_ID=com.sammysco.avoverlay
SETTINGS_ID=com.sammysco.avoverlay.settings
REMOTE_IPK=/tmp/earc-volume-overlay.ipk

ssh_tv() {
	if [ -n "${TV_SSH_KEY:-}" ]; then ssh -i "$TV_SSH_KEY" -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"
	else ssh -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"; fi
}
ssh_tv_tty() {
	if [ -n "${TV_SSH_KEY:-}" ]; then ssh -tt -i "$TV_SSH_KEY" -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"
	else ssh -tt -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"; fi
}
scp_tv() {
	if [ -n "${TV_SSH_KEY:-}" ]; then scp -i "$TV_SSH_KEY" -o StrictHostKeyChecking=accept-new "$1" "$TV_HOST:$2"
	else scp -o StrictHostKeyChecking=accept-new "$1" "$TV_HOST:$2"; fi
}

install_ipk() {
	echo "Installing $2..."
	scp_tv "$1" "$REMOTE_IPK"
	ssh_tv_tty "luna-send -w 60000 -i luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$REMOTE_IPK\",\"subscribe\":true}' | grep -oE '\"state\":\"[^\"]*\"|\"errorText\":\"[^\"]*\"' | uniq"
}

IPK=$(ls build/${APP_ID}_*_all.ipk 2>/dev/null | head -n 1 || true)
SETTINGS_IPK=$(ls build/${SETTINGS_ID}_*_all.ipk 2>/dev/null | head -n 1 || true)
if [ -z "$IPK" ] || [ -z "$SETTINGS_IPK" ]; then
	[ -d node_modules ] || npm install
	npm run package
	IPK=$(ls build/${APP_ID}_*_all.ipk | head -n 1)
	SETTINGS_IPK=$(ls build/${SETTINGS_ID}_*_all.ipk | head -n 1)
fi

echo "Copying apps to $TV_HOST..."
install_ipk "$IPK" "$APP_ID"
install_ipk "$SETTINGS_IPK" "$SETTINGS_ID"

# ---------- locate the installed app on the TV ----------
APP_DIR=$(ssh_tv "for BASE in /media/developer/apps/usr/palm/applications /media/cryptofs/apps/usr/palm/applications; do
	if [ -f \"\$BASE/$APP_ID/runtime/watcher.js\" ]; then echo \"\$BASE/$APP_ID\"; break; fi
done")
[ -n "$APP_DIR" ] || { echo "Could not find the installed app on the TV" >&2; exit 1; }
CONFIGURE="node '$APP_DIR/runtime/configure.js'"
CUR=$(ssh_tv "$CONFIGURE get" 2>/dev/null || true)
cur() { printf '%s\n' "$CUR" | sed -n "s/^$1=//p" | head -n 1; }

# ---------- settings ----------
INTERACTIVE=0
if [ -t 0 ] && [ "${EARC_NONINTERACTIVE:-0}" != 1 ]; then INTERACTIVE=1; fi

valid_host() { case "$1" in ''|*[!A-Za-z0-9.-]*|.*|*.|-*|*-) return 1;; *) return 0;; esac; }

AMP_HOST="${EARC_AMP_HOST:-}"
AMP_PORT="${EARC_AMP_PORT:-}"
PLEX_URL="${EARC_PLEX_URL:-}"
PLEX_TOKEN="${EARC_PLEX_TOKEN:-}"
PLEX_PLAYER="${EARC_PLEX_PLAYER_IP:-}"
AUTO_INFO="${EARC_AUTO_INFO:-}"
CORNER="${EARC_CORNER:-}"

if [ "$INTERACTIVE" = 1 ]; then
	echo
	echo "Settings (press Enter to keep the value in [brackets]; all of this can be changed later at http://<tv>:41101/setup)"

	if [ -z "$AMP_HOST" ]; then
		DEFAULT_AMP=$(cur ampHost)
		while :; do
			printf 'Yamaha receiver IP address or hostname [%s]: ' "$DEFAULT_AMP"
			read -r ANS || ANS=
			[ -n "$ANS" ] || ANS=$DEFAULT_AMP
			if ! valid_host "$ANS"; then echo "  That does not look like an IP address or hostname."; continue; fi
			echo "  Checking that the TV can reach it..."
			if ssh_tv "curl -s -m 4 http://$ANS:${AMP_PORT:-80}/YamahaExtendedControl/v1/system/getDeviceInfo" 2>/dev/null | grep -q '"response_code" *: *0'; then
				echo "  Found a Yamaha receiver."
				AMP_HOST=$ANS; break
			fi
			printf '  No Yamaha receiver answered there. Use it anyway? [y/N] '
			read -r YN || YN=
			case "$YN" in y|Y) AMP_HOST=$ANS; break;; esac
		done
	fi

	if [ -z "$PLEX_URL" ]; then
		CUR_PLEX=$(cur plexUrl)
		if [ -n "$CUR_PLEX" ]; then DEF=Y; HINT="Y/n"; else DEF=N; HINT="y/N"; fi
		printf 'Show Plex stream details (codec, bitrate, direct play)? [%s] ' "$HINT"
		read -r YN || YN=
		[ -n "$YN" ] || YN=$DEF
		case "$YN" in
			y|Y)
				printf 'Plex server URL [%s]: ' "${CUR_PLEX:-http://192.168.1.10:32400}"
				read -r PLEX_URL || PLEX_URL=
				[ -n "$PLEX_URL" ] || PLEX_URL=${CUR_PLEX:-}
				if [ -z "$PLEX_TOKEN" ]; then
					if [ "$(cur plexTokenSet)" = yes ] && [ "$PLEX_URL" = "$CUR_PLEX" ]; then printf 'Plex token (Enter to keep the saved one): '
					else printf 'Plex token (typing is hidden): '; fi
					stty -echo 2>/dev/null || true
					read -r PLEX_TOKEN || PLEX_TOKEN=
					stty echo 2>/dev/null || true
					echo
				fi
				if [ -z "$PLEX_PLAYER" ]; then
					printf 'Only use sessions from one player? Its IP address, or Enter for any [%s]: ' "$(cur plexPlayer)"
					read -r PLEX_PLAYER || PLEX_PLAYER=
				fi
				;;
		esac
	fi

	if [ -z "$AUTO_INFO" ]; then
		DEF_AUTO=$(cur autoInfo); [ -n "$DEF_AUTO" ] || DEF_AUTO=on
		printf 'Show the info bar by itself when the stream or amp info changes? (on/off) [%s]: ' "$DEF_AUTO"
		read -r AUTO_INFO || AUTO_INFO=
		[ -n "$AUTO_INFO" ] || AUTO_INFO=$DEF_AUTO
	fi

	if [ -z "$CORNER" ]; then
		DEF_CORNER=$(cur corner); [ -n "$DEF_CORNER" ] || DEF_CORNER=top-left
		printf 'Info bar position (top-left, top-right, bottom-left) [%s]: ' "$DEF_CORNER"
		read -r CORNER || CORNER=
		[ -n "$CORNER" ] || CORNER=$DEF_CORNER
	fi
fi

# values go to the TV on stdin so the token never appears on a command line
{
	[ -z "$AMP_HOST" ] || printf 'ampHost=%s\n' "$AMP_HOST"
	[ -z "$AMP_PORT" ] || printf 'ampPort=%s\n' "$AMP_PORT"
	[ -z "$PLEX_URL" ] || printf 'plexUrl=%s\n' "$PLEX_URL"
	[ -z "$PLEX_TOKEN" ] || printf 'plexToken=%s\n' "$PLEX_TOKEN"
	[ -z "$PLEX_PLAYER" ] || printf 'plexPlayer=%s\n' "$PLEX_PLAYER"
	[ -z "$AUTO_INFO" ] || printf 'autoInfo=%s\n' "$AUTO_INFO"
	[ -z "$CORNER" ] || printf 'corner=%s\n' "$CORNER"
} | ssh_tv "$CONFIGURE set"

if [ -z "$AMP_HOST" ] && [ -z "$(cur ampHost)" ]; then
	echo "NOTE: no receiver address is set yet. Open http://<tv>:41101/setup (or the AV Overlay Settings app) to enter it."
fi

echo "Enabling the bundled watcher..."
ssh_tv "set -e
APP_DIR='$APP_DIR'"'
if [ -f /var/lib/earc-volume-overlay/watcher.pid ]; then
	pid=$(cat /var/lib/earc-volume-overlay/watcher.pid 2>/dev/null || true)
	[ -z "$pid" ] || kill "$pid" 2>/dev/null || true
fi
rm -rf /var/lib/earc-volume-overlay
# stop a running watcher so it restarts with the new code and settings
if [ -f /tmp/earc-volume-overlay.pid ]; then
	pid=$(cat /tmp/earc-volume-overlay.pid 2>/dev/null || true)
	if [ -n "$pid" ] && tr "\000" " " < "/proc/$pid/cmdline" 2>/dev/null | grep -q watcher.js; then kill "$pid" 2>/dev/null || true; sleep 1; fi
fi
mkdir -p /var/lib/webosbrew/init.d
chmod 755 "$APP_DIR/runtime/91-earc-volume-overlay"
ln -sf "$APP_DIR/runtime/91-earc-volume-overlay" /var/lib/webosbrew/init.d/91-earc-volume-overlay
rm -f /tmp/earc-volume-overlay.pid /tmp/earc-volume-overlay.ipk
/var/lib/webosbrew/init.d/91-earc-volume-overlay'
echo "Installed and enabled. Log: /tmp/earc-volume-overlay.log"
echo "Settings: http://<tv>:41101/setup, or the AV Overlay Settings icon on the TV home screen."
