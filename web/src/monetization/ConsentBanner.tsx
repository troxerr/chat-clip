import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { consentRequired, type MonetizationConfig } from './config'
import { monetization } from './index'
import { resetConsent, setConsent, useConsent } from './consent'
import { initAnalytics } from './analytics'

export function CookieSettingsButton({ config = monetization }: { config?: MonetizationConfig }) {
  if (!consentRequired(config)) return null
  return (
    <button type="button" className="linklike" onClick={resetConsent}>
      Cookie settings
    </button>
  )
}

export default function ConsentBanner({ config = monetization }: { config?: MonetizationConfig }) {
  const consent = useConsent()
  const [custom, setCustom] = useState(false)
  const [ads, setAds] = useState(false)
  const [analytics, setAnalytics] = useState(false)

  useEffect(() => {
    if (consent.analytics) initAnalytics(config)
  }, [consent.analytics, config])

  if (!consentRequired(config) || consent.decided) return null
  return (
    <section className="consent" role="region" aria-labelledby="consent-h">
      <h2 id="consent-h">Your privacy choices</h2>
      <p>
        Advertising and analytics load only if you allow them. Twitch players follow Twitch&apos;s own policies. They load when you press play or when you open a featured watch page.{' '}
        <Link to="/privacy">Privacy Policy</Link>
      </p>
      {custom && (
        <div className="consent-options">
          <label><input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} /> Advertising (Google AdSense)</label>
          <label><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> Analytics (privacy-friendly, aggregated)</label>
        </div>
      )}
      <div className="row consent-actions">
        <button type="button" className="btn" onClick={() => setConsent({ ads: true, analytics: true })}>Accept all</button>
        <button type="button" className="btn btn-ghost" onClick={() => setConsent({ ads: false, analytics: false })}>Reject all</button>
        {custom ? (
          <button type="button" className="btn btn-ghost" onClick={() => setConsent({ ads, analytics })}>Save choices</button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setCustom(true)}>Customize</button>
        )}
      </div>
    </section>
  )
}
