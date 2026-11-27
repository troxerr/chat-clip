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
- Creator guide and sample: https://clipspike.com/capture.html
- Web app: https://clipspike.com/app/

Client-side routing: the app uses `BrowserRouter` with the Vite base as basename (URLs like
`/app/clips`). GitHub Pages has no rewrites, so the root-level `site/404.html` (Pages only serves
a 404 page from the site root, not from `/app/`), which stashes the requested path in `sessionStorage` and
redirects to the app root; `src/lib/legacyRoutes.ts` restores it. Old `/app/#/clips` links
are rewritten to `/app/clips` on load. The Twitch embed `parent` values are hostnames only,
so they are unaffected by paths.

## SEO and prerendering

GitHub Pages answers unknown paths with HTTP 404 (the root `404.html` fallback), so deep links
would not be indexed. `scripts/prerender.ts` (a Vite plugin) therefore emits real
`<route>/index.html` files (HTTP 200) after every build for `/`, `clips`, `streamers`, `pro`,
`about`, `privacy`, `terms` and one `streamer/<login>/` page per login in `../config/streamers.json`.
Each has its own `<title>`, description, canonical (trailing-slash URL), Open Graph/Twitter tags,
JSON-LD (WebSite + Organization on home, BreadcrumbList, and an ItemList of VideoObject clips on
`clips` and streamer pages when `dist/data/clips.json` exists; mature and thumbnail-less clips are skipped)
and a crawlable static body inside `#root`, which React replaces on boot. It also writes
`dist/sitemap.xml` (served at `/app/sitemap.xml`); `site/sitemap.xml` is a sitemap index pointing at it
and `site/sitemap-site.xml`. The build also emits watch pages with clip-specific social images for eligible clips in the current feed.
The 12 highest-view eligible clips have a non-autoplay player, VideoObject metadata, and sitemap entries
for the indexing pilot. Other watch pages and unlisted streamers get `noindex`. Use Search Console
URL Inspection to verify streamer pages and the pilot watch pages after deployment.

Metadata lives in `src/lib/seo.ts` and is shared with `src/components/RouteHead.tsx`, which keeps
the head in sync during client-side navigation. To add an indexable route, add it to `STATIC_PAGES`
in `seo.ts` (and the router). Analytics setup: `../docs/MONETIZATION.md` section 6.

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
- Failed feed fetches fail the build, leaving the last successful Pages deployment intact.
- The independent `site-health.yml` workflow checks public reachability, feed age, and the featured watch
  page. Run `node web/scripts/check-public-site.mjs` from the repository root to check it on demand.
- The app fetches `${BASE_URL}data/*.json` on load and every 60s; live status drives backup fallback.
  If the fetch fails it shows the bundled mock data with a "Demo data" badge.
- Twitch exposes no highlight score, so scores are derived from clip views; clip text/thumbnail/link come from Twitch.
- Locally: `TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… node scripts/fetch-twitch-data.mjs`, then `npm run dev`.

## Sharing and link previews

Clip shares copy the ClipSpike watch URL with a source marker for aggregate attribution. The canonical
URL excludes the marker. Eligible clips receive page-specific previews at build time. A clip outside
the current feed displays an expired or removed message and a link back to the feed.

When Plausible is configured, the existing analytics consent setting also applies to the marketing
pages. Measure the viewer funnel with `homepage_clip_play` and `clip_play` (entry `homepage`), creator
downloads with `windows_download` (entry `creator`), and share traffic with `clip_play` (entry
`shared_link`). The following cohort events use a date bucket and a local marker. These events count
intent to play or download. The Windows app records sample and first real exports in local diagnostics.
