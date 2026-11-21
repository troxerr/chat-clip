# Chatclip

Kick live automatic highlights are being integrated. See [Kick setup and live
validation status](docs/KICK.md) before using the separate Kick-enabled build.

## Capture Monitor

Open **Monitor…** on Capture (or Command–Shift–M) for live recorder health, chat decisions and per-channel learning. Rate clips with thumbs up/down; right-click for Duplicate / Started Late / Ended Early. **Mark Missed Moment** records a review timestamp. A separate worker logs decisions and tests bounded settings; validated changes apply only on a future capture after enough explicit ratings and later-session validation. Pause or roll back tuning from the monitor. See [Monitoring](docs/MONITORING.md) for evaluation limits, retention and CLI commands.

Chatclip watches a Twitch channel's chat and saves the moments chat reacts to. A desktop clip is exported, reframed to 1080×1920 with the full video centered over a blurred background, and then either kept on the Mac or uploaded to Dropbox or Google Drive.

- **Local only** — no cloud account; clips stay on the Mac.
- **Dropbox** — upload, verify the remote byte size, then delete the local videos.
- **Google Drive** — same flow using a Drive app folder.

## Requirements

- **Web dashboard:** a desktop Chromium browser (Chrome or Edge).
- **Desktop recorder:** Node 22+, [Streamlink](https://streamlink.github.io/), and [FFmpeg](https://ffmpeg.org/). On macOS:

  ```sh
  brew install node streamlink ffmpeg
  ```

- **macOS app:** macOS 13.5+. The built app includes Node, Streamlink, and an LGPL FFmpeg runtime; no Homebrew install is required for the app. Running from source still uses the Streamlink/FFmpeg on `PATH`.

> Node 22+ is required because the chat client uses the built-in global `WebSocket`.

## Storage modes

| Mode | Account | What happens |
|---|---|---|
| Local only | None | Keeps the vertical MP4 + JSON sidecar in the output folder. The raw landscape intermediate is removed unless `storage.keepRaw` is true. |
| Dropbox | Dropbox | Uploads the vertical MP4, confirms the byte size, then removes the local raw/vertical MP4s if `deleteAfterUpload` is true. |
| Google Drive | Google | Same flow through a `Highlight Desk/<channel>` folder in Drive. |

`keepLocalCopy` keeps the vertical clip after a successful cloud upload. `keepRaw` keeps the landscape intermediate. The JSON sidecar is always kept as the local record of the clip and its remote location.

## Web dashboard

```sh
npm run serve
# open http://localhost:8080
```

Or open the deployed dashboard URL. The Twitch embed needs a real `parent` hostname, so open it through `http://localhost` or HTTPS — not `file://`.

1. Enter a Twitch username and load the channel.
2. Play and unmute the Twitch player.
3. Select **Start capture**, choose this Chatclip tab, and enable **Share tab audio**.
4. Leave the page open. A clip appears in **Session highlights** when chat spikes or someone triggers one.

Browser clips are saved as captured in IndexedDB. They survive a refresh, but clearing site data removes them. Use **Download** or **Download all** for anything you want to keep. The browser dashboard is a separate local tool; 9:16 reframing and cloud storage are handled by the desktop recorder.

## Desktop recorder

```sh
npm start -- your_channel
```

Or double-click `Start Background Recorder.command` and enter the username.

The recorder:

- Pulls the best available stream through Streamlink.
- Copies it into 3-second MPEG-TS segments with FFmpeg.
- Samples chat every 5 seconds.
- Saves a 30-second landscape MP4 (15 seconds before + 15 after the trigger).
- Reframes it to 1080×1920: the full frame is centered, and a scaled, blurred version fills the background.
- Stores the vertical clip locally, or uploads it to Dropbox/Google Drive and then removes local videos per the storage settings.
- Writes a JSON sidecar with the trigger, score, participant/reaction counts, top emotes, `truncated`, `reframed`, and storage details.
- Reconnects after a stream drop and finalizes any pending clip from its contiguous segment run.
- Queues failed cloud uploads and retries them across restarts.
- Exports asynchronously, so chat/progress handling continues while FFmpeg encodes.

Output defaults to `~/Movies/Highlight Desk/<channel>/`:

```text
your_channel-20261114-214106-auto.mp4          # landscape intermediate
your_channel-20261114-214106-auto-9x16.mp4     # vertical clip
your_channel-20261114-214106-auto.json         # metadata
```

Local-only mode removes the landscape intermediate and keeps the vertical clip plus sidecar. Cloud modes remove both MP4s after a confirmed upload unless `keepLocalCopy`/`keepRaw` says otherwise.

### Detection

- **Auto:** a chat reaction spike after at least one minute of chat history.
- **Manual:** **Save highlight now**, or send `SIGUSR2` to the recorder.
- **Chat command:** the broadcaster or a moderator types `!clip` or `!highlight`.
- **Raid:** a Twitch raid event starts a clip if it passes the cooldown.

The detector samples unique chatters per 5-second window and uses a median/MAD baseline, so low-chat channels can trigger and a raid does not permanently inflate the threshold.

### Configuration

Non-secret settings live in `~/.highlight-desk.json` (or `HIGHLIGHT_DESK_CONFIG`). The macOS app stores OAuth refresh tokens (and a legacy Dropbox app secret) in Keychain and clears those secrets from the config after migration. The CLI reads Keychain tokens through `security` by default; set `HIGHLIGHT_DESK_KEYCHAIN=0` to force config/env-only credentials.

On Windows, secrets are encrypted with the signed-in user's Windows DPAPI key (through the built-in `powershell.exe`) and saved in `%APPDATA%\Highlight Desk\credentials.json`; other Windows users and other PCs cannot decrypt them. Manage them with `node tools/credentials.js set|has|delete|list <name>`. The names the app reads are `dropbox.refresh`, `dropbox.appSecret`, `google.refresh`, `google.clientSecret`, `kick.clientSecret`, `kick.relayToken` and `license.key` (names are case-sensitive). On Windows, `npm run dropbox:auth` and `npm run google:auth` save their tokens in the store and leave those config fields blank; if the store is unavailable they fall back to the 0600 config file with a warning, so a token is never lost. `node tools/credentials.js migrate [--config <file>]` moves secrets already in the config file (including `license.key`) into the store and blanks them there. `set` reads the secret from a hidden prompt or from stdin, and there is no command that prints a secret. Environment variables and the config file still take precedence over the store.

```json
{
  "reframe": {
    "enabled": true,
    "width": 1080,
    "height": 1920,
    "crf": 20,
    "preset": "veryfast",
    "blur": 20,
    "encoder": "h264_videotoolbox",
    "bitrate": "8M",
    "layout": "blur",
    "camHeightRatio": 0.35,
    "facecamCorner": "bottom-left",
    "facecam": null,
    "gameplay": null
  },
  "storage": {
    "mode": "local",
    "folder": "/Highlight Desk",
    "deleteAfterUpload": true,
    "keepLocalCopy": false,
    "keepRaw": false
  },
  "dropbox": {
    "enabled": true,
    "appKey": "",
    "appSecret": "",
    "refreshToken": "",
    "folder": "/Highlight Desk"
  },
  "googleDrive": {
    "enabled": true,
    "clientId": "",
    "clientSecret": "",
    "refreshToken": "",
    "folder": "/Highlight Desk"
  }
}
```

Set `reframe.layout` to `"split"` (or set `HIGHLIGHT_DESK_REFRAME_LAYOUT=split`) to stack a cropped facecam pane on top of the gameplay instead of the default `"blur"` background:

- `camHeightRatio` — fraction of the vertical frame height reserved for the facecam (`0.2`–`0.5`, default `0.35`).
- `facecamCorner` — corner preset when `facecam` is `null`: `"top-left"`, `"top-right"`, `"bottom-left"` (default), or `"bottom-right"`.
- `facecam` / `gameplay` — optional normalized `[0, 1]` crop rectangles (`{ "x": 0.015, "y": 0.70, "w": 0.25, "h": 0.28 }`) to override the corner preset or focus on a specific gameplay region.

The default encoder is hardware H.264 (`h264_videotoolbox`) so a bundled commercial app does not require GPL `libx264`. Set `HIGHLIGHT_DESK_ENCODER=<encoder>` (for example `libx264`, only where your FFmpeg has it, or `libopenh264`) to force one; any other value, or `auto`, is ignored. On Windows the app probes `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf` and then the software `libopenh264`, and uses the first that really encodes.

`reframe.priority` is `normal` or `belowNormal` and sets the CPU priority of the clip export and 9:16 encodes (`HIGHLIGHT_DESK_PRIORITY` overrides it). It defaults to `belowNormal` on Windows, where the app shares a PC with a game and streaming software, and to `normal` elsewhere. The live recorder only stream-copies and always runs at normal priority. This lowers CPU priority only; a GPU encoder (NVENC, QSV, AMF) still shares the GPU with the game.

`storage.mode` is `local`, `dropbox`, or `googleDrive`. If it is omitted, a configured Dropbox connection is used first, then Google Drive, otherwise local.

Queue and history live under `~/Library/Application Support/Highlight Desk/` by default. Set `HIGHLIGHT_DESK_STATE=/some/folder` to override. Failed uploads are retried with exponential backoff; the retry delay and listener interval can be shortened for development with `HIGHLIGHT_DESK_RETRY_MS` and `HIGHLIGHT_DESK_QUEUE_MS`.

`HIGHLIGHT_DESK_INPUT=/path/to/video.mp4` lets the recorder use a local file instead of Streamlink for development and pipeline tests. `HIGHLIGHT_DESK_OUTPUT` changes the output root.

The JSONL event protocol is enabled with `HIGHLIGHT_DESK_EVENTS=1` and is used by the macOS app.

### Local-only mode

```sh
HIGHLIGHT_DESK_STORAGE=local npm start -- your_channel
```

No account or network storage is involved. Keep or remove the landscape intermediate with `storage.keepRaw`.

### Dropbox setup

1. Create a Dropbox app at <https://www.dropbox.com/developers/apps>.
2. Add redirect URI `http://localhost:53682/callback`.
3. Enable `files.content.write` and `files.metadata.write`.
4. Run:

   ```sh
   npm run dropbox:auth
   ```

   Add `-- --no-redirect` if Dropbox rejects the redirect URI and paste the code Dropbox shows.

5. Set `"storage": { "mode": "dropbox", ... }` and restart capture.

Uploads go to `<folder>/<channel>/<filename>`. A failed upload leaves local clips in place and queues a retry.

### Google Drive setup

1. Create a project in <https://console.cloud.google.com/> and enable the **Google Drive API**.
2. Create an OAuth client of type **Desktop app**.
3. Add redirect URI `http://127.0.0.1:53683/oauth2callback`.
4. Configure the OAuth consent screen with scopes:
   - `https://www.googleapis.com/auth/drive.file`
   - `openid`
   - `email`
5. Run:

   ```sh
   npm run google:auth
   ```

   The helper saves the client ID/secret, refresh token, and switches `storage.mode` to `googleDrive`. Publish the OAuth consent screen for unattended use; refresh tokens issued in Google's "Testing" mode expire after 7 days.

Google Drive uses the `drive.file` scope, so the app can only see files it creates. Clips go to `Highlight Desk/<channel>` in My Drive.

## macOS app

```sh
npm run build:mac
open "mac/build/Chatclip.app"
```

`mac/build.sh` compiles the Cocoa wrapper, bundles Node, copies the engine modules and `Contents/Resources/runtime`, generates the app icon, and ad-hoc signs the bundle. Set `NODE_BIN=/path/to/node` to use a specific Node.

The app is a single native window with a Capture / Clips / Storage sidebar and a Settings page. Capture is a dense utility view: channel entry, Start/Stop, recorder state, Save/Open actions, a session summary, and recent clips — no dashboard-card grid. Clips supports search and All/Local/Cloud/Queued filters. Storage uses destination cards plus retention controls. License and support actions live under Settings; Getting Started is a sheet.

![Capture](docs/screenshots/capture.png)

The UI uses the system accent color and a restrained SF Symbols role map (`mac/ui/HDSymbols.*`): icons for navigation, state, and table metadata only — not page titles or decorative chrome. Card backgrounds are limited to actual grouped settings/storage content. All icon names are verified against macOS 13.5. Light appearance is available at `docs/screenshots/capture-light.png`; onboarding is at `docs/screenshots/onboarding.png`.

The app shows recorder status, clip count, active storage, queued uploads, and errors. **Getting Started** opens the first-run guide; **Clips** shows saved and queued clips with **Open Selected**, refresh, and state-folder access. **Storage** opens the in-app destination page:

- choose **Local only**, **Dropbox**, or **Google Drive**;
- click **Connect** to complete OAuth in the browser;
- set the remote folder and local-retention checkboxes;
- **Save** writes the non-secret settings and uses the connection on the next capture.

Tokens are stored in Keychain. The CLI helpers remain available as a fallback. For a one-click build, provide the vendor OAuth clients at build time:

```sh
DROPBOX_APP_KEY=your-dropbox-app-key \
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com \
GOOGLE_CLIENT_SECRET=your-google-desktop-client-secret \
npm run build:mac
```

Dropbox uses PKCE and does not require a client secret in the app. Google uses the standard desktop OAuth client secret. Redirect URIs are `http://127.0.0.1:53682/callback` (Dropbox) and `http://127.0.0.1:53683/oauth2callback` (Google). The **Edit config file** button remains as a developer fallback.

**Open storage** opens the local folder, Dropbox, Google Drive, or the last remote file. **Save highlight now** sends `SIGUSR2`. **Open last clip** opens the last local clip when one exists. **History…** merges `history.json` and pending `queue.json` entries; double-click a row to open its local file or remote link. **Export Diagnostics…** creates a zip with a redacted config, queue/history, logs, runtime versions, and signing info; **Launch at Login** uses `SMAppService`. **Notify When Clips Finish** enables native clip, upload, queued-retry, and upload-failure notifications (macOS permission required).

Unsigned QA DMGs are produced by:

```sh
FORMAT=dmg ARCH=arm64 ./tools/package-unsigned.sh
FORMAT=dmg ARCH=x86_64 APP="mac/build/Chatclip x86_64.app" ./tools/package-unsigned.sh
```

Both are ad-hoc signed and will be rejected by Gatekeeper on another Mac until notarized.

The app bundles `Node`, `Streamlink`, and an LGPL FFmpeg built with VideoToolbox in `Contents/Resources/runtime/bin`. `tools/build-runtime.sh` rebuilds that runtime; `tools/prepare-runtime.sh` copies supplied binaries.

For an x86_64 build on Apple Silicon with Rosetta, use an x86_64 Node and the x86_64 runtime:

```sh
ARCH=x86_64 NODE_BIN=/path/to/node-x64 ./mac/build.sh
```

The CI matrix builds both architectures. For QA packages:

```sh
ARCH=arm64 FORMAT=zip ./tools/package-unsigned.sh
ARCH=x86_64 APP="mac/build/Chatclip x86_64.app" FORMAT=zip ./tools/package-unsigned.sh
```

`FORMAT=dmg` uses `hdiutil` and requires an unsandboxed terminal/CI runner. The apps are ad-hoc signed for local use and are **not notarized**; a commercial release requires Developer ID signing and notarization.

## Privacy and limitations

- No Twitch account or OAuth is used. Chat is read anonymously; 7TV emote data is fetched from `7tv.io` and images from `cdn.7tv.app`.
- Local clips stay on the Mac. Dropbox/Google Drive clips are uploaded to the user's own account; the app has no vendor server and does not receive clip data.
- Cloud credentials are stored in `~/.highlight-desk.json` with `0600` permissions in the current build. Treat that file as a credential. The planned commercial app moves tokens to Keychain and uses vendor OAuth apps.
- The desktop recorder depends on Streamlink and FFmpeg and on Twitch/Streamlink continuing to work. Ads embedded in the stream can appear in clips.
- Run one capture path per channel at a time.
- Respect the streamer's and Twitch's terms when recording or redistributing content.

## Development

```sh
npm test              # Node tests: core, FFmpeg, Dropbox, Google Drive, OAuth, queue, storage
npm run check         # node --check on every JS source
npm run serve         # static dashboard at http://localhost:8080
npm run dropbox:auth  # Dropbox refresh-token setup
npm run google:auth   # Google Drive refresh-token setup
npm run build:mac
```

The browser has no build step: `dist/` is the deployed site. Shared browser modules are classic scripts that also export CommonJS for Node; Node-only helpers live in `lib/`.

### File map

```text
background.cjs           Recorder, chat, reframe, storage, queue orchestration
dist/                    Browser dashboard (separate local tool)
lib/manifest.js          Segment-list parsing and clip-window planning
lib/exporter.js          Async landscape export + JSON sidecar
lib/reframe.js           9:16 reframe with blurred background
lib/priority.js          Lowers CPU priority of encode children
lib/appconfig.js         Config/env parsing, storage modes, provider settings
lib/dropbox.js           Dropbox OAuth refresh, folder creation, upload
lib/google-drive.js      Google Drive OAuth refresh, folder creation, resumable upload
lib/jobstore.js          Persistent upload queue and clip history
lib/credentials.js       Secret store: macOS Keychain, Windows DPAPI
lib/storage/             Provider selection and local adapter
tools/dropbox-auth.js    Dropbox refresh-token helper
tools/google-auth.js     Google Drive refresh-token helper
tools/oauth-bridge.js    Browser OAuth helper used by the app
tools/credentials.js     Manage secrets in the Windows credential store
tools/license.js         Lemon Squeezy license helper
tools/fetch-sparkle.sh   Fetch the pinned Sparkle framework
tools/make-appcast.sh    Sign a release DMG into a Sparkle appcast
tools/build-runtime.sh   Build LGPL FFmpeg + self-contained Streamlink
tools/prepare-runtime.sh Copy runtime binaries into the app bundle
docs/THIRD_PARTY_NOTICES.md Licenses and source-offer notes
mac/main.m               Cocoa wrapper
mac/build.sh             macOS app build
mac/release.sh           Developer ID signing, notarization, DMG
mac/Chatclip.entitlements Hardened-runtime entitlements
docs/RELEASE.md          Production release path
docs/CI.md               macOS CI matrix for both architectures
test/                    Node tests
```

### Test notes

- `test/exporter.test.js` and `test/reframe.test.js` generate small videos with FFmpeg and skip when FFmpeg/ffprobe are unavailable.
- `test/dropbox.test.js` and `test/google-drive.test.js` use injected fake fetch implementations and never contact the real providers.
- Live Twitch capture and Streamlink behavior are not automated; a manual pass needs a real channel. `HIGHLIGHT_DESK_INPUT` provides a local-file pipeline test. A self-contained check runs the bundled engine with `PATH=/usr/bin:/bin`, proving it does not fall back to Homebrew FFmpeg/Streamlink.

## Troubleshooting

- **No audio in web clips:** re-run capture and enable **Share tab audio**.
- **Twitch player is blank:** serve over HTTPS or `localhost`; the `parent` parameter comes from `location.hostname`.
- **`!clip` does nothing:** only the broadcaster or a moderator triggers it, and chat must be connected.
- **Tool missing:** install Streamlink/FFmpeg and restart from a shell whose `PATH` contains `/opt/homebrew/bin` (or `/usr/local/bin`).
- **Dropbox `Invalid redirect_uri`:** add `http://localhost:53682/callback` exactly, or run `npm run dropbox:auth -- --no-redirect`.
- **Dropbox 401/403:** re-run `npm run dropbox:auth`; confirm scopes and redirect URI.
- **Google `redirect_uri_mismatch`:** add `http://127.0.0.1:53683/oauth2callback` to the Desktop OAuth client.
- **Google 403/quota:** check Drive API enablement, scopes, and storage quota; local clips and the queue are kept.
- **Google refresh token expires every 7 days:** publish the OAuth consent screen; testing-mode tokens are short-lived.
- **macOS asks for the login keychain password:** allow it once. Ad-hoc development rebuilds change the code signature, so Keychain may ask again; a signed release with a stable Developer ID has a stable identity. Set `HIGHLIGHT_DESK_KEYCHAIN=0` for a dev run that must not touch Keychain.
- **Trial expired / license not active:** open **License…**, paste the key from the purchase email, and activate. Check that `LEMON_PRODUCT_ID` matches the product and that the Mac can reach the Lemon Squeezy API.
- **No notifications:** enable **Notify When Clips Finish** in the app menu and allow Chatclip in System Settings → Notifications. Ad-hoc development builds may not register with Notification Center; a signed/notarized release does. Set `HIGHLIGHT_DESK_NOTIFICATIONS=0` for a dev run without the permission prompt.
- **Need support:** use **Export Diagnostics…** from the app menu, review the zip, and send it with what happened. OAuth tokens, app secrets, and license keys are redacted from the config copy.
- **A clip is queued, not uploaded:** inspect the active storage mode and `~/Library/Application Support/Highlight Desk/queue.json`; retries run every minute with exponential backoff.
- **A local video disappeared:** expected when cloud mode has `deleteAfterUpload: true` and the upload was confirmed. The sidecar and history retain the remote path.
- **Upload too large:** the current Dropbox adapter caps single-request uploads at 150 MB; Google uses resumable upload.


## Updates

The app embeds [Sparkle 2.10.1](https://sparkle-project.org/) when `mac/vendor/Sparkle.framework` is present. **Check for Updates…** is in the app menu. A development build with no feed shows a clear “updates are not configured” message instead of failing.

```sh
./tools/fetch-sparkle.sh
./mac/vendor/sparkle/bin/generate_keys   # once; keep the private key out of git
SU_FEED_URL="https://your-domain.example/appcast.xml" \
SU_PUBLIC_ED_KEY="<public key>" \
npm run build:mac
```

Generate a signed appcast after notarizing the DMG:

```sh
ARCH=arm64 VERSION=3.1.0 BUILD=5 \
DOWNLOAD_URL="https://your-domain.example/Chatclip-3.1.0-arm64.dmg" \
DMG="mac/build/Chatclip-3.1.0-arm64.dmg" \
OUTPUT=site/appcast.xml \
./tools/make-appcast.sh
```

See [docs/UPDATE.md](docs/UPDATE.md) for CI keys, appcast hosting, and the update test checklist.

## License and trial

Development builds are unlocked (`HDLicenseRequired` is false). A release build enables the 7-day trial and Lemon Squeezy license activation:

```sh
LICENSE_REQUIRED=1 \
TRIAL_DAYS=7 \
LEMON_PRODUCT_ID=12345 \
CHECKOUT_URL=https://your-store.lemonsqueezy.com/checkout/buy/... \
npm run build:mac
```

Open **License…** in the app menu to see trial days, enter a key, activate, deactivate, or open checkout. The app stores the license key in the `0600` config file and validates through `tools/license.js`:

- activation: `POST /v1/licenses/activate`
- validation: `POST /v1/licenses/validate`
- deactivation: `POST /v1/licenses/deactivate`
- offline grace: 14 days after the last successful validation
- instance limit: controlled by the Lemon Squeezy product (the UI recommends two Macs)

Set `LEMON_API_BASE` only for testing or a proxy. A license is required to start a new capture after the trial ends; an already-running capture is not interrupted.

## Commercial release

The current builds are ad-hoc signed. Arm64 and x86_64 LGPL runtimes/apps are built locally, but a sellable release still requires Developer ID signing, notarization, vendor OAuth client credentials, a Lemon Squeezy product/checkout, a hosted Sparkle feed, legal review, and a paid pilot.

See [docs/RELEASE.md](docs/RELEASE.md) for the release path.
