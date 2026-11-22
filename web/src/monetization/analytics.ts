import { monetization } from './index'
import { getConsent } from './consent'
import type { MonetizationConfig } from './config'

export type AnalyticsEvent =
  | 'support_click'
  | 'affiliate_click'
  | 'sponsor_click'
  | 'pro_waitlist_view'
  | 'pro_waitlist_submit'
  | 'pro_cta_click'

type Plausible = ((name: string, opts?: { props?: Record<string, string> }) => void) & { q?: unknown[] }
declare global {
  interface Window {
    plausible?: Plausible
  }
}

/** Load the privacy-friendly Plausible script once, only if configured and analytics consent was given. */
export function initAnalytics(config: MonetizationConfig = monetization): boolean {
  const a = config.analytics
  if (a.provider !== 'plausible' || !getConsent().analytics) return false
  if (document.querySelector('script[data-clipspike-analytics]')) return true
  const s = document.createElement('script')
  s.defer = true
  s.src = a.src
  s.dataset.domain = a.domain
  s.dataset.clipspikeAnalytics = 'true'
  document.head.appendChild(s)
  window.plausible ??= Object.assign(
    function (...args: unknown[]) {
      ;(window.plausible!.q ||= []).push(args)
    },
    {},
  ) as Plausible
  return true
}

/** No-op unless analytics is configured and consented. Never sends personal data. */
export function track(event: AnalyticsEvent, props?: Record<string, string>, config: MonetizationConfig = monetization) {
  if (config.analytics.provider !== 'plausible' || !getConsent().analytics) return
  window.plausible?.(event, props ? { props } : undefined)
}
