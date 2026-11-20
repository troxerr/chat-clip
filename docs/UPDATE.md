# Auto-update (Sparkle 2)

The app embeds Sparkle 2.10.1 when `mac/vendor/Sparkle.framework` exists. A build with no `SUFeedURL`/`SUPublicEDKey` still launches; **Check for Updates…** explains that the feed is not configured.

## One-time setup

```sh
./tools/fetch-sparkle.sh
./mac/vendor/sparkle/bin/generate_keys
```

`generate_keys` prints a public key and stores the private key in the login keychain. Put the public key in the release build as `SU_PUBLIC_ED_KEY`; never commit the private key. Export it for CI with:

```sh
./mac/vendor/sparkle/bin/generate_keys -x /secure/path/highlightdesk-sparkle-private-key
```

## Release build

```sh
SU_FEED_URL="https://your-domain.example/appcast.xml" \
SU_PUBLIC_ED_KEY="<public key>" \
DEVELOPER_ID_APPLICATION="Developer ID Application: ..." \
NOTARY_PROFILE="highlightdesk-notary" \
./mac/release.sh
```

This signs/notarizes the app and DMG, and signs Sparkle’s nested framework binaries.

## Appcast

After the notarized DMG is uploaded:

```sh
VERSION=3.1.0 \
BUILD=5 \
DOWNLOAD_URL="https://your-domain.example/Chatclip-3.1.0-arm64.dmg" \
DMG="mac/build/Chatclip-arm64.dmg" \
OUTPUT=site/appcast.xml \
./tools/make-appcast.sh
```

The script signs the DMG with Sparkle’s `sign_update` and writes a signed appcast item. Upload `appcast.xml` to the public `SU_FEED_URL`.

For CI, set `SPARKLE_KEY_FILE` to the exported private key instead of relying on the login keychain.

## Test the update path

1. Install the previous signed/notarized version from the DMG.
2. Publish the appcast and new DMG on HTTPS.
3. Launch the previous version and choose **Check for Updates…**.
4. Confirm Sparkle verifies the EdDSA signature, downloads, installs, relaunches, and preserves settings/license.
5. Test while a capture is running and while the app is offline.

Do not ship update code with a test key or a localhost feed.

## License gating and CI

Sparkle starts only after a license is on file and was validated in the last 14 days (`licenseStateChanged:` in `mac/main.m`); trial and free-plan users get no automatic checks. `SUEnableAutomaticChecks` is `false` in `mac/Info.plist` for that reason. The release workflow passes `EXISTING_APPCAST` to `tools/make-appcast.sh` so one `appcast.xml` carries both architectures (the arm64 item has `sparkle:hardwareRequirements`). See [RELEASE.md](RELEASE.md).
