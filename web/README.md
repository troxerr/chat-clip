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
`VITE_BASE=/chat-clip/app/` and publishes it alongside the marketing `site/`:

- Marketing site: https://troxerr.github.io/chat-clip/
- Web app: https://troxerr.github.io/chat-clip/app/

Client-side routing: the app uses `HashRouter` (URLs like `/chat-clip/app/#/clips`), so deep
links work on GitHub Pages without server rewrites or a 404 fallback.

Pages is already enabled with the "GitHub Actions" source. To test locally:
`VITE_BASE=/chat-clip/app/ npm run build && VITE_BASE=/chat-clip/app/ npm run preview`.

## Real Twitch data

`scripts/fetch-twitch-data.mjs` gets an app access token (client-credentials) and calls Helix
Get Streams, Get Users, Get Clips and Get Games for Jynxzi plus the backups, writing
`public/data/status.json` and `public/data/clips.json` (both with `generatedAt`). These files are
gitignored and generated at deploy time, so nothing is committed on each run.

- `pages.yml` also runs on a 5-minute cron and on `workflow_dispatch`; it runs the script with the
  `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` repo secrets before the build. The secrets only exist
  in the CI step and never reach the browser bundle.
- The app fetches `${BASE_URL}data/*.json` on load and every 60s; live status drives backup fallback.
  If the fetch fails it shows the bundled mock data with a "Demo data" badge.
- Twitch exposes no highlight score, so scores are derived from clip views; clip text/thumbnail/link come from Twitch.
- Locally: `TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… node scripts/fetch-twitch-data.mjs`, then `npm run dev`.
