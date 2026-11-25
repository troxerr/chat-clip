# Launch checklist

The remaining launch steps need your own accounts and machines. Work through them in order; each section says what to run, what to expect, and how to tell it worked. Background lives in [RELEASE.md](RELEASE.md), [UPDATE.md](UPDATE.md), [KICK.md](KICK.md), [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md) and [CI.md](CI.md). Run commands from the repo root unless noted.

Order matters: 1–3 need nothing from the release pipeline; 4–7 produce the keys, profiles and hosting the pipeline needs; 8 exercises everything.

- [ ] 1. Mac migration from ChatClip or Highlight Desk
- [ ] 2. Live Kick test
- [ ] 3. Polar sandbox pass
- [ ] 4. Sparkle key and appcast
- [ ] 5. Notary profile
- [ ] 6. Windows inputs
- [ ] 7. External renames
- [ ] 8. Dry runs and clean-machine tests

---

## 1. Test the Mac migration from an old ChatClip or Highlight Desk install

Use a Mac (or a macOS user account) that has run a Highlight Desk build (`com.highlightdesk.app`) or a ChatClip build (`com.chatclip.app`) and has not run ClipSpike. Repeat the steps for each, and once with both present (ChatClip data wins on conflicts). If you no longer have one, build the old version from git history before the rename (`git show 3b63108:mac/build.sh` is the last pre-rename commit; check it out in a separate worktree) and launch it once so it creates config, a Keychain entry and a license.

### Set up

Confirm the old data exists:

```sh
ls -la ~/.chatclip.json ~/.highlight-desk.json "$HOME/Library/Application Support/ChatClip" "$HOME/Library/Application Support/Highlight Desk" ~/Movies/ChatClip ~/Movies/"Highlight Desk"
security find-generic-password -s com.chatclip.app.credentials   # or com.highlightdesk.app.credentials
security find-generic-password -s com.chatclip.app.license
defaults read com.chatclip.app                                    # or com.highlightdesk.app
```

Make sure no `~/.clipspike.json`, `~/Library/Application Support/ClipSpike` or `~/Movies/ClipSpike` exists yet, and that the migration flag is unset:

```sh
defaults delete com.clipspike.app HDLegacyMigrationV1 2>/dev/null; echo ok
```

Quit the old app. Build and launch ClipSpike (`npm run build:mac`, then open `mac/build/ClipSpike.app`), or use the notarized DMG from step 8.

### Expect

- **One Keychain prompt, once.** macOS asks whether `ClipSpike` may use the `com.chatclip.app.*` / `com.highlightdesk.app.*` credential and license items (the old app owned them). Enter your login password and choose **Always Allow**. You should not see it again on later launches. Denying it leaves the migration incomplete; it is retried on the next launch.
- `~/.chatclip.json` (else `~/.highlight-desk.json`) is copied to `~/.clipspike.json` (the old file stays).
- `~/Library/Application Support/ChatClip` and `…/Highlight Desk` are moved to (merged into) `…/ClipSpike`.
- Keychain items are copied to `com.clipspike.app.credentials` and `com.clipspike.app.license`; the old ones stay.
- Preferences are copied from `com.chatclip.app` and `com.highlightdesk.app`.
- `~/Movies/ChatClip` or `~/Movies/Highlight Desk` keeps being used as the output folder until a `~/Movies/ClipSpike` folder exists.
- Your license, Dropbox/Google connection and existing clips appear without re-entering anything.

### Confirm success

```sh
ls -la ~/.clipspike.json ~/.chatclip.json ~/.highlight-desk.json
ls -la "$HOME/Library/Application Support/ClipSpike"
cat "$HOME/Library/Application Support/ClipSpike/.migrated-from-legacy"   # JSON with migratedAt
security find-generic-password -s com.clipspike.app.credentials
security find-generic-password -s com.clipspike.app.license
defaults read com.clipspike.app HDLegacyMigrationV1                               # 1
```

Then in the app: open **License…** (status matches before), and confirm connected storage and past clips are listed. Quit and relaunch: no second prompt, nothing is migrated twice. Check the engine log in Terminal-launched runs for `[migration]` errors (`/Applications/ClipSpike.app/Contents/MacOS/ClipSpike` prints them to stderr).

