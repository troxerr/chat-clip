# Windows release

CI (`build.yml`) builds an **unsigned** installer for testing. Releases use
`.github/workflows/windows-release.yml` (manual run, or push a `win-v*` tag),
which builds with `win/electron-builder.release.yml`.

## What works without secrets
- Builds and uploads the installer and `latest.yml`, unsigned, with warnings.
- Runtime (FFmpeg/Streamlink) is verified by SHA-256 from `tools/runtime-win.json`.

## What you must supply
| Item | How |
|---|---|
| Code-signing certificate (.pfx, base64 or URL) + password | Repo secrets `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Signing then turns on and the signature is verified. |
| Update feed | Repo variable `WIN_UPDATE_URL` (public folder for the installer + `latest.yml`) and an upload step. **The app does not yet include an auto-updater** (`electron-updater` in `win/main`); that is still to do once the feed is chosen. |
| Licensing | `win/build-config.json` has `licenseRequired: false` and empty `productId`/`checkoutUrl`; fill them in to enable licensing. |
| Version, app ID, product name | Unchanged (`0.1.0`, `com.highlightdesk.app`); decide before the first public release. |

## Runtime pinning
Pinned FFmpeg is a dated BtbN autobuild tag, which upstream can delete. To keep
builds reproducible, copy the two pinned assets (see `tools/runtime-win.json`)
to any static host and set repo variable `RUNTIME_MIRROR_URL` to its base URL;
the fetch script falls back to it (SHA-256 still enforced).
