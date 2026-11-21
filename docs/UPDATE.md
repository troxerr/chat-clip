# Auto-update (Sparkle 2)

The app embeds Sparkle 2.10.1 when `mac/vendor/Sparkle.framework` exists. A build with no `SUFeedURL`/`SUPublicEDKey` still launches; **Check for Updates…** explains that the feed is not configured.

## One-time setup

```sh
./tools/fetch-sparkle.sh
./mac/vendor/sparkle/bin/generate_keys
```

`fetch-sparkle.sh` verifies the pinned SHA-256 (it fails on a mismatch), installs the framework in `mac/vendor/Sparkle.framework` and Sparkle's `bin/` tools (`generate_keys`, `sign_update`) in `mac/vendor/sparkle/bin`.

`generate_keys` prints a public key and stores the private key in the login keychain. Put the public key in the release build as `SU_PUBLIC_ED_KEY`; never commit the private key. Export it for CI with:

```sh
./mac/vendor/sparkle/bin/generate_keys -x /secure/path/clipspike-sparkle-private-key
```

## Release build

`SU_FEED_URL` and `SU_PUBLIC_ED_KEY` are read by `mac/build.sh` (they become `SUFeedURL` and `SUPublicEDKey` in `Info.plist`); `mac/release.sh` only signs what was built.

```sh
SU_FEED_URL="https://clipspike.com/appcast.xml" \
SU_PUBLIC_ED_KEY="<public key>" \
npm run build:mac            # plus the licensing/OAuth variables from RELEASE.md
DEVELOPER_ID_APPLICATION="Developer ID Application: ..." \
NOTARY_PROFILE="clipspike-notary" \
./mac/release.sh --check     # before signing
DEVELOPER_ID_APPLICATION="Developer ID Application: ..." \
NOTARY_PROFILE="clipspike-notary" \
./mac/release.sh             # sign, notarize, staple
./mac/release.sh --verify    # after notarizing: ticket and Gatekeeper
```

This signs/notarizes the app and DMG. Sparkle's helper bundles (`Updater.app`, `Installer.xpc`, `Downloader.xpc`) and then the framework are signed inside-out.

## Appcast

After the notarized DMG is uploaded:

```sh
ARCH=arm64 \
VERSION=3.1.0 \
BUILD=5 \
DOWNLOAD_URL="https://clipspike.com/ClipSpike-3.1.0-arm64.dmg" \
DMG="mac/build/ClipSpike-3.1.0-arm64.dmg" \
OUTPUT=site/appcast.xml \
./tools/make-appcast.sh
```

`ARCH` (`arm64` or `x86_64`) is required. The script signs the DMG with Sparkle’s `sign_update` and writes a signed appcast item. Upload `appcast.xml` to the public `SU_FEED_URL`.

For CI, set `SPARKLE_KEY_FILE` to the exported private key instead of relying on the login keychain.

## Test the update path

1. Install the previous signed/notarized version from the DMG.
2. Publish the appcast and new DMG on HTTPS.
3. Launch the previous version and choose **Check for Updates…**.
4. Confirm Sparkle verifies the EdDSA signature, downloads, installs, relaunches, and preserves settings/license.
5. Test while a capture is running and while the app is offline.

Do not ship update code with a test key or a localhost feed.

## License gating and CI

Sparkle starts only after a license is on file and was validated in the last 14 days (`licenseStateChanged:` in `mac/main.m`); trial and free-plan users get no automatic checks. `SUEnableAutomaticChecks` is `false` in `mac/Info.plist` for that reason. The release workflow passes `EXISTING_APPCAST` to `tools/make-appcast.sh` so one `appcast.xml` carries both architectures (the arm64 item has `sparkle:hardwareRequirements`; Sparkle cannot restrict an item to Intel, so an arm64 Mac sees both items for a version and the arm64 item is always written before the Intel one). See [RELEASE.md](RELEASE.md).
