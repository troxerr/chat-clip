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
