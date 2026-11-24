import { describe, expect, it } from 'vitest'
import { pageMeta, prerenderPaths, type SeoContext } from '../src/lib/seo'
import { renderPage, renderSitemap } from './prerender'

const template = `<!doctype html><html><head><title>Old</title>
<meta name="description" content="old" />
<link rel="canonical" href="https://clipspike.com/app/" />
<meta property="og:title" content="old" />
<meta name="twitter:title" content="old" />
</head><body><div id="root"></div></body></html>`
const ctx: SeoContext = { streamers: ['xqc'], clips: [] }

describe('prerender', () => {
  it('replaces template head tags and fills the root with crawlable content', () => {
    const html = renderPage(template, pageMeta('/streamer/xqc', '/app/', ctx), '/app/', ctx)
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/rel="canonical"/g)).toHaveLength(1)
    expect(html).toContain('href="https://clipspike.com/app/streamer/xqc/"')
    expect(html).not.toContain('content="old"')
    expect(html).toContain('<div id="root"><main class="prerendered"><h1>xqc Twitch Clips')
    expect(html).toContain('data-seo-jsonld="/streamer/xqc"')
  })

  it('lists every generated page in the sitemap', () => {
    const xml = renderSitemap('/app/', prerenderPaths(ctx), '2026-01-01')
    expect(xml.match(/<loc>/g)).toHaveLength(prerenderPaths(ctx).length)
    expect(xml).toContain('<loc>https://clipspike.com/app/streamer/xqc/</loc>')
  })
})
