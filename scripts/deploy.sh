#!/bin/sh
# Deploy the overlay to a rooted LG TV in one step.
#
#   TV_HOST=root@TV_IP sh scripts/deploy.sh
#
# All EARC_* variables from install.sh are forwarded.
# TV_SSH_KEY: optional path to a private SSH key (uses the default key if omitted).
# EARC_NONINTERACTIVE is set automatically.
#
# The script clears the build cache (so fresh JS is always packaged), then runs
# install.sh, which builds the IPKs, installs them on the TV, and restarts the watcher.
set -eu
cd "$(dirname "$0")/.."
: "${TV_HOST:?Set TV_HOST, e.g. TV_HOST=root@192.168.1.50}"

echo "==> Cleaning build cache..."
rm -rf build

echo "==> Building and installing..."
EARC_NONINTERACTIVE=1 sh scripts/install.sh "$@"
