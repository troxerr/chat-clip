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
