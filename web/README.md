# ClipSpike Web

Vite + React + TypeScript app with React Router and Zustand.

```sh
cd web
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

## Structure

- `src/components/` – shared UI (`Layout`: header/nav/main/footer)
- `src/pages/` – route components (Home, Clips, About, NotFound for `*`)
- `src/store/` – Zustand stores (`useClipStore` sample state)

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` runs on pushes to `main` that touch `web/**` or `site/**`
(or manually). Pages allows one deployment per repo, so the workflow builds this app with
`VITE_BASE=/app/` and publishes it alongside the marketing `site/`:

- Marketing site: https://clipspike.com/
- Web app: https://clipspike.com/app/

Client-side routing: the app uses `BrowserRouter` with the Vite base as basename (URLs like
`/app/clips`). GitHub Pages has no rewrites, so the root-level `site/404.html` (Pages only serves
a 404 page from the site root, not from `/app/`), which stashes the requested path in `sessionStorage` and
redirects to the app root; `src/lib/legacyRoutes.ts` restores it. Old `/app/#/clips` links
are rewritten to `/app/clips` on load. The Twitch embed `parent` values are hostnames only,
so they are unaffected by paths.

Pages is already enabled with the "GitHub Actions" source. To test locally:
`VITE_BASE=/app/ npm run build && VITE_BASE=/app/ npm run preview`.

## Streamers

The `#/streamers` page lets you add/remove streamers, pick the primary and reorder backups. Choices
are saved in this browser (`localStorage`, key `clipspike.streamers`). Defaults live in one shared
file, `../config/streamers.json`, read by both the app and `scripts/fetch-twitch-data.mjs`.

**`config/streamers.json` is what drives live data.** The scheduled job only fetches the streamers
listed there; streamers added in the UI are local-only and show "No data yet" until you add them to
that file and redeploy.

## Real Twitch data

`scripts/fetch-twitch-data.mjs` gets an app access token (client-credentials) and calls Helix
Get Streams, Get Users, Get Clips and Get Games for the streamers in `config/streamers.json`, writing
`public/data/status.json` and `public/data/clips.json` (both with `generatedAt`). These files are
gitignored and generated at deploy time, so nothing is committed on each run.

- `pages.yml` also runs on a 5-minute cron and on `workflow_dispatch`; it runs the script with the
  `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` repo secrets before the build. The secrets only exist
  in the CI step and never reach the browser bundle.
- The app fetches `${BASE_URL}data/*.json` on load and every 60s; live status drives backup fallback.
  If the fetch fails it shows the bundled mock data with a "Demo data" badge.
- Twitch exposes no highlight score, so scores are derived from clip views; clip text/thumbnail/link come from Twitch.
- Locally: `TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… node scripts/fetch-twitch-data.mjs`, then `npm run dev`.

## Sharing and link previews

`index.html` carries Open Graph / Twitter card tags (absolute URLs under
`https://clipspike.com/app/`) and `public/og-image.png` (1200x630, regenerate with
`python3 scripts/generate-og-image.py`).

**Crawlers don't see hash routes.** Everything after `#` is never sent to the server, so every
`#/clips/...` URL previews as the app root. The clip-detail **Share** button therefore shares the
Twitch clip URL (rich Twitch preview) when the clip has one, else the app root. It uses
`navigator.share` and falls back to copying the link to the clipboard with a short confirmation.
