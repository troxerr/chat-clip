import { useEffect, useRef } from 'react'
import { isHttpUrl, type MonetizationConfig } from './config'
import { monetization } from './index'
import { useConsent } from './consent'
import { track } from './analytics'

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

function AdSense({ client, slot }: { client: string; slot: string }) {
  const pushed = useRef(false)
  useEffect(() => {
    const src = `${ADSENSE_SRC}?client=${encodeURIComponent(client)}`
    if (!document.querySelector(`script[src="${src}"]`)) {
      const s = document.createElement('script')
      s.async = true
      s.crossOrigin = 'anonymous'
      s.src = src
      document.head.appendChild(s)
    }
    if (pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle ||= []).push({})
    } catch {
      /* ad blockers or script errors must never break the page */
    }
  }, [client])
  return <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
}

export type Placement = 'grid' | 'sidebar'

export default function SponsorSlot({
  config = monetization,
  placement = 'grid',
}: {
  config?: MonetizationConfig
  placement?: Placement
}) {
  const consent = useConsent()
  if (!config.adsEnabled) return null
  // The sidebar unit is the page header on narrow screens; don't serve a hidden ad there.
  if (placement === 'sidebar' && window.matchMedia && !window.matchMedia('(min-width: 769px)').matches) return null
  const { provider, sponsor, adsense } = config.slot
  const slotId = placement === 'grid' ? adsense.gridSlot : adsense.sidebarSlot
  let body = null
  if (provider === 'sponsor' && sponsor.name && isHttpUrl(sponsor.url)) {
    body = (
      <a href={sponsor.url} target="_blank" rel="sponsored noopener noreferrer" onClick={() => track('sponsor_click', { placement })}>
        <b>{sponsor.name}</b>{sponsor.text ? ` — ${sponsor.text}` : ''}
      </a>
    )
  } else if (provider === 'adsense' && adsense.client && slotId && consent.ads) {
    body = <AdSense client={adsense.client} slot={slotId} />
  }
  if (!body) return null
  return (
    <aside className={`sponsor-slot sponsor-${placement}`} aria-label="Advertisement">
      <span className="sponsor-label">Sponsored</span>
      {body}
    </aside>
  )
}
