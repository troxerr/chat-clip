import { useEffect, useState, type FormEvent } from 'react'
import LiveAlertsSignup from '../components/LiveAlertsSignup'
import { monetization } from '../monetization'
import { track } from '../monetization/analytics'
import { publicOffer } from '../monetization/offer'
import type { MonetizationConfig } from '../monetization/config'
import { isEmail, joinWaitlist, mailtoHref, type WaitlistResult } from '../monetization/waitlist'

export default function Pro({ config = monetization, mac = false }: { config?: MonetizationConfig; mac?: boolean }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WaitlistResult | null>(null)
  const fallbackAddress = config.waitlist.email || (mac ? 'support@clipspike.com' : '')
  const canSubmit = !!(config.waitlist.endpoint || fallbackAddress)
  const signupMail = mailtoHref(fallbackAddress, email.trim(), [], 'ClipSpike for macOS waitlist')

  useEffect(() => {
    if (canSubmit) track('pro_waitlist_view', undefined, config)
  }, [canSubmit, config])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    if (busy || data.get('_gotcha')) return
    if (!isEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setBusy(true)
    const r = await joinWaitlist(email.trim(), {
      ...config,
      waitlist: { ...config.waitlist, email: fallbackAddress },
    }, fetch, { source: 'clipspike-macos' })
    setBusy(false)
    setResult(r)
    if (r !== 'unavailable') track('pro_waitlist_submit', { via: r }, config)
    if (r === 'mailto' && !mac) window.location.href = signupMail
  }

  return (
    <>
      <h1>{mac ? 'ClipSpike for macOS waitlist' : 'ClipSpike Pro'}</h1>
      {mac ? (
        <p className="meta">Get an email when ClipSpike is available for Macs with Apple Silicon.</p>
      ) : (
        <>
          <p className="pro-lede">
            Capture Twitch chat spikes as vertical clips on Windows. Try it free for {publicOffer.trialDays} days.
          </p>
          <p className="meta">A {publicOffer.priceLabel} {publicOffer.billing} license covers {publicOffer.computers} computers. Web clip browsing is free.</p>
          <div className="hero-actions">
            <a className="btn" href="/windows.html" onClick={() => track('windows_trial_click', { entry: 'pro' }, config)}>
              Download Windows free trial
            </a>
            {config.checkoutUrl && (
              <a
                className="btn btn-ghost"
                href={config.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('pro_checkout_click', { entry: 'pro' }, config)}
              >
                Get ClipSpike Pro
              </a>
            )}
          </div>
        </>
      )}
      {canSubmit ? (
        <section className="waitlist" aria-label={mac ? 'macOS signup form' : undefined} aria-labelledby={mac ? undefined : 'waitlist-h'}>
          {!mac && <h2 id="waitlist-h">Join the macOS waitlist</h2>}
          {result === 'sent' ? (
            <p role="status" className="ok">Thanks! You&apos;re on the list.</p>
          ) : result === 'mailto' ? (
            <p role="status" className="ok">
              {mac ? 'To finish joining, ' : 'If your email app did not open, '}
              <a href={signupMail}>{mac ? 'send your request by email' : 'send the email manually'}</a>.
            </p>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'waitlist-err' : undefined}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
              {error && <p id="waitlist-err" role="alert" className="field-error">{error}</p>}
              {result === 'unavailable' && (
                <p role="alert" className="field-error">Could not join right now. Please try again later.</p>
              )}
              <button type="submit" className="btn" disabled={busy} onClick={() => track('pro_cta_click', undefined, config)}>
                {busy ? 'Joining…' : mac && !config.waitlist.endpoint ? 'Continue by email' : 'Notify me'}
              </button>
              <p className="meta">We only use your email to tell you about macOS availability. <a href="/privacy.html">Privacy Policy</a></p>
            </form>
          )}
        </section>
      ) : null}
      {!mac && <LiveAlertsSignup config={config} />}
    </>
  )
}
