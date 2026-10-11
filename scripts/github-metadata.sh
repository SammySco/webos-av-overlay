#!/bin/sh
# Applies the discoverability settings (description, topics, Discussions) with the GitHub CLI.
# Needs `gh` authenticated as the repo owner (gh auth login), and is safe to re-run.
#
#   sh scripts/github-metadata.sh            # apply settings
#   RENAME_TO=webos-yamaha-overlay sh scripts/github-metadata.sh   # also rename the repo (old URLs redirect)
set -eu

REPO="${REPO:-SammySco/webos-av-overlay}"

DESCRIPTION="On-screen volume, audio/video format info bar and per-app sound programs for rooted LG webOS TVs (eARC) with Yamaha MusicCast/RX-V receivers. Plex, Jellyfin and Home Assistant integration."

gh repo edit "$REPO" \
  --description "$DESCRIPTION" \
  --homepage "https://github.com/$REPO#readme" \
  --enable-discussions \
  --enable-issues

# GitHub allows at most 20 topics. 'homebrew' is dropped: it mostly attracts the macOS package manager.
# 'nodejs' is swapped for 'webos-homebrew', which has a more relevant audience.
gh repo edit "$REPO" --remove-topic homebrew || true
gh repo edit "$REPO" --remove-topic nodejs || true
for t in webosbrew earc yamaha-receiver yamaha-extended-control plex jellyfin apple-tv dolby-vision hdr docker webos-homebrew; do
  gh repo edit "$REPO" --add-topic "$t"
done

if [ -n "${RENAME_TO:-}" ]; then
  gh repo rename "$RENAME_TO" --repo "$REPO" --yes
  echo "Renamed to $RENAME_TO. Update your local remote: git remote set-url origin https://github.com/${REPO%%/*}/$RENAME_TO"
fi

echo "Done. Still manual: social preview image (Settings > General), pin the repo on your profile."
