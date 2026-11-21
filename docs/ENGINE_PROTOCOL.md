# Engine protocol

How a host app (the macOS Cocoa app, the Windows Electron app) runs and talks to the Node engine. The engine is a child process; the host reads events from its stdout and sends commands on its stdin.

This file is checked against the code by `test/protocol-doc.test.js`: every event name emitted in `background.cjs` and `vod.cjs`, and every stdin command, must appear below.

## Processes

| Script | Purpose | Started as |
|---|---|---|
| `background.cjs` | Live capture of one channel | `node background.cjs <twitch-name or live channel URL>` |
| `vod.cjs` | Find and cut highlights in a past broadcast | `node vod.cjs <vod URL> [options]` |

## Environment

Every `CLIPSPIKE_*` variable also accepts its former `CHATCLIP_*` and `HIGHLIGHT_DESK_*` names; `CLIPSPIKE_*` wins, then `CHATCLIP_*`.

| Variable | Meaning |
|---|---|
| `CLIPSPIKE_EVENTS=1` | Write events to stdout as JSON lines. Without it the engine prints human text. **Hosts must set this.** |
| `CLIPSPIKE_COMMANDS=1` | `background.cjs` reads commands from stdin (see below). Needed on Windows, which has no `SIGUSR1`/`SIGUSR2`. |
| `CLIPSPIKE_CONFIG` | Config file path (default `~/.clipspike.json`). |
| `CLIPSPIKE_STATE` | State folder (queue, history, feedback, models). Default per OS, see `lib/platform.js`. |
| `CLIPSPIKE_OUTPUT` | Clip output root. Default per OS. |
| `CLIPSPIKE_INPUT` | Use a local video file instead of Streamlink (development and tests). |
| `CLIPSPIKE_SMOKE` | Windows smoke output folder. When combined with `CLIPSPIKE_INPUT`, the recorder uses a deterministic chat spike in place of live Twitch chat. |
| `CLIPSPIKE_KEYCHAIN=0` | Do not read the OS credential store. |
| `CLIPSPIKE_PRIORITY` | `normal` or `belowNormal` CPU priority for the export and 9:16 encodes (default: `belowNormal` on Windows, `normal` elsewhere). The live recorder is always at normal priority. |

## Events (stdout)

One JSON object per line. Every event has `type` and `at` (ISO timestamp). `background.cjs` also adds `platform` (`twitch` or `kick`). Unknown fields should be ignored; new ones may be added.

### Recorder (`background.cjs`)

| `type` | When | Main fields |
|---|---|---|
| `ready` | Capture is set up | `channel`, `output`, `temp`, `version`, `sessionId`, `profileVersion`, `settings`, `reframe`, `storage` |
| `status` | Every sampling tick, and on state changes | `recording`, `joined`, `mediaTime`, `participants`, `reactions`, `messages`, `score`, `threshold`, `trigger`, `reasons`; also `exporting`/`target` while exporting, `stopping` while shutting down, `emotes`/`channelEmotes` after emote loads |
| `free-tier` | The free plan is active (no valid license) | Weekly allowance from `lib/freetier.js`: how many clean clips remain this week before clips are watermarked. Emitted by both `background.cjs` and `vod.cjs`. |
| `clip-requested` | A clip was triggered | `clipId`, `reason`, `trigger` (`auto`, `manual`, `command`, `raid`), `center`, `participants` |
| `clip-exported` | The landscape clip was written | `path`, `sidecar`, `metadata` |
| `clip-reframed` | The 9:16 clip was written | `path`, `width`, `height`, `sidecar` |
| `clip-uploading` | An upload started | `provider`, `path`, `folder`, `channel` |
| `clip-uploaded` | An upload finished and its size was confirmed | `provider`, `remotePath`, `fileId`, `bytes`, `webLink`, `localPath`; `clipId` and `queued: true` for a retried upload |
| `clip-deleted` | Local files were removed after upload | `provider`, `paths`, `complete`, `keptLocal`, `sidecar` |
| `clip-saved` | The clip is finished (local or cloud) | `path`, `provider`, `remotePath`, `webLink`, `deletedLocal`, `reframed`, `queued`, `sidecar`, `metadata`, `count` |
| `clip-failed` | A clip could not be made | `error`, `reason` |
| `queue-updated` | The retry queue changed | `items` |
| `history-updated` | The clip history changed | `items` |
| `missed-moment` | The user marked a missed moment | `message` |
| `review-ready` | A session ended with enough ratings to review | session summary |
| `error` | Recoverable problem; capture continues | `message` |
| `fatal` | Unrecoverable; the process exits right after | `message` |

### Past broadcast (`vod.cjs`)

`vod.cjs` also emits `clip-requested`, `clip-failed`, `clip-saved`, `history-updated`, `review-ready`, `error` and `fatal` (same shapes, `trigger` is `vod`), plus:

| `type` | When | Main fields |
|---|---|---|
| `vod-info` | The VOD was looked up | `channelName`, `title`, `lengthSeconds`, `url`, `version` |
| `vod-download-progress` | Video download | `fraction`, `path`, `done`, `bytes` |
| `vod-chat-progress` | Chat replay download | `fraction`, `comments`, `done`, `path` |
| `vod-moments` | Chat was scanned | `total`, `strong`, `moments`, `activity`, `windowSec` |
| `caption-model-progress` | The captions model is downloading | `fraction`, `bytes`, `total` |
| `caption-progress` | Captioning one moment | `index`, `stage` (`transcribing`, `transcribed`), `at`, `cues`, `seconds` |
| `vod-done` | The run finished | `saved`, `total`, `folder`, `chat` |

## Commands (stdin, `background.cjs` with `CLIPSPIKE_COMMANDS=1`)

One command per line, case-insensitive, unknown lines ignored.

| Command | Same as | Effect |
|---|---|---|
| `save` | `SIGUSR2` | Save a highlight now. Emits `error` if the buffer is not ready or an export is running. |
| `missed` | `SIGUSR1` | Mark the current moment as missed (`missed-moment`). |
| `stop` | `SIGINT` / `SIGTERM` | Stop capture cleanly. |

Closing stdin also stops the engine, so a host that exits does not leave a recorder running.

On macOS and Linux the signals still work. Windows hosts must use stdin commands and `child.kill()` only as a last resort.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Stopped normally |
| `1` | Fatal runtime error (a `fatal` event was emitted) |
| `2` | Bad arguments or setup (invalid channel, Kick relay not paired) |