Automated coverage of the file/state part: `node tools/run-tests.js test/migrate.test.js`.

---

## 2. Live Kick test

Prerequisites: Google Chrome or Chromium installed, the Kick developer app (Client ID in [KICK.md](KICK.md)), a Kick channel you can broadcast on (or a live channel with an active chat), and `cloudflared` installed.

> The "12-step" Kick audit list is not written down in the repo. The steps below are the live checks that [KICK.md](KICK.md) ("Verification and remaining live checks") says must pass, split into 12. If your audit list differs, follow it and keep this one as a cross-check.

1. Baseline: `npm run check && npm run test:kick && npm run test:monitor` passes.
2. Pair the relay: `npm run kick:relay`, open the printed setup link, paste the Kick **Client Secret**. Expect the page to verify it and save `kick.clientSecret` and `kick.relayToken` to Keychain (`security find-generic-password -s com.clipspike.app.credentials -a kick.relayToken`).
3. Confirm app-token generation: restart `npm run kick:relay`; it starts without asking for the secret again, and `curl http://127.0.0.1:8765/health` returns `{"ok":true,...}`.
4. In a second terminal: `cloudflared tunnel --url http://127.0.0.1:8766 --no-autoupdate`. Copy the HTTPS address. Tunnel **only** port 8766, never 8765.
5. In the Kick developer app, set the webhook URL to `<tunnel address>/kick/webhook`, turn webhooks **on**, save.
6. Go live (or pick a live channel) and start capture: `npm start -- https://kick.com/<channel>`.
7. Real subscription: the relay subscribes to `chat.message.sent` for that channel. Check `curl http://127.0.0.1:8765/health` shows `channels: 1`, then wait over five minutes to see the periodic subscription re-check not drop it.
8. Signed webhook arrival: send chat messages in the channel; `received` in `/health` increases.
9. Streamlink video acquisition: capture logs show video segments being recorded (Chrome/Chromium found; no browser-check error). Do it on both an Apple Silicon and an Intel Mac, with the bundled Streamlink from `npm run build:mac` (verify its Kick plugin loads).
10. Warmup and automatic spike: wait out the one-minute warmup, then have several people spam an emote. An automatic clip appears.
11. Commands and permissions: the broadcaster/moderator types `!clip` (and `!highlight`) and a clip is made; a normal viewer typing it does not make one.
12. Export and timing: the clip lands in `~/Movies/ClipSpike/kick/<channel>/` with its JSON sidecar and plays correctly. Check chat/video alignment against the stream (there is no measured Kick latency offset yet); note the offset in seconds. Optionally run `BUILD_DIR="$PWD/mac/build-kick" zsh mac/build.sh` for the Kick-enabled build and repeat 6–12 in the app.

Stop: Control-C capture, tunnel and relay; disable webhooks in Kick if the relay stays offline.

### Update docs/KICK.md afterwards

- **Current status:** replace "This has not yet been verified against a live Kick broadcast." with what you verified, the date and the channel type; keep any step that failed as an open item.
- **Registered app:** rename the Kick developer app from `HighlightDesk` to `ClipSpike` (step 7) and delete the "name was set on Kick before the rename" note. Note whether the webhook is now on.
- **Verification and remaining live checks:** tick off or delete the verified items (app-token, subscription, webhook, Streamlink, exports) and record the measured chat/video latency; delete the "browser packaging has not been validated" line if step 9 passed on both architectures.
- Delete the paragraph about DNS/VideoToolbox limits of the implementation session once the live checks pass.
- If you move to a stable tunnel or hosted relay, document its URL setup in place of the temporary `cloudflared` instructions.
- Update the README's Kick sentence ("being integrated") if Kick is now supported.

---

## 3. Polar sandbox pass

