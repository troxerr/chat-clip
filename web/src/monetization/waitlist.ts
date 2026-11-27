import type { MonetizationConfig } from './config'

export type WaitlistResult = 'sent' | 'mailto' | 'unavailable'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isEmail = (v: string) => EMAIL_RE.test(v.trim())

export interface WaitlistExtras {
  /** Twitch logins the visitor wants live alerts for. */
  streamers?: string[]
  source?: string
}

export function mailtoHref(address: string, email: string, streamers: string[] = [], subject = 'ClipSpike Pro waitlist') {
  const alerts = streamers.length ? ` I want live alerts for: ${streamers.join(', ')}.` : ''
  const body = `Please add ${email} to the ${subject}.${alerts}`
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Posts to the configured endpoint (e.g. Formspree); falls back to mailto, else reports unavailable. */
export async function joinWaitlist(
  email: string,
  config: MonetizationConfig,
  fetchImpl: typeof fetch = fetch,
  extras: WaitlistExtras = {},
): Promise<WaitlistResult> {
  const { endpoint, email: address } = config.waitlist
  if (endpoint) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email,
          source: extras.source ?? 'clipspike-web-pro',
          ...(extras.streamers?.length ? { streamers: extras.streamers.join(',') } : {}),
        }),
      })
      if (res.ok) return 'sent'
    } catch {
      /* fall through to mailto */
    }
  }
  return address ? 'mailto' : 'unavailable'
}
