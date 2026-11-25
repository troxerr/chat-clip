// Route metadata shared by the build-time prerenderer (scripts/prerender.ts) and the runtime
// head updater (components/RouteHead.tsx), so crawlers and in-app navigation agree.
import { allStreamers, DEFAULT_CONFIG } from './streamerConfig'

export const SITE_ORIGIN = 'https://clipspike.com'
const SITE_NAME = 'ClipSpike'
const OG_IMAGE = 'og-image.png'

export interface SeoClip {
  id: string | number
  title: string
  streamer: string
  game?: string
  createdAt: string
  duration?: number
  views?: number
  url?: string
  thumbnailUrl?: string
}

export interface SeoContext {
  /** Logins that get their own landing page. */
  streamers: string[]
  clips: SeoClip[]
}

export interface PageMeta {
  title: string
  description: string
  /** Route path relative to the app base, e.g. "/clips" or "/streamer/jynxzi". */
  path: string
  indexable: boolean
  ogType: 'website' | 'profile'
  jsonLd: object[]
}

export interface HeadTag {
  tag: 'meta' | 'link'
  attrs: Record<string, string>
}

export const defaultContext = (): SeoContext => ({ streamers: allStreamers(DEFAULT_CONFIG), clips: [] })

export const streamerPath = (login: string) => `/streamer/${login.toLowerCase()}`

interface StaticPage {
  path: string
  title: string
  description: string
}

const STATIC_PAGES: StaticPage[] = [
  {
    path: '/',
    title: `${SITE_NAME} — Live Twitch Highlights`,
    description: 'Live Twitch highlights, ranked by chat activity and views.',
  },
  {
    path: '/clips',
    title: `Twitch Clips & Highlights | ${SITE_NAME}`,
    description: 'Browse the best recent Twitch clips, filtered by streamer, game and time range and ranked by views and chat activity.',
  },
  {
    path: '/streamers',
    title: `Tracked Streamers | ${SITE_NAME}`,
    description: 'See which Twitch streamers ClipSpike tracks, who is live right now, and build your own list with a primary and backups.',
  },
  {
    path: '/pro',
    title: `ClipSpike Pro — Desktop license`,
    description: 'Web clip browsing stays free. ClipSpike Pro is a 7-day trial, then a license to keep capturing in the desktop app.',
  },
  {
    path: '/about',
    title: `About ${SITE_NAME}`,
    description: 'ClipSpike browses Twitch clips. The Windows app watches chat and saves a vertical clip from a spike, a raid, !clip, or Save highlight.',
  },
  {
    path: '/privacy',
    title: `Privacy Policy | ${SITE_NAME}`,
    description: 'How the ClipSpike web app handles data, cookies, embeds and optional analytics and advertising.',
  },
  {
    path: '/terms',
    title: `Terms of Service | ${SITE_NAME}`,
    description: 'The terms that apply to using the ClipSpike web app.',
  },
]

const trimSlashes = (p: string) => p.replace(/^\/+|\/+$/g, '')

/** "/clips/" and "/clips" are the same route; the root is always "/". */
export function normalizePath(path: string): string {
  const t = trimSlashes(path.split(/[?#]/)[0])
  return t ? `/${t}` : '/'
}

/** Absolute, trailing-slash URL: GitHub Pages serves directory index files from the slash form. */
export function pageUrl(base: string, path: string): string {
  const b = trimSlashes(base)
  const p = trimSlashes(path)
  return `${SITE_ORIGIN}/${[b, p].filter(Boolean).join('/')}${b || p ? '/' : ''}`
}

const displayName = (login: string, clips: SeoClip[]) =>
  clips.find((c) => c.streamer.toLowerCase() === login.toLowerCase())?.streamer ?? login

const isoDuration = (s: number) => `PT${Math.max(1, Math.round(s))}S`

function videoObject(c: SeoClip): object | null {
  if (!c.thumbnailUrl || !c.title || Number.isNaN(Date.parse(c.createdAt))) return null
  return {
    '@type': 'VideoObject',
    name: c.title,
    description: `${c.title}${c.game ? ` (${c.game})` : ''} — a Twitch clip from ${c.streamer}.`,
    thumbnailUrl: [c.thumbnailUrl],
    uploadDate: new Date(c.createdAt).toISOString(),
    ...(c.duration ? { duration: isoDuration(c.duration) } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.views != null
      ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WatchAction', userInteractionCount: c.views } }
      : {}),
  }
}

export function clipItemList(clips: SeoClip[], limit = 10): object | null {
  const items = clips.map(videoObject).filter((v): v is object => v !== null).slice(0, limit)
  if (!items.length) return null
  return {
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  }
}

function breadcrumbs(base: string, trail: { name: string; path: string }[]): object {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: SITE_NAME, path: '/' }, ...trail].map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: pageUrl(base, t.path),
    })),
  }
}

