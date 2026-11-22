import { isHttpUrl, type AffiliateItem, type MonetizationConfig } from './config'
import { monetization } from './index'
import { track } from './analytics'

export const AFFILIATE_DISCLOSURE =
  'Disclosure: these are sponsored / affiliate links. ClipSpike may earn a commission if you buy through them, at no extra cost to you. We only list things we would consider useful to streamers and viewers.'

export default function AffiliateCards({
  config = monetization,
  items,
}: {
  config?: MonetizationConfig
  items?: AffiliateItem[]
}) {
  const list = (items ?? config.affiliates).filter((a) => isHttpUrl(a.url))
  if (!config.affiliatesEnabled || list.length === 0) return null
  return (
    <section className="affiliates" aria-labelledby="affiliates-h">
      <h2 id="affiliates-h">Gear &amp; deals <span className="tag">Sponsored</span></h2>
      <p className="meta">{AFFILIATE_DISCLOSURE}</p>
      <ul className="affiliate-list">
        {list.map((a) => (
          <li key={a.id} className="affiliate-card">
            <span className="tag">Sponsored</span>
            <strong>{a.name}</strong>
            <p>{a.blurb}</p>
            <a
              className="btn btn-ghost"
              href={a.url}
              target="_blank"
              rel="sponsored noopener noreferrer"
              onClick={() => track('affiliate_click', { id: a.id })}
            >
              {a.cta ?? 'Learn more'}<span className="sr-only"> about {a.name} (sponsored link, opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
