# Release guide

This is the production release path. The current app can be built ad-hoc for development, but a sellable build needs the items below.

## Accounts and credentials

1. **Apple Developer Program** — enroll, create a **Developer ID Application** certificate, install it in the login keychain. Store notary credentials:
   ```sh
   xcrun notarytool store-credentials highlightdesk-notary \
     --apple-id you@example.com --team-id TEAMID --password APP_SPECIFIC_PASSWORD
   ```
2. **Dropbox app** — create a vendor-owned app with App Folder access, scopes `files.content.write`, `files.metadata.write`, `account_info.read`, and redirect URI `http://127.0.0.1:53682/callback`. Apply for production access.
3. **Google Cloud OAuth** — create a Desktop OAuth client, enable Google Drive API, add `http://127.0.0.1:53683/oauth2callback`, scopes `drive.file`, `openid`, `email`; publish/verify the consent screen. Testing-mode refresh tokens expire after 7 days.
4. **Lemon Squeezy** — create the product, trial/refund policy, and license keys. Put the product ID and license API details in the app configuration.
5. **Domain/hosting** — website, download, appcast, support email.
6. **Legal** — EULA, privacy policy, terms, refund policy, copyright/streamer-consent language, third-party notices.

## Runtime

The app must not depend on Homebrew or a system Python at release time.

```sh
./tools/build-runtime.sh
# or, if you already have portable binaries:
FFMPEG_BIN=/path/to/lgpl-ffmpeg \
STREAMLINK_BIN=/path/to/self-contained-streamlink \
./tools/prepare-runtime.sh
```

`tools/build-runtime.sh` downloads FFmpeg 7.1.1, builds it LGPL/static with VideoToolbox and AudioToolbox, builds Streamlink with PyInstaller, and installs both under `mac/runtime/<arch>`.

- Build the app with vendor OAuth clients so **Connect** works:
  ```sh
  DROPBOX_APP_KEY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  LICENSE_REQUIRED=1 TRIAL_DAYS=7 LEMON_PRODUCT_ID=... \
  CHECKOUT_URL=... npm run build:mac
  ```
- Use an **LGPL FFmpeg** build with VideoToolbox; do not bundle libx264 in the proprietary app.
- Use a self-contained Streamlink binary (PyInstaller onefile or equivalent).
- `tools/prepare-runtime.sh` rejects Homebrew/Python-linked binaries.
- Build separate runtimes/DMGs on matching arm64 and x86_64 machines.
- Include third-party notices and the LGPL source offer.

## Build, sign, notarize

```sh
npm ci
npm test
# build with the vendor configuration from the Runtime section (licensing, OAuth, SU_FEED_URL, SU_PUBLIC_ED_KEY)
npm run build:mac
DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="highlightdesk-notary" \
./mac/release.sh --check    # before signing; must pass
DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE="highlightdesk-notary" \
./mac/release.sh            # sign, notarize, staple
./mac/release.sh --verify   # after notarizing; must pass
```

`--check` runs before anything is signed. It verifies the signing identity, notary credentials, bundled runtime, Sparkle, a public HTTPS `SUFeedURL`, `SUPublicEDKey`, license enforcement, product ID, checkout URL, and the Dropbox and Google OAuth client ID and secret in the built `Info.plist`. Any missing value fails it, so run it in every release pipeline, including CI. `--verify [DMG]` runs after notarization: it checks the stapled ticket and that Gatekeeper accepts the DMG and the app inside it. Unsigned CI artifacts are built by [docs/CI.md](CI.md).

`mac/release.sh` signs nested Node/FFmpeg/Streamlink binaries, then Sparkle's helper bundles (`Updater.app`, XPC services) and the framework inside-out, signs the app with hardened runtime and `mac/Chatclip.entitlements`, builds a DMG, submits it to `notarytool`, staples it, and verifies Gatekeeper.

Before release, confirm:

- `codesign --verify --deep --strict` passes.
- `spctl -a -t open --context context:primary-signature` accepts the DMG.
- The app launches on a clean macOS 13.5/14/15 machine with no Homebrew.
- The app launches after copying it from the DMG, not just from the build directory.

## Updates

