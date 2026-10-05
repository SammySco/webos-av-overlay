#!/bin/sh
# Builds a self-contained release archive in dist/: both IPKs, the installer and everything it needs.
# The archive can be unpacked on any computer with ssh/scp and a POSIX shell; Node is only needed to rebuild.
set -eu

cd "$(dirname "$0")/.."
npm run package

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' app/appinfo.json | head -n 1)
NAME="av-overlay-v$VERSION"
STAGE="dist/$NAME"
ARCHIVE="dist/$NAME.tar.gz"

rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE/build" "$STAGE/scripts"
cp build/com.sammysco.avoverlay_${VERSION}_all.ipk build/com.sammysco.avoverlay.settings_${VERSION}_all.ipk "$STAGE/build/"
cp scripts/install.sh scripts/install.ps1 scripts/uninstall.sh "$STAGE/scripts/"
cp Install-AVOverlay.cmd "$STAGE/"
cp README.md LICENSE "$STAGE/"
# install.sh packages from source only when the IPKs are missing, so a release needs just the IPKs and scripts
(cd "$STAGE" && find . -type f | sort | sed 's|^\./||' > FILES.txt)

tar -czf "$ARCHIVE" -C dist "$NAME"
echo "Created $ARCHIVE"
