import { describe, expect, it } from 'vitest'
import { clipItemList, headTags, jsonLdScript, normalizePath, pageMeta, pageUrl, prerenderPaths, type SeoContext } from './seo'

const ctx: SeoContext = {
  streamers: ['jynxzi', 'xqc'],
  clips: [
    { id: 'a', title: 'Clutch </script>', streamer: 'Jynxzi', game: 'Rocket League', createdAt: '2026-11-20T10:00:00Z', duration: 29.6, views: 500, thumbnailUrl: 'https://t/a.jpg', url: 'https://clips.twitch.tv/a' },
    { id: 'b', title: 'No thumb', streamer: 'xqc', createdAt: '2026-11-20T10:00:00Z', views: 900 },
  ],
}

describe('seo', () => {
  it('builds trailing-slash canonical urls under the base', () => {
    expect(pageUrl('/app/', '/')).toBe('https://clipspike.com/app/')
    expect(pageUrl('/app/', '/clips')).toBe('https://clipspike.com/app/clips/')
    expect(normalizePath('/clips/?x=1')).toBe('/clips')
  })

  it('prerenders every static page and a page per configured streamer', () => {
    expect(prerenderPaths(ctx)).toEqual(['/', '/clips', '/streamers', '/pro', '/about', '/privacy', '/terms', '/streamer/jynxzi', '/streamer/xqc'])
  })

  it('gives streamer pages a unique title, canonical and VideoObject list', () => {
    const m = pageMeta('/streamer/jynxzi/', '/app/', ctx)
    expect(m.title).toContain('Jynxzi')
    expect(m.indexable).toBe(true)
    const tags = headTags(m, '/app/')
    expect(tags.find((t) => t.attrs.rel === 'canonical')?.attrs.href).toBe('https://clipspike.com/app/streamer/jynxzi/')
    const ld = jsonLdScript(m)
    expect(ld).toContain('VideoObject')
    expect(ld).toContain('PT30S')
    expect(ld).not.toContain('</script>')
  })

  it('skips clips without a thumbnail and emits WebSite + Organization on the home page', () => {
    expect(JSON.stringify(clipItemList(ctx.clips))).not.toContain('No thumb')
    expect(clipItemList([])).toBeNull()
    const home = jsonLdScript(pageMeta('/', '/app/', ctx))
    expect(home).toContain('"WebSite"')
    expect(home).toContain('"Organization"')
  })

  it('marks unknown paths, unlisted streamers and clip permalinks noindex', () => {
    for (const p of ['/nope', '/streamer/someoneelse', '/clips/123']) {
      const m = pageMeta(p, '/app/', ctx)
      expect(m.indexable).toBe(false)
      expect(headTags(m, '/app/').find((t) => t.attrs.name === 'robots')?.attrs.content).toBe('noindex,follow')
    }
  })
})