const byViews = (a: SeoClip, b: SeoClip) => (b.views ?? 0) - (a.views ?? 0)

export function pageMeta(rawPath: string, base: string, ctx: SeoContext = defaultContext()): PageMeta {
  const path = normalizePath(rawPath)
  const known = STATIC_PAGES.find((p) => p.path === path)
  if (known) {
    const jsonLd: object[] = []
    if (path === '/') {
      jsonLd.push(
        {
          '@type': 'WebSite',
          name: SITE_NAME,
          url: pageUrl(base, '/'),
          description: known.description,
        },
        { '@type': 'Organization', name: SITE_NAME, url: `${SITE_ORIGIN}/`, logo: `${SITE_ORIGIN}/icon.png` },
      )
    } else {
      jsonLd.push(breadcrumbs(base, [{ name: known.title.split(/ [|—] /)[0], path }]))
      if (path === '/clips') {
        const list = clipItemList([...ctx.clips].sort(byViews))
        if (list) jsonLd.push(list)
      }
    }
    return { title: known.title, description: known.description, path, indexable: true, ogType: 'website', jsonLd }
  }

  const m = /^\/streamer\/([^/]+)$/.exec(path)
  if (m && ctx.streamers.some((s) => s.toLowerCase() === m[1].toLowerCase())) {
    const login = m[1].toLowerCase()
    const name = displayName(login, ctx.clips)
    const mine = ctx.clips.filter((c) => c.streamer.toLowerCase() === login).sort(byViews)
    const jsonLd: object[] = [breadcrumbs(base, [{ name: 'Streamers', path: '/streamers' }, { name, path }])]
    const list = clipItemList(mine)
    if (list) jsonLd.push(list)
    return {
      title: `${name} Twitch Clips & Highlights | ${SITE_NAME}`,
      description: `Watch the best recent ${name} Twitch clips and highlights, ranked by views and chat activity on ${SITE_NAME}.`,
      path,
      indexable: true,
      ogType: 'profile',
      jsonLd,
    }
  }

  // Clip permalinks come and go with the data, and unknown paths are 404s: keep both out of the index.
  const isClip = /^\/clips\/[^/]+$/.test(path)
  return {
    title: isClip ? `Twitch Clip | ${SITE_NAME}` : `Page not found | ${SITE_NAME}`,
    description: isClip ? 'Watch this Twitch highlight on ClipSpike.' : 'This page could not be found.',
    path,
    indexable: false,
    ogType: 'website',
    jsonLd: [],
  }
}

/** Paths that get a prerendered page, in sitemap order. */
export function prerenderPaths(ctx: SeoContext = defaultContext()): string[] {
  return [...STATIC_PAGES.map((p) => p.path), ...ctx.streamers.map(streamerPath)]
}

/** Single list of head tags (everything except <title> and JSON-LD) for a page. */
export function headTags(meta: PageMeta, base: string): HeadTag[] {
  const url = pageUrl(base, meta.path)
  const image = pageUrl(base, OG_IMAGE).replace(/\/$/, '')
  const m = (key: 'name' | 'property', k: string, content: string): HeadTag => ({ tag: 'meta', attrs: { [key]: k, content } })
  return [
    m('name', 'description', meta.description),
    m('name', 'robots', meta.indexable ? 'index,follow' : 'noindex,follow'),
    { tag: 'link', attrs: { rel: 'canonical', href: url } },
    m('property', 'og:type', meta.ogType),
    m('property', 'og:site_name', SITE_NAME),
    m('property', 'og:title', meta.title),
    m('property', 'og:description', meta.description),
    m('property', 'og:url', url),
    m('property', 'og:image', image),
    m('property', 'og:image:width', '1200'),
    m('property', 'og:image:height', '630'),
    m('property', 'og:image:alt', `${SITE_NAME} — live Twitch highlights`),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', meta.title),
    m('name', 'twitter:description', meta.description),
    m('name', 'twitter:image', image),
  ]
}

/** Escapes "<" so JSON-LD can never close its own <script> element. */
export function jsonLdScript(meta: PageMeta): string {
  if (!meta.jsonLd.length) return ''
  const graph = { '@context': 'https://schema.org', '@graph': meta.jsonLd }
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}

/** Selector that finds the existing element a head tag would replace. */
export function tagSelector(t: HeadTag): string {
  if (t.tag === 'link') return `link[rel="${t.attrs.rel}"]`
  return t.attrs.name ? `meta[name="${t.attrs.name}"]` : `meta[property="${t.attrs.property}"]`
}
