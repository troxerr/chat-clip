# Kick automatic highlights

## Current status

Kick live channel support, native chat-emote normalization, automatic spike
detection, broadcaster/moderator commands, separate monitoring profiles, and a
personal Mac relay are implemented. This has not yet been verified against a live
Kick broadcast. Twitch VOD scanning remains Twitch-only.

The Kick developer application `HighlightDesk` has been registered (the name was set on Kick before the rename to ChatClip; renaming it there is an external step). Its Client ID
is `01M7JRFG1KV0DR5ZP6D0ECMK4V`. Its local OAuth callback is
`http://localhost:8765/kick/callback`; the relay uses client credentials and does
not implement user login at that callback. The app's webhook switch is still off.

## Pair the Mac relay

From the project root:

```sh
npm run kick:relay
```

On first use, open the setup link printed by the command. Copy the **Client
Secret** from Kick's developer application into the password field on that local
page. It verifies the secret with Kick and saves it and a generated local pairing
token in macOS Keychain under `com.chatclip.app.credentials`, accounts
`kick.clientSecret` and `kick.relayToken`. Never put the secret in source code, the
app bundle, a screenshot, or chat. Later starts read these Keychain entries.

The CLI also supports `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, and
`CHATCLIP_KICK_RELAY_TOKEN`. Environment credentials are useful for a hosted
relay; local browser setup requires macOS Keychain. The recorder uses
`CHATCLIP_KICK_RELAY` or `kick.relayUrl` in its existing config to select an
alternate relay, and requires HTTPS for remote hosts.

The relay binds two ports to loopback:

| Port | Purpose | Exposure |
|---|---|---|
| 8765 | Local pairing, authenticated control and event polling | Keep local |
| 8766 | Signature-verified `POST /kick/webhook` only | Tunnel this port |

For development only, with the relay running:

```sh
cloudflared tunnel --url http://127.0.0.1:8766 --no-autoupdate
```

Copy the HTTPS address printed by cloudflared, append `/kick/webhook`, and set it
as the developer app's webhook URL. Enable webhooks and save. This tunnel address
changes when restarted; use a managed tunnel or a hosted relay with a stable URL
before relying on it daily or distributing the app. Never tunnel port 8765.

## Capture

Keep the relay and tunnel running. In the Kick-enabled Mac build, enter a live URL
such as `https://kick.com/channel` and choose Start Capture. The CLI equivalent is:

```sh
npm start -- https://kick.com/channel
```

The relay resolves the broadcaster ID and subscribes to `chat.message.sent` using
the official API. Channel subscription existence is rechecked every five minutes.
Allow the existing one-minute detector warmup. Native Kick emotes participate in
reaction scoring. Broadcaster and moderator `!clip` / `!highlight` commands use
verified sender IDs and badges. Ordinary viewers cannot trigger privileged clips.

Kick capture requires Google Chrome or Chromium installed on the Mac (Streamlink
uses it to pass Kick's browser check). Capture checks for it at startup, fails with
a clear error if none is found, and passes it to Streamlink explicitly. To use a
different Chromium-based browser, set `CHATCLIP_KICK_BROWSER` or `kick.browser`
in the config to its full executable path.

Kick clips save under `~/Movies/ChatClip/kick/channel/`. Monitoring uses the
key `kick--channel`, distinct from the Twitch channel of the same name. The
monitor CLI accepts a Kick URL or that internal key. Existing Twitch folders and
learning profiles are preserved.

## Verification and remaining live checks

```sh
npm run check
npm run test:kick
npm run test:monitor
BUILD_DIR="$PWD/mac/build-kick" zsh mac/build.sh
```

Before calling live Kick support ready, verify app-token generation, a real
subscription, signed webhook arrival, Streamlink video acquisition, and actual
clip exports. Check chat/video timing on a real broadcast; the integration
currently uses the existing pre/post-roll and has no measured Kick latency offset.

Streamlink's Kick plugin requires browser assistance. Verify the bundled
Streamlink includes the Kick plugin and can find a supported Chromium browser on
both Apple Silicon and Intel Macs; browser packaging has not been validated.

Automated checks cover raw-body signature verification and tamper rejection,
timestamp expiry, duplicate delivery, reconnect/restart cursor resets,
platform separation, emote scoring, command permissions, token refresh, and the
actual recorder's automatic/command clip requests with simulated Kick messages.

Webhook content is retained only in bounded in-memory queues for up to 30 seconds.
The relay strips fields unrelated to detection and does not persist raw chat.
The setup form blocks cross-origin submissions. The event/control endpoints
require a separate pairing token. Capture resets its baseline after delivery gaps
and ignores messages older than 15 seconds rather than clipping stale backlogs.

As of the implementation session, terminal DNS could not resolve Kick or
Cloudflare's tunnel API under the session's network restrictions. Two existing
FFmpeg integration tests also could not initialize macOS VideoToolbox (-12903).
These live/environment checks must be completed before release; unit tests alone
do not establish live stream compatibility.

## Stop and rollback

Stop capture normally, then stop the tunnel and relay with Control-C. Disable
webhooks in Kick if the relay will remain offline. Restarting a temporary tunnel
requires updating the webhook address. No launch-at-login service is installed.
The currently running Twitch app is not replaced or restarted by the Kick build.

## References

- https://docs.kick.com/getting-started/generating-tokens-oauth2-flow
- https://docs.kick.com/events/introduction
- https://docs.kick.com/events/webhook-security
- https://docs.kick.com/events/event-types
- https://streamlink.github.io/plugins.html#kick
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
