# Windows release

CI (`build.yml`) builds an **unsigned** installer for testing (no update feed,
updater off). Releases use `.github/workflows/windows-release.yml` (manual run,
or push a `win-v*` tag), which builds with `win/electron-builder.release.yml`.

## Names and versions
Everything Windows is **ClipSpike**: `productName` and `appId` (`com.clipspike.app`) in
`win/electron-builder.yml`, the install folder, `%APPDATA%\ClipSpike`, and the artifacts. The
Windows app version is `win/package.json` `version`, currently **0.1.1** (the root `package.json`
3.0.0 is the Mac/engine version; the two are independent). Bump `win/package.json` before tagging.
The pre-rename names "ChatClip" and "Highlight Desk" (and `Twitch-Highlight-Desk`) appear only in
migration code and docs; a package still carrying them predates the rename.

| Build | CI (`build.yml`, unsigned) | Release (`windows-release.yml`) |
|---|---|---|
| Installer (NSIS, per-user) | `ClipSpike-<version>-x64-unsigned.exe` | `ClipSpike-<version>-x64.exe` |
| Portable (single exe, no install, no admin) | `ClipSpike-<version>-x64-portable-unsigned.exe` | `ClipSpike-<version>-x64-portable.exe` |

The Portable exe never self-updates (the updater is off when `PORTABLE_EXECUTABLE_FILE` is set)
and is not in `latest.yml`; users replace the file to upgrade. Like the installer it keeps its
data in `%APPDATA%\ClipSpike`, not next to the exe. CI launches it from a temp folder, makes a
clip from the simulated chat spike, and fails if it writes anything beside the exe or its data
folder is not where expected.

## Setting up code signing
1. Get an Authenticode code-signing certificate (OV or EV) exported as a password-protected
   `.pfx`. EV certificates usually live on a hardware token or cloud HSM and cannot be exported;
   they need a different signing step (e.g. Azure Trusted Signing) that this workflow does not implement.
2. Base64-encode the file in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard`.
3. In `troxerr/chat-clip` (Settings, Secrets and variables, Actions) add the secrets
   `WIN_CSC_LINK` (the base64 text, or an https URL to the `.pfx`) and `WIN_CSC_KEY_PASSWORD`.
   The workflow maps them to electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD`. Both must be
   set; if either is missing the build is unsigned.
4. Run the workflow. It signs the installer and the Portable exe, then fails unless every
   `ClipSpike-*-x64*.exe` reports `Valid` from `Get-AuthenticodeSignature`. Never commit the
   certificate or password.

**SmartScreen:** even a signed build can show "Windows protected your PC" until it has
reputation. An OV certificate builds reputation over downloads and time; EV generally avoids
the warning immediately. Unsigned builds always warn ("Unknown publisher", then More info, Run
anyway), and the Portable exe is the most likely to be flagged (a freshly downloaded,
self-extracting exe). Manual verification: [WINDOWS_TEST_CHECKLIST.md](WINDOWS_TEST_CHECKLIST.md).

## What the release workflow enforces
- `WIN_UPDATE_URL` must be set (https). It is baked into the app as a generic
  electron-updater feed (`resources/app-update.yml`); the build also writes `latest.yml`.
- `node win/tools/check-release-config.js` fails unless `win/build-config.json` has
  `licenseRequired: true`, a `productId`, an https `checkoutUrl` and `trialDays > 0`.
  The committed file keeps licensing off for dev builds, so set these before releasing.
- Code signing is **optional**. With both `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` set the
  installer is signed and the signature verified. Otherwise the workflow logs a warning, writes
  an "Unsigned build" note to the run summary, builds an unsigned installer, and the draft
  release notes say it is unsigned. A missing cert never fails the run.
- `latest.yml` and the app feed config must exist. Tag builds attach installer + `latest.yml`
  to a draft GitHub release.

