# Live alerts

Everything is off by default and works on static hosting (GitHub Pages). No paid services.

## In-app (browser notifications)
- Bell **Follow** buttons (clip cards, clip page, Streamers page) save follows in `localStorage` (`clipspike.follows`, max 25). Nothing leaves the browser.
- Turn on **Notify me when streamers go live** on the Streamers page; the browser asks for permission only then.
- While a tab is open, the app polls `data/status.json` and notifies on offline -> live for followed streamers (all monitored streamers if you follow nobody). Followed streamers must be listed in `config/streamers.json` to have data.

## Email / Discord signup (Pro page)
The "Live alerts by email or Discord" section appears only if `VITE_WAITLIST_ENDPOINT`, `VITE_WAITLIST_EMAIL` or `VITE_DISCORD_INVITE_URL` is set (repository Variables; see `docs/MONETIZATION.md`).
- Email is posted to the existing waitlist endpoint (or mailto fallback) with `source: clipspike-web-alerts` and `streamers` (comma-separated). Requires an explicit consent checkbox.
- `VITE_DISCORD_INVITE_URL` (an `https://discord.gg/...` or discord.com invite) adds a "Join our Discord" link. Other hosts are ignored.
- Email/Discord sending is not automated yet; the signup only collects interest for Pro.

## Discord webhook Action (optional)
`.github/workflows/discord-live-alerts.yml` runs every 10 minutes, fetches the deployed `status.json` and posts "X went live" via `web/scripts/discord-live-alerts.mjs` when a streamer flips offline -> live.
1. In Discord: channel settings -> Integrations -> Webhooks -> copy URL.
2. Add it as repository **secret** `DISCORD_WEBHOOK_URL`. Without it the job does nothing.
3. Optional variable `ALERTS_STATUS_URL` overrides `https://clipspike.com/app/data/status.json`.

The webhook URL is never printed; only HTTP status codes are logged. The previous snapshot is kept in the Actions cache, so the first run only records a baseline. Posts disable mentions.
