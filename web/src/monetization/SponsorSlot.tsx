import { useEffect } from 'react'
import { hasAdConsent, isHttpUrl, monetization, type MonetizationConfig } from './config'

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'

function AdSense({ client, slot }: { client: string; slot: string }) {
  useEffect(() => {
    const src = `${ADSENSE_SRC}?client=${encodeURIComponent(client)}`
    if (document.querySelector(`script[src="${src}"]`)) return
    const s = document.createElement('script')
    s.async = true
    s.crossOrigin = 'anonymous'
    s.src = src
    document.head.appendChild(s)
  }, [client])
  return <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" />
}

export default function SponsorSlot({ config = monetization }: { config?: MonetizationConfig }) {
  if (!config.adsEnabled) return null
  const { provider, sponsor, adsense } = config.slot
  let body = null
  if (provider === 'sponsor' && sponsor.name && isHttpUrl(sponsor.url)) {
    body = (
      <a href={sponsor.url} target="_blank" rel="sponsored noopener noreferrer">
        <b>{sponsor.name}</b>{sponsor.text ? ` — ${sponsor.text}` : ''}
      </a>
    )
  } else if (provider === 'adsense' && adsense.client && adsense.slot && hasAdConsent()) {
    body = <AdSense client={adsense.client} slot={adsense.slot} />
  }
  if (!body) return null
  return (
    <aside className="sponsor-slot" aria-label="Sponsored">
      <span className="sponsor-label">Sponsored</span>
      {body}
    </aside>
  )
}
