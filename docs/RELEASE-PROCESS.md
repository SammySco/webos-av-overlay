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
1. Work on a branch. Deploy it to a TV: `TV_HOST=root@<tv-ip> sh scripts/deploy.sh`. Use it for a few days against the
   checklist below, and an uninstall test if the change touches installation.
2. Open a pull request; wait for the checks (build, CodeQL, Docker build when relevant); merge to `main`.
3. Optional release candidate: tag `vX.Y.Z-rc.1` on `main`. It is a GitHub pre-release, so "latest" and the webosbrew
   manifest URL stay on the last stable release. Keep the app version numeric (`X.Y.Z`); only the tag carries `-rc.N`.
4. When satisfied, cut the stable tag.

### TV acceptance checklist
Run this on a real TV after deploying, before merging a change that touches the watcher, the apps or the HTTP
endpoints. Test the TV's **own** apps, not only the pages from a computer: they call `http://127.0.0.1`, which browsers
treat differently from a LAN address.
- [ ] **AV Overlay Settings** opens `/setup` and shows the right version at the bottom.
- [ ] The Quick Access key (a number key assigned to the app) pins the bar; pressing it again hides it.
- [ ] Pin state survives switching between Live TV, an app and an HDMI input; key forwarding (a channel number) works.
- [ ] Volume popup and the info bar appear; the status, setup and `/logs` pages load.
- [ ] A cross-origin read still works where the apps need it: `curl -i -H "Origin: null" http://TV_IP:41101/status.json`
      returns `Access-Control-Allow-Origin: *`.
- [ ] Docker changes: `docker compose up -d --build`, then **Show on TV** from the status page.
- [ ] The log has no unexpected errors (`/logs`).

The eARC Volume Overlay app's own Enable/Disable page showing `Denied method call "exec"` is expected and is not a
test failure.

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
6. Replace the auto-generated release notes with a short written summary (what's new, fixes, known issues), and make
   sure [CHANGELOG.md](CHANGELOG.md) has the entry for this version before you tag.

Tags are not moved or reused. A fix ships as the next patch version.

## Incidents
- **v2.4.1 shipped without a manifest.** The tag run published only the tarball and IPKs, so the "latest" manifest URL
  returned 404 and the webosbrew submission broke. Fixed by building the manifest from the released IPK and uploading it,
  then automating it (`scripts/make-manifest.sh`). Lesson: check the manifest URL after every tag.
- **v2.4.2's Docker image failed to build.** The Dockerfile copied `app/appinfo.json` but `.dockerignore` excluded the
  whole `app` folder. The packages and manifest were fine. Fixed by `app/*` plus `!app/appinfo.json` and by the
  build-only Docker check on pull requests; v2.4.3 is the first image with those changes. Lesson: Docker changes need a
  Docker build before tagging.

- **A cross-site guard written for 2.5.0 broke the TV's own apps.** It refused any mutating GET marked
  `Sec-Fetch-Site: cross-site`, assuming the TV's browser sends no such header. The apps call `http://127.0.0.1`, which
  browsers treat as trustworthy, so they do send it, and Quick Access fell back to the setup page. A tightened CORS list
  also hid `/status.json` from the settings app, which showed "service not running". Both were found only by
  testing on the TV, and the guard was removed before tagging. Lesson: use the TV acceptance checklist above, with the
  TV's own apps, before merging a change to headers, CORS or the HTTP endpoints.

## Environment notes
- Windows: the 260-character path limit breaks clones in deep folders. Clone to a short path with
  `git clone -c core.longpaths=true`.
- Windows: `npm run package` and `scripts/deploy.sh` run through Git's `sh`. If Node is installed under
  `C:\Program Files`, `npx` can fail with `C:/Program Files/nodejs/npx: No such file or directory`. Build with a
  wrapper `npx` script earlier on `PATH` (`exec node ".../npm/bin/npx-cli.js" "$@"`), or use WSL, then run
  `scripts/install.sh` directly with the built IPKs in `build/`.
- A new computer needs an SSH key the TV accepts (INSTALL.md section 4), and `gh` (`winget install --id GitHub.cli -e`,
  then `gh auth login`) to open pull requests and read checks from the command line.
- Claude Code cloud sessions cannot write repository settings, push tags or use GraphQL; do those from a local,
  authenticated machine (`gh` read calls work).
- Repository metadata (description, topics, Discussions) is applied with `sh scripts/github-metadata.sh`.
