import { useState, type FormEvent } from 'react'
import { monetization } from '../monetization'
import { track } from '../monetization/analytics'
import type { MonetizationConfig } from '../monetization/config'
import { isEmail, joinWaitlist, mailtoHref, type WaitlistResult } from '../monetization/waitlist'
import { useFollowStore } from '../store/useFollowStore'

/** Email / Discord live alerts signup. Renders nothing unless a waitlist endpoint, mailto or Discord invite is configured. */
export default function LiveAlertsSignup({ config = monetization }: { config?: MonetizationConfig }) {
  const follows = useFollowStore((s) => s.follows)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WaitlistResult | null>(null)
  const canEmail = !!(config.waitlist.endpoint || config.waitlist.email)
  const discord = config.discordInviteUrl
  if (!canEmail && !discord) return null

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (new FormData(e.currentTarget).get('_gotcha')) return
    if (!isEmail(email)) return setError('Enter a valid email address.')
    if (!follows.length) return setError('Follow at least one streamer first.')
    if (!consent) return setError('Please agree to be emailed so we can send alerts.')
    setError('')
    setBusy(true)
    const r = await joinWaitlist(email.trim(), config, fetch, { streamers: follows, source: 'clipspike-web-alerts' })
    setBusy(false)
    setResult(r)
    if (r !== 'unavailable') track('alerts_signup_submit', { via: r }, config)
    if (r === 'mailto') window.location.href = mailtoHref(config.waitlist.email, email.trim(), follows)
  }

  return (
    <section className="waitlist" aria-labelledby="alerts-h">
      <h2 id="alerts-h">Live alerts by email or Discord</h2>
      <p className="meta">
        {follows.length
          ? `Streamers you follow: ${follows.join(', ')}.`
          : 'Follow streamers with the bell buttons first, then sign up here.'}{' '}
        Email and Discord alerts are part of the Pro waitlist and aren&apos;t sending yet. We&apos;ll tell you when they start.
      </p>
      {canEmail &&
        (result === 'sent' ? (
          <p role="status" className="ok">Thanks! We&apos;ll alert you once live alerts launch.</p>
        ) : result === 'mailto' ? (
          <p role="status" className="ok">
            Your email app should open. If not,{' '}
            <a href={mailtoHref(config.waitlist.email, email.trim(), follows)}>send the email manually</a>.
          </p>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <label className="field">
              <span>Email for live alerts</span>
              <input
                type="email"
                name="alerts-email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
            <label>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Email me when the
              streamers I follow go live, and about Pro. I can unsubscribe at any time.
            </label>
            {error && <p role="alert" className="field-error">{error}</p>}
            {result === 'unavailable' && (
              <p role="alert" className="field-error">Could not sign up right now. Please try again later.</p>
            )}
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Signing up…' : 'Sign up for alerts'}</button>
          </form>
        ))}
      {discord && (
        <p>
          <a
            className="btn btn-ghost"
            href={discord}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('discord_join_click', undefined, config)}
          >
            Join our Discord
          </a>
        </p>
      )}
    </section>
  )
}
