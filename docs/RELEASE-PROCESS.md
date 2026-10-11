# Release process

One repository, `main` always releasable. The workflows in `.github/workflows/` are the source of truth for what a
tag does; this page says how to use them.

## What a `v*` tag does
- **Build IPK** (`build.yml`): builds both IPKs, runs `npm run release` (tarball), generates the webosbrew manifest
  (`scripts/make-manifest.sh`) and publishes a GitHub release with the tarball, both IPKs and the manifest. A second
  job builds the Android status app and attaches `AV-Overlay-status.apk`. Tags containing a hyphen (for example
  `v2.4.4-rc.1`) are published as **pre-releases**.
- **Publish Docker image** (`docker.yml`): builds a multi-arch image (amd64, arm64, arm/v7) and pushes
  `ghcr.io/sammysco/webos-av-overlay` with `X.Y.Z`, `X.Y` and `latest` tags. Pre-release tags push only `X.Y.Z-rc.N`
  and never move `X.Y` or `latest`.
- The manifest step also runs on every pull request, and the Docker image is built (not pushed) on pull requests that
  touch the image inputs, so a broken generator, Dockerfile or `.dockerignore` fails the pull request instead of a tag.

## Testing before a public release
1. Work on a branch. Deploy it to a TV: `TV_HOST=root@<tv-ip> sh scripts/deploy.sh`. Use it for a few days against a
   short checklist: volume popup, info bar, sound programs, status and setup pages, and an uninstall test if the change
   touches installation.
2. Open a pull request; wait for the checks (build, CodeQL, Docker build when relevant); merge to `main`.
3. Optional release candidate: tag `vX.Y.Z-rc.1` on `main`. It is a GitHub pre-release, so "latest" and the webosbrew
   manifest URL stay on the last stable release. Keep the app version numeric (`X.Y.Z`); only the tag carries `-rc.N`.
4. When satisfied, cut the stable tag.

## Cutting a release
1. Bump the version in `app/appinfo.json`, `settings/appinfo.json`, `package.json`, `package-lock.json` (lines 3 and 9)
   and the examples in the issue forms. IPK and tarball names come from `app/appinfo.json`. Bump when releasing, not
   earlier, so a TV never reports a version that differs from the release.
2. Merge to `main` through a pull request with green checks.
3. From a local, authenticated clone on a short path:
   ```sh
   git fetch origin
   git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. Watch the Actions tab: "Build IPK" (both jobs) and "Publish Docker image".
5. Verify before announcing anything:
   - the release has the tarball, both IPKs, `com.sammysco.avoverlay.manifest.json` and `AV-Overlay-status.apk`;
   - `curl -sIL https://github.com/SammySco/webos-av-overlay/releases/latest/download/com.sammysco.avoverlay.manifest.json | head -1`
     ends in `200`;
   - the released IPK's sha256 and size match `ipkHash.sha256` and `ipkSize` in the manifest;
   - the GHCR tags exist (`X.Y.Z`, `X.Y`, `latest`).
6. Replace the auto-generated release notes with a short written summary (what's new, fixes, known issues).

Tags are not moved or reused. A fix ships as the next patch version.

## Incidents
- **v2.4.1 shipped without a manifest.** The tag run published only the tarball and IPKs, so the "latest" manifest URL
  returned 404 and the webosbrew submission broke. Fixed by building the manifest from the released IPK and uploading it,
  then automating it (`scripts/make-manifest.sh`). Lesson: check the manifest URL after every tag.
- **v2.4.2's Docker image failed to build.** The Dockerfile copied `app/appinfo.json` but `.dockerignore` excluded the
  whole `app` folder. The packages and manifest were fine. Fixed by `app/*` plus `!app/appinfo.json` and by the
  build-only Docker check on pull requests; v2.4.3 is the first image with those changes. Lesson: Docker changes need a
  Docker build before tagging.

## Environment notes
- Windows: the 260-character path limit breaks clones in deep folders. Clone to a short path with
  `git clone -c core.longpaths=true`.
- Claude Code cloud sessions cannot write repository settings, push tags or use GraphQL; do those from a local,
  authenticated machine (`gh` read calls work).
- Repository metadata (description, topics, Discussions) is applied with `sh scripts/github-metadata.sh`.
