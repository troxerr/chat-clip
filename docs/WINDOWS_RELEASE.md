# Windows release

CI (`build.yml`) builds an **unsigned** installer for testing (no update feed,
updater off). Releases use `.github/workflows/windows-release.yml` (manual run,
or push a `win-v*` tag), which builds with `win/electron-builder.release.yml`.

## What the release workflow enforces
- `WIN_UPDATE_URL` must be set (https). It is baked into the app as a generic
  electron-updater feed (`resources/app-update.yml`); the build also writes `latest.yml`.
- `node win/tools/check-release-config.js` fails unless `win/build-config.json` has
  `licenseRequired: true`, a `productId`, an https `checkoutUrl` and `trialDays > 0`.
  The committed file keeps licensing off for dev builds, so set these before releasing.
- If `WIN_CSC_LINK` is set the installer is signed and the signature verified; if not,
  a warning is shown and the installer is unsigned.
- `latest.yml` and the app feed config must exist. Tag builds attach installer + `latest.yml`
  to a draft GitHub release.

## Auto-update
`win/main/updater.js` uses `electron-updater`. It checks at startup and installs on quit,
only for a packaged app whose `app-update.yml` exists (so dev, smoke and the CI installer never update).
Set `HIGHLIGHT_DESK_NO_UPDATE=1` to disable. **You must host** the installer and `latest.yml`
at `WIN_UPDATE_URL` (copy them from the draft release or the workflow artifact); the workflow
does not upload to your host. Unsigned builds update only if you do not set a publisher name.

## You must supply
| Item | How |
|---|---|
| Code-signing cert (.pfx) + password | Secrets `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| Update feed host | Variable `WIN_UPDATE_URL`, and a way to upload installer + `latest.yml` there |
| Licensing | `productId`, `checkoutUrl`, `licenseRequired: true` in `win/build-config.json` (matching the Polar/Lemon Squeezy setup in `tools/license.js`) |
| Optional runtime mirror | Variable `RUNTIME_MIRROR_URL` hosting the pinned assets from `tools/runtime-win.json` |
| Decisions deferred | Version, app ID, product name |

## Unverified
Never run on Windows: the release workflow, signing, the updater against a real feed,
and the packaged install of `electron-updater`.