Pricing/licensing details: [README.md](../README.md#using-polar-instead-of-lemon-squeezy) and `tools/license.js`.

### Setup

1. In the Polar **sandbox** (sandbox.polar.sh) create an organization, a product, and a **License Keys** benefit attached to it. Set the benefit's **activation limit to 2**. Note the organization ID and the benefit ID.
2. Buy the product with a sandbox card to get a key. Create a second product + benefit (any limit) and buy it too, for the wrong-benefit test.

```sh
export LICENSE_PROVIDER=polar
export LEMON_API_BASE=https://sandbox-api.polar.sh
export LEMON_PRODUCT_ID="<organization-id>:<benefit-id>"
export LEMON_LICENSE_KEY="<key from product 1>"
```

`tools/license.js` prints one JSON line (`ok`, `valid`, `status`, `instanceId`, `activationLimit`, `error`).

### Run

```sh
# Activate: expect ok:true, valid:true, status:"active", an instanceId, activationLimit:2
node tools/license.js --action activate --instance-name "test-mac-1"
# Validate with the instanceId from above: expect ok:true, valid:true
node tools/license.js --action validate --instance-id <ID1>
# Second activation: still ok
node tools/license.js --action activate --instance-name "test-mac-2"
# Third activation: expect ok:false and an error mentioning the activation limit
node tools/license.js --action activate --instance-name "test-mac-3"
# Deactivate one: expect ok:true; then a new activation succeeds again
node tools/license.js --action deactivate --instance-id <ID1>
node tools/license.js --action activate --instance-name "test-mac-3"
# Clean up
node tools/license.js --action deactivate --instance-id <ID2>
node tools/license.js --action deactivate --instance-id <ID3>
```

### Revoked key

In the Polar sandbox dashboard revoke the key (Benefits → License keys). Then:

```sh
node tools/license.js --action validate --instance-id <an active ID>
```

Expect `ok:false` with "not valid, or has been revoked or expired". In the app this clears the Keychain on the next check and returns to an ended trial. A new capture does not start.

### Wrong-benefit key

```sh
LEMON_LICENSE_KEY="<key from product 2>" node tools/license.js --action activate
```

Expect `ok:false` and "This license belongs to a different product (…)", and no leftover activation on that key (the code deactivates it automatically).

### In the app

Build a sandbox-pointed app and repeat activate / deactivate / revoked through **License…**:

```sh
LICENSE_REQUIRED=1 TRIAL_DAYS=7 \
LEMON_API_BASE=https://sandbox-api.polar.sh \
LEMON_PRODUCT_ID="<organization-id>:<benefit-id>" \
CHECKOUT_URL="<sandbox checkout link>" \
npm run build:mac
```

Automated coverage: `node tools/run-tests.js test/license.test.js`. For production, switch `LEMON_API_BASE` to `https://api.polar.sh` (or leave it unset with `LICENSE_PROVIDER=polar`) and use production IDs.

---

## 4. Sparkle EdDSA key and appcast for com.clipspike.app

```sh
./tools/fetch-sparkle.sh
./mac/vendor/sparkle/bin/generate_keys
```

`generate_keys` prints the public key and stores the private key in the login Keychain (if it reports an existing key from Highlight Desk, decide whether to keep using it; the public key must match the private key CI signs with). Put the printed public key in the `SU_PUBLIC_ED_KEY` repo variable and in local release builds. Existing installs of ChatClip or Highlight Desk never auto-update to ClipSpike because the bundle ID changed; users reinstall once.

Export the private key for CI and store it securely (never commit it):

```sh
./mac/vendor/sparkle/bin/generate_keys -x /secure/path/clipspike-sparkle-private-key
```

Paste the file's contents into the `SPARKLE_PRIVATE_KEY` secret in `troxerr/chatclip-release`.

Pick the public feed URL (for example `https://<your-domain>/appcast.xml`; the R2 custom domain in step 7/8) and use it as `SU_FEED_URL`.

Generate and check an appcast item against a real DMG (from step 8 or `npm run build:mac` output):

```sh
ARCH=arm64 VERSION=<CFBundleShortVersionString> BUILD=<CFBundleVersion> \
DOWNLOAD_URL="https://<your-domain>/ClipSpike-<version>-arm64.dmg" \
DMG="mac/build/ClipSpike-<version>-arm64.dmg" \
OUTPUT=/tmp/appcast.xml \
SPARKLE_KEY_FILE=/secure/path/clipspike-sparkle-private-key \
./tools/make-appcast.sh
```

Expect `/tmp/appcast.xml` with an `sparkle:edSignature` and a `length` matching the DMG. Repeat with `ARCH=x86_64` and `EXISTING_APPCAST=/tmp/appcast.xml` to merge both architectures into one file (arm64 item first). Upload the final `appcast.xml` to the `SU_FEED_URL` location over HTTPS.

---

## 5. Create the clipspike-notary profile

On the Mac that does local signing (CI uses an App Store Connect API key instead; see step 8). You need the Developer ID Application certificate installed, your Apple ID, Team ID and an app-specific password from appleid.apple.com:

```sh
xcrun notarytool store-credentials clipspike-notary \
  --apple-id you@example.com --team-id TEAMID --password APP_SPECIFIC_PASSWORD
```

Verify it:

```sh
xcrun notarytool history --keychain-profile clipspike-notary
security find-identity -v -p codesigning | grep "Developer ID Application"
```

Expect the history call to succeed (an empty list is fine). Then `NOTARY_PROFILE=clipspike-notary` with `DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)" ./mac/release.sh --check` is used in step 8.

---

## 6. Windows inputs

Set in the repo `troxerr/chat-clip` → Settings → Secrets and variables → Actions (the `windows-release.yml` workflow reads them).

| Name | Kind | Value |
|---|---|---|
| `WIN_UPDATE_URL` | variable | **Required.** Public https folder that will hold the installer and `latest.yml`, e.g. `https://downloads.astlabs.dev/win/` (R2 public base + `win/`). The workflow fails without it. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | secrets | Recommended. Same values as in `troxerr/chatclip-release`; lets tag builds upload to R2 `win/`. Without them you upload by hand. |
| `WIN_R2_PREFIX` | variable | Optional R2 folder, default `win`; must match the path in `WIN_UPDATE_URL`. |
| `WIN_CSC_LINK` | secret | Code-signing `.pfx`: base64 of the file, or an https URL to it. **Optional**: unset gives an **unsigned** installer (SmartScreen warns users), a warning in the log, and an "UNSIGNED" note in the draft release. |
| `WIN_CSC_KEY_PASSWORD` | secret | The `.pfx` password (set together with `WIN_CSC_LINK`). |

**Unsigned-first:** you can ship with only `WIN_UPDATE_URL` and the licensing values. Add the certificate later with no other change. See [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md#unsigned-first-path).
| `RUNTIME_MIRROR_URL` | variable | Optional mirror for the assets pinned in `tools/runtime-win.json`. |

Encode the certificate:

```sh
base64 -i clipspike-codesign.pfx | pbcopy
```

Licensing values in `win/build-config.json` (committed file keeps them off; the release job runs `node win/tools/check-release-config.js` and fails unless they are set):

```json
{
  "licenseRequired": true,
  "trialDays": 7,
  "productId": "<organization-id>:<benefit-id>",
  "checkoutUrl": "https://buy.polar.sh/..."
}
```

`productId` uses the same format as the Mac build's `LEMON_PRODUCT_ID` (for Lemon Squeezy, the numeric product ID). Check locally:

```sh
node win/tools/check-release-config.js
```

### Host latest.yml

For `win-v*` tag builds the workflow uploads the installer and then `latest.yml` to R2 under `win/` when the `R2_*` secrets are set in this repo; skip the manual upload below in that case. Otherwise, after a Windows release run, download `ClipSpike-*-x64.exe` and `latest.yml` (the `ClipSpike-windows-release` artifact or the draft GitHub release for a `win-v*` tag) and upload both to the `WIN_UPDATE_URL` folder so that `<WIN_UPDATE_URL>/latest.yml` and the installer file named inside it are publicly readable over HTTPS:

```sh
curl -fsSL "$WIN_UPDATE_URL/latest.yml"
```

Expect the YAML with `version`, `path` and `sha512` matching the installer. Upload the installer before `latest.yml` so clients never see a feed pointing at a missing file. Cloudflare R2 (the same bucket as the Mac builds, under a `win/` prefix) is the recommended host.

---

## 7. External renames

- **Polar / Lemon Squeezy:** rename the product(s) and checkout page to ClipSpike, and update any customer-facing receipt text.
- **Kick developer app:** rename `HighlightDesk` to `ClipSpike` in the Kick developer settings (the Client ID does not change).
- **R2 / appcast:** old DMGs and appcast entries may still be named for Highlight Desk. In the R2 bucket, list the objects, delete or rename the old DMG names, and confirm `appcast.xml` only references `ClipSpike-<version>-<arch>.dmg` URLs that exist (`curl -I <url>` returns 200).
- **troxerr/chatclip-release:** update the workflow names and secrets for ClipSpike (see [RELEASE.md](RELEASE.md#rename-from-chatclip--highlight-desk-external-steps)), then delete the stale deploy-key secret (the source repo is public, so it is not needed):

  ```sh
  gh secret list --repo troxerr/chatclip-release
  gh secret delete SOURCE_DEPLOY_KEY --repo troxerr/chatclip-release
  ```

---

## 8. Throwaway-tag dry runs and clean-machine tests

Do these after steps 4–7. Use throwaway versions so nothing real is published, and delete the tags/artifacts afterwards.

### Mac (arm64 and x86_64)

1. Confirm all required secrets and variables are set in `troxerr/chatclip-release` (full list in [RELEASE.md](RELEASE.md#automated-release-github-actions--cloudflare-r2)). Set `SU_PUBLIC_ED_KEY`, `LEMON_PRODUCT_ID`, `CHECKOUT_URL`, `TRIAL_DAYS`, `R2_PUBLIC_BASE_URL`, and the secrets.
2. In `mac/Info.plist` bump `CFBundleShortVersionString` to a throwaway version (for example `3.1.0-dryrun`) and `CFBundleVersion`; the tag must equal `CFBundleShortVersionString`. Do this on a scratch branch, not `main`.
3. Tag and run:

   ```sh
   git tag v3.1.0-dryrun && git push origin v3.1.0-dryrun
   ```

   Then in `troxerr/chatclip-release` open **Actions → release → Run workflow** and enter `ref = v3.1.0-dryrun`; watch it with `gh run watch --repo troxerr/chatclip-release`.
4. Expect both the arm64 and x86_64 jobs to pass the tests, `./mac/release.sh --check`, signing, notarization, stapling and `--verify`, upload to R2, and a merged `appcast.xml` carrying both architectures.
5. To do the same locally on one machine: build with the variables from [RELEASE.md](RELEASE.md#build-sign-notarize), then run `./mac/release.sh --check`, `./mac/release.sh`, `./mac/release.sh --verify` with `DEVELOPER_ID_APPLICATION` and `NOTARY_PROFILE=clipspike-notary`.

### Windows

```sh
git tag win-v3.1.0-dryrun && git push origin win-v3.1.0-dryrun
gh run watch --repo troxerr/chat-clip
```

(or run **windows-release** manually with workflow_dispatch). Expect the config checks, signature verification (only if `WIN_CSC_LINK` is set; otherwise an "unsigned" warning), `latest.yml` and a draft GitHub release containing the installer. Host the files per step 6.

### Clean-machine install tests

On a Mac per architecture (no Homebrew, no Highlight Desk, a fresh user account is fine) and a clean Windows machine:

1. Download the DMG/installer from the public URL (not the build folder). Mac: copy the app out of the DMG and launch; Gatekeeper must open it with no warning (`spctl -a -t open --context context:primary-signature <dmg>`). Windows: install; signed builds show your publisher, unsigned builds show the SmartScreen warning (More info, then Run anyway).
2. Run a capture on a Twitch channel and produce a clip; check the 7-day trial and License… screen; activate a sandbox/real key.
3. **Update test:** install the previous throwaway version, publish a newer throwaway version (bump version/build, repeat the tag run, make sure the appcast / `latest.yml` is hosted), then:
   - Mac: **Check for Updates…**; confirm Sparkle verifies the signature, installs, relaunches, and keeps settings and license. Repeat while a capture is running and while offline. Sparkle only checks automatically after a license has been validated in the last 14 days ([UPDATE.md](UPDATE.md)).
   - Windows: launch the older build; it checks at startup and installs on quit. Relaunch and confirm the new version. `CLIPSPIKE_NO_UPDATE=1` disables it.
4. Clean up: delete the throwaway tags (`git push origin :refs/tags/v3.1.0-dryrun`), draft releases and R2 test objects, and restore `appcast.xml` / `latest.yml` to the last real release.

When everything above is ticked, remove the matching items from "Current blockers" in [RELEASE.md](RELEASE.md) and the "Unverified" section of [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md).
