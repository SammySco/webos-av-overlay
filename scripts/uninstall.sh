#!/bin/sh
# Removes the overlay, the settings app and the boot hook from the TV.
# Your settings (/home/root/.earc-overlay.json, which may hold the Plex token) are kept unless you pass --purge.
set -eu
: "${TV_HOST:?Set TV_HOST, for example root@TV_IP_ADDRESS}"

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

ssh_tv() {
	if [ -n "${TV_SSH_KEY:-}" ]; then ssh -i "$TV_SSH_KEY" -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"
	else ssh -o StrictHostKeyChecking=accept-new "$TV_HOST" "$@"; fi
}

# The remote script is sent on stdin so its quoting is not mangled.
ssh_tv 'sh -s' <<'REMOTE'
for PIDFILE in /tmp/earc-volume-overlay.pid /var/lib/earc-volume-overlay/watcher.pid; do
	if [ -f "$PIDFILE" ]; then
		pid=$(cat "$PIDFILE" 2>/dev/null || true)
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			cmd=$(tr "\000" " " < "/proc/$pid/cmdline" 2>/dev/null || true)
			case "$cmd" in *watcher.js*) kill "$pid" 2>/dev/null || true;; esac
		fi
	fi
done
rm -f /tmp/earc-volume-overlay.pid /var/lib/webosbrew/init.d/91-earc-volume-overlay
rm -rf /var/lib/earc-volume-overlay
for ID in com.sammysco.avoverlay com.sammysco.avoverlay.settings; do
	# luna-send needs a pty on these TVs, hence script(1); otherwise the removal silently does nothing
	script -q -c "luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{\"id\":\"$ID\"}'" /dev/null >/dev/null 2>&1 || true
done
echo "AV overlay removed"
REMOTE

if [ "$PURGE" = 1 ]; then
	ssh_tv 'rm -f /home/root/.earc-overlay.json /home/root/.earc-plex.json'
	echo "Settings deleted"
else
	echo "Settings kept on the TV (use --purge to delete them)"
fi
