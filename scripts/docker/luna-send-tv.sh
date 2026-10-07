#!/bin/sh
# Proxy luna-send calls to the TV via SSH.
#
# Called by watcher.js (EARC_LUNA_SEND=/app/scripts/docker/luna-send-tv.sh).
# The SSH config written by entrypoint.sh enables ControlMaster so repeated
# calls (the watcher polls every 2 s) reuse one multiplexed connection.
#
# -tt forces PTY allocation on the TV even when our own stdin is not a TTY.
# luna-send needs a PTY for -i (subscribe) and -f (follow) modes; the watcher
# wraps those calls with /usr/bin/script which provides a local PTY, but we
# still need a PTY on the remote (TV) side.
exec ssh -tt "${EARC_TV_HOST}" /usr/bin/luna-send "$@"