- Sparkle 2.10.1 is integrated conditionally; see [docs/UPDATE.md](UPDATE.md).
- Set `SU_FEED_URL` and `SU_PUBLIC_ED_KEY` when running `npm run build:mac` (they become `SUFeedURL` and `SUPublicEDKey`).
- Sign each release DMG/appcast item with Sparkle’s `sign_update` (`ARCH=arm64|x86_64 ./tools/make-appcast.sh`, which fetch-sparkle.sh makes available).
- Host the appcast and DMG on the product domain over HTTPS.
- Test update from the previous version, including while a capture is running.

## Website

A release is not complete without:

- Landing page, screenshots/demo, system requirements, pricing, checkout, FAQ, changelog.
- Privacy policy and terms links from the app.
- Support email and diagnostics instructions.
- Download links for the correct architecture.

## Current blockers

- The signed release path has not been exercised end to end: no tag has been cut and the release workflow has not run. Do a dry run with a throwaway tag on both architectures first.
- The signing changes for Sparkle's helper bundles are untested against Apple's notary service; confirm notarization accepts a build and that an update installs.
- Vendor OAuth client IDs/secrets, production app review, the Lemon Squeezy product/checkout and the Sparkle feed must be configured; `--check` fails until they are.
- Release builds are produced for arm64 and x86_64 by the release workflow; each architecture's runtime and DMG still needs a real launch test on matching hardware.
- Legal docs and pilot evidence are not present.
- The Windows release workflow (`windows-release.yml`, see [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md)) activates signing and update-feed hooks only when secrets are set; Windows has no licensing configuration and is not part of this release path.

Do not sell until these are resolved and the pilot gate in the commercial plan passes.

## Automated release (GitHub Actions → Cloudflare R2)

The release workflow lives in the separate public repo [troxerr/chatclip-release](https://github.com/troxerr/chatclip-release), which holds no source and exists only to get free macOS minutes. Tag the release here (`git tag v3.1.0 && git push origin v3.1.0`), then run **Actions → release → Run workflow** there with `ref = v3.1.0`. It checks out this public repo (no deploy key needed) and runs on arm64 and x86_64 runners (one at a time). It tests, imports the Developer ID certificate into a temporary keychain, builds with licensing enabled, signs with Hardened Runtime, notarizes with an App Store Connect API key, staples, uploads the DMG to R2, and merges a signed item into `appcast.xml`. It never creates a GitHub Release or workflow artifact (both are public in a public repo). The ref must equal `CFBundleShortVersionString` in `mac/Info.plist`; bump `CFBundleVersion` for every release.

The release workflow must run `./mac/release.sh --check` after building and before signing, and `./mac/release.sh --verify` after notarizing, so a build missing any required value or a rejected DMG cannot be uploaded. It must pass `ARCH` to `tools/make-appcast.sh`.

**Secrets (set in chatclip-release, not here); all of these are required for a sellable build:** `MACOS_CERT_P12` (base64 .p12), `MACOS_CERT_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `SPARKLE_PRIVATE_KEY` (contents of `generate_keys -x`), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `GOOGLE_CLIENT_SECRET`.
**Variables:** `R2_PUBLIC_BASE_URL` (custom domain of the bucket, no trailing slash), `SU_PUBLIC_ED_KEY`, `LEMON_PRODUCT_ID`, `CHECKOUT_URL`, `TRIAL_DAYS`, `DROPBOX_APP_KEY`, `GOOGLE_CLIENT_ID`.

R2 setup: create a bucket, attach a custom domain, and create an R2 API token scoped to that bucket. The app reads `${R2_PUBLIC_BASE_URL}/appcast.xml`, so objects must be readable over HTTPS without credentials: anyone with the DMG link can download it, and the license key is what protects the product. There is no `ExportOptions.plist` because the app is not built with `xcodebuild`; `mac/release.sh` does the Developer ID signing.

## Licensing

Chatclip activates against Lemon Squeezy with the Mac's hardware UUID in `instance_name`. The key, instance ID and last-validated time are stored in the login Keychain (service `com.highlightdesk.app.license`). A license stays valid offline for 14 days after the last successful validation; a refunded, revoked or deleted key clears the Keychain on the next check and returns the app to the free plan.
