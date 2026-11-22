import type { MonetizationConfig } from './config'

export type WaitlistResult = 'sent' | 'mailto' | 'unavailable'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isEmail = (v: string) => EMAIL_RE.test(v.trim())

export function mailtoHref(address: string, email: string) {
  const body = `Please add ${email} to the ClipSpike Pro waitlist.`
  return `mailto:${address}?subject=${encodeURIComponent('ClipSpike Pro waitlist')}&body=${encodeURIComponent(body)}`
}

/** Posts to the configured endpoint (e.g. Formspree); falls back to mailto, else reports unavailable. */
export async function joinWaitlist(
  email: string,
  config: MonetizationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<WaitlistResult> {
  const { endpoint, email: address } = config.waitlist
  if (endpoint) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, source: 'clipspike-web-pro' }),
      })
      if (res.ok) return 'sent'
    } catch {
      /* fall through to mailto */
    }
  }
  return address ? 'mailto' : 'unavailable'
}
