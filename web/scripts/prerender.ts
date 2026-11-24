// Build-time static generation for GitHub Pages. Pages answers unknown paths with HTTP 404 (via
// the root 404.html fallback), so every indexable route gets a real <path>/index.html with its own
// head tags and JSON-LD, plus a sitemap listing them. The SPA still boots over the static body.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import {
  defaultContext,
  headTags,
  jsonLdScript,
  pageMeta,
  pageUrl,
  prerenderPaths,
  type HeadTag,
  type PageMeta,
  type SeoClip,
  type SeoContext,
} from '../src/lib/seo'
import { parseClips } from '../src/lib/twitchData'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const renderTag = (t: HeadTag) =>
  `<${t.tag} ${Object.entries(t.attrs).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')} />`

/** Removes the head tags the generator owns so the template's defaults are not duplicated. */
function stripManagedHead(html: string): string {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta (?:name|property)="(?:description|robots|og:[^"]*|twitter:[^"]*)"[^>]*>/g, '')
    .replace(/\s*<link rel="canonical"[^>]*>/g, '')
}

export function renderPage(template: string, meta: PageMeta, base: string, ctx: SeoContext): string {
  const head = [
    `<title>${escapeHtml(meta.title)}</title>`,
    ...headTags(meta, base).map(renderTag),
    ...(jsonLdScript(meta) ? [`<script type="application/ld+json" data-seo-jsonld="${escapeHtml(meta.path)}">${jsonLdScript(meta)}</script>`] : []),
  ]
    .map((l) => `    ${l}`)
    .join('\n')

  const nav = prerenderPaths(ctx)
    .map((p) => `<li><a href="${pageUrl(base, p)}">${escapeHtml(pageMeta(p, base, ctx).title.split(/ [|—] /)[0])}</a></li>`)
    .join('')
  const clips = ctx.clips
    .filter((c) => meta.path === '/clips' || meta.path.endsWith(`/${c.streamer.toLowerCase()}`))
    .slice(0, 10)
    .map((c) => `<li>${escapeHtml(c.title)} — ${escapeHtml(c.streamer)}</li>`)
    .join('')
  const heading = meta.title.split(/ [|—] /)[0]
  // React replaces #root's contents on boot; this is the no-JS / crawler-first view.
  const body = `<main class="prerendered"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(meta.description)}</p>${clips ? `<ul>${clips}</ul>` : ''}<nav aria-label="Site"><ul>${nav}</ul></nav></main>`

  return stripManagedHead(template)
    .replace('</head>', `${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
}

export function renderSitemap(base: string, paths: string[], lastmod: string): string {
  const urls = paths.map((p) => `  <url><loc>${pageUrl(base, p)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function loadClips(outDir: string, streamers: string[]): SeoClip[] {
  const file = join(outDir, 'data', 'clips.json')
  if (!existsSync(file)) return []
  try {
    return (parseClips(JSON.parse(readFileSync(file, 'utf8')), streamers) ?? []).filter((c) => !c.mature)
  } catch {
    return []
  }
}

export function prerender(): Plugin {
  let base = '/'
  let outDir = 'dist'
  return {
    name: 'clipspike-prerender',
    apply: 'build',
    configResolved(config) {
      base = config.base
      outDir = config.build.outDir
    },
    writeBundle() {
      const defaults = defaultContext()
      const ctx = { ...defaults, clips: loadClips(outDir, defaults.streamers) }
      const template = readFileSync(join(outDir, 'index.html'), 'utf8')
      const paths = prerenderPaths(ctx)
      for (const path of paths) {
        const dir = path === '/' ? outDir : join(outDir, ...path.split('/').filter(Boolean))
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'index.html'), renderPage(template, pageMeta(path, base, ctx), base, ctx))
      }
      writeFileSync(join(outDir, 'sitemap.xml'), renderSitemap(base, paths, new Date().toISOString().slice(0, 10)))
    },
  }
}
