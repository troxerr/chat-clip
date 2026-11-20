# Monitoring integration validation

Validated November 16, 2026.

- `npm run check`: all JavaScript syntax checks pass, including new monitoring modules.
- `npm test` on the Mac: **144/144 pass**, no failures/skips. The restricted shell initially blocked two loopback callback tests and two VideoToolbox fixture tests; the same suite passed on the Mac directly.
- Eleven monitoring tests cover training/validation separation, low-data rejection, active-session exclusion, bounded profiles, stale reports, validation reuse, rollback, channel isolation, explicit ratings, missed markers, worker persistence/failure, actual capture sampling during exports, non-blocking exports, linked window IDs and cooldown/disconnection decisions.
- Native arm64 app builds with a standalone Node 24.22.1 runtime. The build detects Homebrew Node versions that depend on an unbundled libnode and falls back to a standalone installation. Bundled Node execution and the packaged report CLI pass.
- Deep/strict local ad-hoc signature verification passes for the packaged app. The build uses an existing prebuilt icon if this environment's iconutil rejects its generated iconset. A temporary build folder avoids file-provider Finder metadata interfering with signing.
- Isolated native UI check: Monitor button/window, report loading, tuning pause/resume and rollback-to-default/pause verified. Test used temporary config/state, disabled Keychain/notifications, and started no recorder.
- Existing captures, source tree at `<source tree>`, user config, cloud credentials and existing output were not modified. Integration source is `<integration source>`.

No new live Twitch recording or real cloud upload was started during validation. Automatic improvement still needs future explicitly rated live sessions; historical clips without linked monitoring windows cannot train this evaluator.

The packaged app is a local development build, not a notarized commercial release.
