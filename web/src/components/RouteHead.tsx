import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { headTags, jsonLdScript, pageMeta, tagSelector } from '../lib/seo'

const JSONLD_ATTR = 'data-seo-jsonld'

/** Keeps <title>, description, canonical, social and JSON-LD tags in sync with the route (path is relative to the base). */
function applyHead(doc: Document, path: string, base: string) {
  const meta = pageMeta(path, base)
  doc.title = meta.title
  for (const t of headTags(meta, base)) {
    let el = doc.head.querySelector(tagSelector(t))
    if (!el) {
      el = doc.createElement(t.tag)
      doc.head.appendChild(el)
    }
    for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v)
  }
  const existing = doc.head.querySelector(`script[${JSONLD_ATTR}]`)
  // The prerenderer embeds JSON-LD with real clip data for its own path; keep it while on that page.
  if (existing?.getAttribute(JSONLD_ATTR) === meta.path) return
  existing?.remove()
  const json = jsonLdScript(meta)
  if (json) {
    const s = doc.createElement('script')
    s.type = 'application/ld+json'
    s.setAttribute(JSONLD_ATTR, meta.path)
    s.textContent = json
    doc.head.appendChild(s)
  }
}

export default function RouteHead() {
  const { pathname } = useLocation()
  useEffect(() => {
    applyHead(document, pathname, import.meta.env.BASE_URL)
  }, [pathname])
  return null
}
