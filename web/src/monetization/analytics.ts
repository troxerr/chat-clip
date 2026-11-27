import { monetization } from './index'
import { getConsent } from './consent'
import type { MonetizationConfig } from './config'

export type AnalyticsEvent =
  | 'clip_play'
  | 'clip_share'
  | 'follow_cohort_start'
  | 'follow_cohort_day_7_return'
  | 'support_click'
  | 'affiliate_click'
  | 'sponsor_click'
  | 'pro_waitlist_view'
  | 'pro_waitlist_submit'
  | 'pro_cta_click'
  | 'pro_checkout_click'
  | 'windows_trial_click'
  | 'alerts_signup_submit'
  | 'discord_join_click'

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


const FOLLOW_COHORT_KEY = 'clipspike:follow-analytics'
const DAY_MS = 86_400_000

/** Aggregate, consented events. The browser retains only the first-follow timestamp and return flag. */
export function trackFollowCohort(hasFollows: boolean, consent: boolean) {
  try {
    if (!consent) {
      localStorage.removeItem(FOLLOW_COHORT_KEY)
      return
    }
    if (!hasFollows || !initAnalytics()) return
    const now = Date.now()
    const cohort = JSON.parse(localStorage.getItem(FOLLOW_COHORT_KEY) ?? 'null') as
      { started: number; returned?: boolean } | null
    if (!cohort || !Number.isFinite(cohort.started)) {
      localStorage.setItem(FOLLOW_COHORT_KEY, JSON.stringify({ started: now }))
      track('follow_cohort_start', { cohort: new Date(now).toISOString().slice(0, 10) })
    } else if (!cohort.returned && now - cohort.started >= 7 * DAY_MS && now - cohort.started < 8 * DAY_MS) {
      localStorage.setItem(FOLLOW_COHORT_KEY, JSON.stringify({ ...cohort, returned: true }))
      track('follow_cohort_day_7_return', { cohort: new Date(cohort.started).toISOString().slice(0, 10) })
    }
  } catch {
    // Storage can be disabled. Browsing and following still work.
  }
}
