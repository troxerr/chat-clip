# ChatClip Web

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

Client-side routing: `BrowserRouter` uses `import.meta.env.BASE_URL` as its basename.
Deep links (e.g. `/chat-clip/app/clips`) hit GitHub's root `404.html`, which redirects to
`/chat-clip/app/?/clips`; a small script in `index.html` restores the path.
`public/404.html` is copied to the site root by the workflow.

Pages is already enabled with the "GitHub Actions" source. To test locally:
`VITE_BASE=/chat-clip/app/ npm run build && VITE_BASE=/chat-clip/app/ npm run preview`.
