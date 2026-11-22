// Single source of truth for monetization. Everything is off by default:
// no ad/sponsor markup, no third-party scripts, no tracking.
// See docs/MONETIZATION.md before enabling anything.

export type SlotProvider = 'sponsor' | 'adsense'

export interface MonetizationConfig {
  /** Master switch. When false, SponsorSlot renders nothing and loads nothing. */
  adsEnabled: boolean
  slot: {
    provider: SlotProvider
    /** 'sponsor': static, first-party link (no scripts, no tracking). */
    sponsor: { name: string; url: string; text: string }
    /** 'adsense': loads Google's script, only after consent. Needs both ids. */
    adsense: { client: string; slot: string }
  }
  /** Placeholder donation/support URL; the link is hidden while empty. */
  supportUrl: string
}

export const monetization: MonetizationConfig = {
  adsEnabled: false,
  slot: {
    provider: 'sponsor',
    sponsor: { name: '', url: '', text: '' },
    adsense: { client: '', slot: '' },
  },
  supportUrl: '',
}

export const AD_CONSENT_KEY = 'clipspike:ad-consent'

/** Third-party ad scripts must only run after explicit opt-in (value "granted"). */
export function hasAdConsent(): boolean {
  try {
    return localStorage.getItem(AD_CONSENT_KEY) === 'granted'
  } catch {
    return false
  }
}

export function isHttpUrl(u: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol)
  } catch {
    return false
  }
}
