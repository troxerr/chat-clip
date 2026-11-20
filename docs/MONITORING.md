# Capture monitoring and learning

Open **Monitor…** on Capture, or **Chatclip → Capture Monitor…** (Command–Shift–M).
Monitoring starts with every live capture in this build. A previously running build must finish its session before switching; changing source does not instrument an already running recorder.

## What is recorded

Every five seconds: unique participants, reactions, message count, detector score/baseline/threshold, accepted or suppressed decisions, warmup, busy state, cooldown, video age and chat connection. Export/upload/failure events are recorded separately. No raw chat text, usernames, credentials or video is sent to an AI service. Existing Twitch and selected storage connections still work normally.

Monitoring disk writes and replay evaluation run in a worker thread. The recorder caps outstanding monitoring messages at 128; a broken monitor or slow disk cannot block capture. The monitor reports dropped messages. Exports no longer block the five-second sampler; capture still permits only one pending/exporting clip at a time.

The window shows recorder health, recent chat activity, capture/export/failure counts, dataset size, candidate settings and the reason automatic tuning is waiting. Reports refresh every minute during capture, at session end, or with **Refresh Report**.

## Teach the detector

- Use thumbs up/down in **Clips** for useful/useless moments. Clicking the same thumb clears its rating.
- Right-click a clip for **Duplicate**, **Started Late**, or **Ended Early**. Duplicate is a negative selection label. Boundary feedback is reported for review; it does not silently alter clip length.
- During live capture, **Mark Missed Moment** records the current timestamp as an explicit positive label. It does not create or recover footage. Review the VOD if available; the recorder's short rolling buffer is not an archive.
- Opening, revealing, uploading or deleting a clip does not count as a good/bad rating.

## Automatic tuning

Enabled by default; pause it with the checkbox in Capture Monitor. It only stages per-channel configuration changes for the **next** capture. Nothing edits code or modifies current capture settings.

Only automatically triggered live clips with linked monitoring windows train selection. Older clips without window IDs and VOD picks remain in existing history/feedback but are excluded from this model. Explicit missed-moment markers near an eligible recorded window can add a positive label. Active sessions are excluded until completed.

Before staging a change, require:

1. At least 30 explicit labels across six completed, rated live sessions.
2. At least 20 training labels and 10 validation labels from the two latest rated sessions.
3. At least two positive and two negative labels in each set.
4. Choose one candidate using training only; require utility improvement of at least 0.08 on training and later sessions.
5. Retain at least 90% of explicitly good moments on both sets, and allow at most 10% + one extra predicted trigger.
6. Do not reuse validation sessions for another promotion. Reject stale reports.

One parameter changes per promotion. Hard limits relative to the shipped detector:

| Parameter | Allowed range | Step |
| --- | --- | --- |
| Sensitivity | 0.75–1.25 | 0.10 |
| Minimum reaction share | 0.30–0.40 | 0.025 |
| Automatic cooldown | 270–330 seconds | 30 seconds |

Utility is `(kept good − kept bad − missed good) / rated labels`. It is an evaluation measure, not a probability of virality. Replay reproduces warmup, reconnect resets, observed busy/outage windows and moderator/raid cooldown effects. It cannot reconstruct video quality for unknown moments, estimate every counterfactual exporter delay, or prove social performance. Current observational labels favor existing detections; missed-moment feedback helps reduce that bias. The small data gate is a practical safeguard, not statistical proof.

**Rollback & Pause Tuning** restores the previous profile (or the shipped default) and pauses further automatic staging. The current session remains unchanged. Resume intentionally with the checkbox.

## Files and retention

Under `~/Library/Application Support/Highlight Desk/` (or `HIGHLIGHT_DESK_STATE`):

- `feedback.jsonl`: existing session/clip feedback, plus explicit labels and missed markers.
- `monitoring/sessions/`: aggregate decision/pipeline logs, rotated at 4 MiB, retained for 30 days and at most 120 files when a new monitoring session starts. Active session files are retained.
- `monitoring/live/<session>.json`: health snapshot; old snapshots expire after seven days at startup.
- `monitoring/reports/<channel>.json`: latest evaluation.
- `monitoring/profiles/<channel>.json`: bounded next-capture settings and one prior version.
- `monitoring/preferences.json`: automatic-tuning preference.

Evaluation reads at most 60 recent files per channel, 100,000 windows, and the latest 16 MiB of feedback. Truncated or malformed log lines are ignored. Permissions are private to the current user. No clips or existing upload records are removed by monitoring retention.

## Terminal

```sh
npm run monitor -- your_channel
npm run monitor -- your_channel --json
npm run monitor -- your_channel --pause
npm run monitor -- your_channel --resume
npm run monitor -- your_channel --rollback
npm run test:monitor
```

CLI reports can stage a qualified change while automatic tuning is enabled. Pause/rollback affect the next capture, never the running detector. A stale profile lock after an interrupted write prevents tuning rather than capture; after confirming no evaluator is running, remove only that channel's `.json.lock` file to resume staging.
