#!/bin/sh
# Writes release/com.sammysco.avoverlay.manifest.json (webosbrew manifest) for the built main IPK.
# Version comes from app/appinfo.json; run after `npm run package`.
set -eu
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./app/appinfo.json').version")
IPK="build/com.sammysco.avoverlay_${VERSION}_all.ipk"
[ -f "$IPK" ] || { echo "make-manifest: $IPK not found" >&2; exit 1; }
SHA=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "$IPK")
SIZE=$(wc -c < "$IPK" | tr -d ' ')
# A release candidate tag such as v2.4.4-rc.1 keeps the numeric app version, so the download URL must use the tag.
case "${GITHUB_REF_TYPE:-}" in tag) TAG="$GITHUB_REF_NAME" ;; *) TAG="v${VERSION}" ;; esac
mkdir -p release

cat > release/com.sammysco.avoverlay.manifest.json <<JSON
{
  "id": "com.sammysco.avoverlay",
  "version": "$VERSION",
  "type": "web",
  "title": "AV Overlay",
  "appDescription": "On-screen volume popup and info bar for a rooted LG webOS TV paired with a Yamaha receiver over eARC/ARC. Shows volume, sound program, audio format, video format, HDR, and optionally Plex or Jellyfin stream details. Includes per-app Yamaha sound program switching and a setup/status web page.",
  "iconUri": "https://raw.githubusercontent.com/SammySco/webos-av-overlay/main/app/largeIcon.png",
  "sourceUrl": "https://github.com/SammySco/webos-av-overlay",
  "rootRequired": true,
  "ipkUrl": "https://github.com/SammySco/webos-av-overlay/releases/download/${TAG}/com.sammysco.avoverlay_${VERSION}_all.ipk",
  "ipkHash": {
    "sha256": "$SHA"
  },
  "ipkSize": $SIZE
}
JSON
node -e "JSON.parse(require('fs').readFileSync('release/com.sammysco.avoverlay.manifest.json','utf8'))"
echo "Created release/com.sammysco.avoverlay.manifest.json"
