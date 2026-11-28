# Windows release

CI (`build.yml`) builds an **unsigned** installer for testing (no update feed,
updater off). Releases use `.github/workflows/windows-release.yml` (manual run,
or push a `win-v*` tag), which builds with `win/electron-builder.release.yml`.

## Names and versions
Everything Windows is **ClipSpike**: `productName` and `appId` (`com.clipspike.app`) in
`win/electron-builder.yml`, the install folder, `%APPDATA%\ClipSpike`, and the artifacts. The
Windows app version is `win/package.json` `version`, currently **0.1.7** (the root `package.json`
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

The Windows release workflow uses Azure Artifact Signing. The Public Trust profile is
`ClipSpike` in the `ClipSpikeSigning` account in East US.

1. Create a Microsoft Entra app and service principal with the **Artifact Signing Certificate Profile Signer**
   role on the certificate profile. Set up a federated credential with issuer
   `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject
   `repo:troxerr/chat-clip:environment:windows-signing`.
2. In the GitHub `windows-signing` environment, allow the `main` branch and `win-v*` tags.
   Set the environment variables `AZURE_SIGNING_CLIENT_ID` and `AZURE_SIGNING_TENANT_ID`.
3. Run **Windows release** manually on `main` to validate signing before pushing a tag.
   The job uses GitHub OIDC to sign in to Azure and checks both installers with `Get-AuthenticodeSignature`.

Signed installers may still show a SmartScreen warning while reputation builds.
[Microsoft signing setup](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)

## What the release workflow enforces
- `WIN_UPDATE_URL` must be set (https). It is baked into the app as a generic
  electron-updater feed (`resources/app-update.yml`); the build also writes `latest.yml`.
- `node win/tools/check-release-config.js` fails unless `win/build-config.json` has
  `licenseRequired: true`, a `productId`, an https `checkoutUrl` and `trialDays > 0`.
  The committed file keeps licensing off for dev builds, so set these before releasing.
  Sandbox Polar values (`apiBase` or `checkoutUrl` containing `sandbox`) only warn until the repo variable
  `REQUIRE_PRODUCTION_LICENSING` is set to `true`; then they fail the build and `apiBase` must be
  `https://api.polar.sh`. Set it when the production Polar product and checkout link are in `build-config.json`.
- Setup and Portable must both pass Authenticode signature verification before the workflows publish files.
- `latest.yml` and the app feed config must exist. Tag builds attach installer + `latest.yml`
  to a draft GitHub release.
- Tag builds also run `win/tools/release-guards.js` (unit-tested in `win/test/release-guards.test.js`):
  1. **Tag matches version**: the tag must be exactly `win-v` + the `win/package.json` version, checked
     before the build. Bump the version in its own PR first. For a test build use "Run workflow"
     (workflow_dispatch), not a tag; a tag such as `win-v0.1.3-test` is refused.
  2. **Releases are immutable**: the upload is refused if `ClipSpike-<version>-x64.exe` is already on the
     feed, because replacing it would change the sha512 clients may have cached. Re-releasing means a new version.
  3. **Feed verified after upload**: the live `latest.yml` must match the build (version, file, sha512, size),
     and the installer a client would download is fetched and its size and sha512 checked. If the
     build produced `<installer>.blockmap`, the feed must serve exactly that file too.
- **Differential updates.** electron-updater downloads only the changed blocks when the feed has the *previous*
  version's `.blockmap`, so every release publishes its blockmap (installer, then blockmap, then `latest.yml`)
  and old installers and blockmaps stay on the feed. A release whose build makes no blockmap warns instead of
  failing, and clients fall back to the full installer.

## Licensing provider (Polar production)
The Windows app picks its provider from `win/build-config.json`: `provider` (`polar`) and
`apiBase` are passed to every activate/validate/deactivate call (`LICENSE_PROVIDER` and
`LEMON_API_BASE` only affect the `tools/license.js` CLI, not the app). Without them the app
uses Lemon Squeezy. The committed config targets **Polar production**
(`https://api.polar.sh`), with `productId` as `ORG_ID:BENEFIT_ID` and `checkoutUrl` set to the
production checkout link. These are identifiers, not secrets.

Keys bought in the Polar **sandbox** do not activate against production, and production keys do not
work against the sandbox. To test against the sandbox again, point `apiBase`, `productId` and
`checkoutUrl` at sandbox values in a scratch build (the release guard warns about sandbox values, and
fails them when the repo variable `REQUIRE_PRODUCTION_LICENSING` is `true`).

## Publishing a release

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
| Azure signing identity | Required. Configure OIDC and the `windows-signing` environment as documented above. |
| Optional runtime mirror | Variable `RUNTIME_MIRROR_URL` hosting the pinned assets from `tools/runtime-win.json` |
| Decisions deferred | Version, app ID, product name |

## Verification status
Verified end to end on a clean Windows 11 ARM VM (2026-11-22), against the live feed at
`https://downloads.astlabs.dev/win/`:
- Release workflow on tag builds, the R2 upload (installer then `latest.yml`) and the unsigned installer.
- The packaged install of `electron-updater`: 0.1.0 found, downloaded (sha512 and size matched
  `latest.yml`) and installed 0.1.1, then 0.1.1 to 0.1.2, on quit. The trial state survived.
- Settings > Updates ("Check for updates", then "Restart to update"): quits, runs the installer silently and
  reopens the new version. This was tested with the 0.1.2 files over the installed 0.1.1; the first release
  built with the card is 0.1.2, so the button from a published build still needs a release newer than 0.1.2.

Not yet verified: code signing and the signature check, updating while a license is activated (only the
trial was tested), and the new release guards on a real tag build (they pass against the live 0.1.2 feed).

### Repeating the update test in a VM
1. Revert the VM to the snapshot of the previously released version and start it (VMware Fusion:
   `vmrun revertToSnapshot`, then `start`).
2. Launch the app and wait for the installer to appear in `%LOCALAPPDATA%\clipspike-updater\pending`.
   Compare its sha512 with `latest.yml`.
3. Press "Restart to update" in Settings (older versions with no button: quit the app).
4. Confirm the exe file version, the Windows uninstall entry version, and that the app reopened.
Delete `pending` first so the test really downloads. Take a new snapshot of each released version.
