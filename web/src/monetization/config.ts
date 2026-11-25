// Single source of truth for monetization. Ads, affiliates, tips and analytics stay
// off unless the matching VITE_* env var is set at build time. The desktop checkout
// defaults to the committed Polar offer; a valid https VITE_CHECKOUT_URL overrides it.
// Setup steps per provider: docs/MONETIZATION.md

import { publicOffer } from './offer'

export type SlotProvider = 'sponsor' | 'adsense'

export interface AffiliateItem {
  id: string
  name: string
  blurb: string
  url: string
  cta?: string
}

export interface MonetizationConfig {
  /** Master switch for ad/sponsor slots. */
  adsEnabled: boolean
  slot: {
    provider: SlotProvider
    /** 'sponsor': static, first-party link (no scripts, no tracking). */
    sponsor: { name: string; url: string; text: string }
    /** 'adsense': loads Google's script only after ad consent. client = ca-pub-..., slots are ad unit ids. */
    adsense: { client: string; gridSlot: string; sidebarSlot: string }
  }
  affiliatesEnabled: boolean
  affiliates: AffiliateItem[]
  /** Ko-fi / Buy Me a Coffee / GitHub Sponsors URL; links are hidden while empty. */
  supportUrl: string
  waitlist: { endpoint: string; email: string }
  /** Public Discord invite for the live-alerts channel; the link is hidden while empty. */
  discordInviteUrl: string
  /** https checkout for the desktop license. Empty hides the buy button. */
  checkoutUrl: string
  analytics: { provider: 'none' | 'plausible'; domain: string; src: string }
}

type Env = Record<string, string | undefined>

export function isHttpUrl(u: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol)
  } catch {
    return false
  }
}

const httpOrEmpty = (v: string | undefined) => (v && isHttpUrl(v.trim()) ? v.trim() : '')

/** https only. Junk, http, and other schemes are dropped. Returns the trimmed original, like httpOrEmpty. */
export function httpsOrEmpty(v: string | undefined): string {
  const t = (v ?? '').trim()
  try {
    return t && new URL(t).protocol === 'https:' ? t : ''
  } catch {
    return ''
  }
}
const flag = (v: string | undefined) => v === 'true'

/** Only https links on Discord's own invite hosts are accepted. */
function discordInvite(v: string | undefined): string {
  try {
    const u = new URL((v ?? '').trim())
    const ok = u.protocol === 'https:' && ['discord.gg', 'discord.com', 'www.discord.com'].includes(u.hostname)
    return ok ? u.toString() : ''
  } catch {
    return ''
  }
}

export function buildConfig(env: Env, affiliates: AffiliateItem[]): MonetizationConfig {
  const client = /^ca-pub-\d+$/.test(env.VITE_ADSENSE_CLIENT ?? '') ? env.VITE_ADSENSE_CLIENT! : ''
  const sponsorUrl = httpOrEmpty(env.VITE_SPONSOR_URL)
  const wantsAdsense = env.VITE_AD_PROVIDER === 'adsense'
  const plausibleDomain = (env.VITE_PLAUSIBLE_DOMAIN ?? '').trim()
  const email = (env.VITE_WAITLIST_EMAIL ?? '').trim()
  return {
    adsEnabled: flag(env.VITE_ADS_ENABLED),
    slot: {
      provider: wantsAdsense ? 'adsense' : 'sponsor',
      sponsor: { name: env.VITE_SPONSOR_NAME ?? '', url: sponsorUrl, text: env.VITE_SPONSOR_TEXT ?? '' },
      adsense: {
        client,
        gridSlot: /^\d+$/.test(env.VITE_ADSENSE_SLOT_GRID ?? '') ? env.VITE_ADSENSE_SLOT_GRID! : '',
        sidebarSlot: /^\d+$/.test(env.VITE_ADSENSE_SLOT_SIDEBAR ?? '') ? env.VITE_ADSENSE_SLOT_SIDEBAR! : '',
      },
    },
    affiliatesEnabled: flag(env.VITE_AFFILIATES_ENABLED),
    affiliates: affiliates.filter((a) => a.name && isHttpUrl(a.url)),
    supportUrl: httpOrEmpty(env.VITE_SUPPORT_URL),
    waitlist: {
      endpoint: httpOrEmpty(env.VITE_WAITLIST_ENDPOINT),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    },
    discordInviteUrl: discordInvite(env.VITE_DISCORD_INVITE_URL),
    // Empty or invalid env keeps the committed Polar checkout, so the buy button is on by default.
    checkoutUrl: httpsOrEmpty(env.VITE_CHECKOUT_URL) || publicOffer.checkoutUrl,
    analytics: {
      provider: env.VITE_ANALYTICS_PROVIDER === 'plausible' && plausibleDomain ? 'plausible' : 'none',
      domain: plausibleDomain,
      src: httpOrEmpty(env.VITE_PLAUSIBLE_SRC) || 'https://plausible.io/js/script.js',
    },
  }
}

/** True when ads or analytics are configured, i.e. a consent choice is meaningful. */
export function consentRequired(c: MonetizationConfig): boolean {
  const adsOn = c.adsEnabled && (c.slot.provider === 'adsense' ? !!c.slot.adsense.client : false)
  return adsOn || c.analytics.provider !== 'none'
}

export function adsenseReady(c: MonetizationConfig): boolean {
  return c.adsEnabled && c.slot.provider === 'adsense' && !!c.slot.adsense.client
}

/** True when the site actually shows sponsored, ad or affiliate content (drives the disclosure text). */
export function hasSponsoredContent(c: MonetizationConfig): boolean {
  const sponsor = c.adsEnabled && c.slot.provider === 'sponsor' && !!c.slot.sponsor.name && !!c.slot.sponsor.url
  const affiliates = c.affiliatesEnabled && c.affiliates.length > 0
  return sponsor || adsenseReady(c) || affiliates
}