## Licensing provider (Polar sandbox)
The Windows app picks its provider from `win/build-config.json`: `provider` (`polar`) and
`apiBase` are passed to every activate/validate/deactivate call (`LICENSE_PROVIDER` and
`LEMON_API_BASE` only affect the `tools/license.js` CLI, not the app). Without them the app
uses Lemon Squeezy. The committed config targets the **Polar sandbox**
(`https://sandbox-api.polar.sh`), with `productId` as `ORG_ID:BENEFIT_ID`. These are
identifiers, not secrets.

**Production needs a new Polar product, license-key benefit, checkout link and organization
values**: replace `productId` and `checkoutUrl`, and set `apiBase` to `https://api.polar.sh`
(or remove it) before a public release. Sandbox keys do not work against production.

## Unsigned-first path
Without a certificate, Windows SmartScreen shows "Windows protected your PC" (More info, then
Run anyway) until the installer builds reputation. Tell early users this. Add a certificate
later by only setting the two secrets; nothing else changes. Updates still work unsigned
(electron-updater verifies the sha512 in `latest.yml`, not a publisher signature).

1. Set `WIN_UPDATE_URL` (below) and the licensing values in `win/build-config.json`.
2. Push a `win-v*` tag (or run the workflow manually for a test build).
3. Test the installer from the draft release, then publish the release.

## Hosting the update feed
Recommended: **Cloudflare R2**, since the bucket exists (used by the Mac release in
`troxerr/chatclip-release`). GitHub Releases is a poor feed: draft/versioned release URLs
are not a stable folder, and this repo also holds non-Windows tags.

Tag builds upload the installer, then `latest.yml`, to `<bucket>/<WIN_R2_PREFIX>/` (default `win/`)
when these are set in `troxerr/chat-clip`:
- secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (the same values as in `troxerr/chatclip-release`; secrets are per repo, so copy them);
- variable `WIN_UPDATE_URL` = `<R2_PUBLIC_BASE_URL>/win/` (with the trailing slash). The Mac
  value is a variable in `chatclip-release`; its current value is `https://downloads.astlabs.dev`,
  so `https://downloads.astlabs.dev/win/`;
- optional variable `WIN_R2_PREFIX` if you use a folder other than `win`.

If the R2 secrets are absent the upload step is skipped with a notice and you host the two
files yourself. The upload uses the AWS CLI against R2's S3 endpoint.

## Auto-update
`win/main/updater.js` uses `electron-updater`. It checks at startup and installs on quit,
only for a packaged app whose `app-update.yml` exists (so dev, smoke and the CI installer never update).
Set `CLIPSPIKE_NO_UPDATE=1` to disable. **You must host** the installer and `latest.yml`
at `WIN_UPDATE_URL` (the workflow uploads to R2 for tag builds when configured, see above;
otherwise copy them from the draft release or the workflow artifact). Unsigned builds update only if you do not set a publisher name.

## You must supply
| Item | How |
|---|---|
| `WIN_UPDATE_URL` (variable) | Required. Public https folder for the installer and `latest.yml`, e.g. `https://downloads.astlabs.dev/win/` |
| Licensing | Required. `productId`, `checkoutUrl`, `licenseRequired: true` in `win/build-config.json` (matching the Polar/Lemon Squeezy setup in `tools/license.js`) |
| R2 upload credentials | Recommended. Secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in this repo; otherwise upload by hand |
| Code-signing cert (.pfx) + password | Optional. Secrets `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`; unset gives an unsigned installer |
| Optional runtime mirror | Variable `RUNTIME_MIRROR_URL` hosting the pinned assets from `tools/runtime-win.json` |
| Decisions deferred | Version, app ID, product name |

## Unverified
Never run on Windows: the release workflow, signing, the updater against a real feed,
and the packaged install of `electron-updater`, the R2 upload step (AWS CLI on the runner, R2 credentials), and unsigned-installer behaviour on a clean Windows machine.
