import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adsenseReady, buildConfig, hasSponsoredContent, consentRequired, type AffiliateItem, type MonetizationConfig } from './config'
import { monetization } from './index'
import { CONSENT_KEY, getConsent, reloadConsent, resetConsent, setConsent } from './consent'
import { initAnalytics, track } from './analytics'
import SponsorSlot from './SponsorSlot'
import SupportLink from './SupportLink'
import AffiliateCards from './AffiliateCards'
import ConsentBanner from './ConsentBanner'
import Pro from '../pages/Pro'
import { joinWaitlist } from './waitlist'

const aff: AffiliateItem[] = [{ id: 'a', name: 'Acme Mic', blurb: 'b', url: 'https://acme.example/x' }]
const adsense = buildConfig(
  { VITE_ADS_ENABLED: 'true', VITE_AD_PROVIDER: 'adsense', VITE_ADSENSE_CLIENT: 'ca-pub-123', VITE_ADSENSE_SLOT_GRID: '42' },
  aff,
)
const plausible = buildConfig({ VITE_ANALYTICS_PROVIDER: 'plausible', VITE_PLAUSIBLE_DOMAIN: 'clipspike.com' }, [])

afterEach(() => {
  localStorage.clear()
  reloadConsent()
  document.head.querySelectorAll('script').forEach((s) => s.remove())
  delete window.plausible
})

describe('config defaults', () => {
  it('ships fully off', () => {
    expect(monetization.adsEnabled).toBe(false)
    expect(monetization.affiliatesEnabled).toBe(false)
    expect(monetization.supportUrl).toBe('')
    expect(monetization.analytics.provider).toBe('none')
    expect(consentRequired(monetization)).toBe(false)
  })

  it('treats empty-string env values (unset GitHub repo variables) the same as unset', () => {
    const names = ['VITE_ADS_ENABLED', 'VITE_AD_PROVIDER', 'VITE_ADSENSE_CLIENT', 'VITE_ADSENSE_SLOT_GRID', 'VITE_ADSENSE_SLOT_SIDEBAR', 'VITE_SPONSOR_NAME', 'VITE_SPONSOR_URL', 'VITE_SPONSOR_TEXT', 'VITE_AFFILIATES_ENABLED', 'VITE_SUPPORT_URL', 'VITE_WAITLIST_ENDPOINT', 'VITE_WAITLIST_EMAIL', 'VITE_ANALYTICS_PROVIDER', 'VITE_PLAUSIBLE_DOMAIN', 'VITE_PLAUSIBLE_SRC']
    const empty = Object.fromEntries(names.map((n) => [n, '']))
    expect(buildConfig(empty, aff)).toEqual(buildConfig({}, aff))
    const c = buildConfig(empty, [])
    expect(c.adsEnabled).toBe(false)
    expect(c.affiliatesEnabled).toBe(false)
    expect(c.slot.provider).toBe('sponsor')
    expect(c.analytics.provider).toBe('none')
    expect(c.supportUrl).toBe('')
    expect(consentRequired(c)).toBe(false)
    const { container } = render(<SponsorSlot config={c} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('validates env values and drops unsafe ones', () => {
    const c = buildConfig(
      { VITE_ADSENSE_CLIENT: 'nope', VITE_SUPPORT_URL: 'javascript:alert(1)', VITE_WAITLIST_EMAIL: 'bad', VITE_PLAUSIBLE_DOMAIN: 'x' },
      [{ id: 'x', name: 'x', blurb: '', url: 'javascript:1' }, ...aff],
    )
    expect(c.slot.adsense.client).toBe('')
    expect(c.supportUrl).toBe('')
    expect(c.waitlist.email).toBe('')
    expect(c.affiliates).toHaveLength(1)
    expect(adsenseReady(c)).toBe(false)
    expect(adsenseReady(adsense)).toBe(true)
  })
})

describe('consent', () => {
  it('persists the choice', () => {
    setConsent({ ads: true, analytics: false })
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY)!)).toMatchObject({ ads: true, analytics: false })
    reloadConsent()
    expect(getConsent()).toEqual({ decided: true, ads: true, analytics: false })
    resetConsent()
    expect(getConsent().decided).toBe(false)
  })

  it('banner is absent when nothing is configured, and rejecting loads nothing', async () => {
    const { container, unmount } = render(<MemoryRouter><ConsentBanner config={monetization} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
    unmount()
    render(<MemoryRouter><ConsentBanner config={plausible} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Reject all' }))
    expect(screen.queryByRole('region')).toBeNull()
    expect(document.querySelector('script[data-clipspike-analytics]')).toBeNull()
    expect(getConsent()).toEqual({ decided: true, ads: false, analytics: false })
  })

  it('accepting loads analytics', async () => {
    render(<MemoryRouter><ConsentBanner config={plausible} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(document.querySelector('script[data-clipspike-analytics]')).not.toBeNull()
  })
})

describe('SponsorSlot', () => {
  it('renders nothing and loads no scripts by default', () => {
    const { container } = render(<SponsorSlot />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a labelled sponsor link', () => {
    const cfg: MonetizationConfig = buildConfig(
      { VITE_ADS_ENABLED: 'true', VITE_SPONSOR_NAME: 'Acme', VITE_SPONSOR_URL: 'https://acme.example' },
      [],
    )
    render(<SponsorSlot config={cfg} />)
    expect(screen.getByLabelText('Advertisement')).toHaveTextContent('Sponsored')
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'sponsored noopener noreferrer')
  })

  it('loads AdSense only after ad consent', () => {
    const { container, unmount } = render(<SponsorSlot config={adsense} />)
    expect(container).toBeEmptyDOMElement()
    expect(document.querySelector('script[src*="googlesyndication"]')).toBeNull()
    unmount()
    act(() => setConsent({ ads: true, analytics: false }))
    render(<SponsorSlot config={adsense} />)
    expect(document.querySelector('script[src*="googlesyndication"]')).not.toBeNull()
    expect(document.querySelector('ins.adsbygoogle')).toHaveAttribute('data-ad-slot', '42')
  })
})

describe('SupportLink', () => {
  it('is hidden until a URL is configured', () => {
    const { container, rerender } = render(<SupportLink />)
    expect(container).toBeEmptyDOMElement()
    rerender(<SupportLink url="https://ko-fi.com/clipspike" />)
    expect(screen.getByRole('link', { name: /Support ClipSpike/ })).toBeInTheDocument()
  })
})

describe('AffiliateCards', () => {
  it('is off by default', () => {
    const { container } = render(<AffiliateCards items={aff} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows disclosure and sponsored rel when enabled', () => {
    const cfg = buildConfig({ VITE_AFFILIATES_ENABLED: 'true' }, aff)
    render(<AffiliateCards config={cfg} />)
    expect(screen.getByText(/Disclosure:/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Acme Mic/ })).toHaveAttribute('rel', 'sponsored noopener noreferrer')
  })
})

describe('analytics', () => {
  it('track is a no-op without config or consent', () => {
    const spy = vi.fn()
    window.plausible = spy as never
    track('support_click', undefined, monetization)
    track('support_click', undefined, plausible)
    expect(spy).not.toHaveBeenCalled()
    expect(initAnalytics(plausible)).toBe(false)
    setConsent({ ads: false, analytics: true })
    track('support_click', { placement: 'x' }, plausible)
    expect(spy).toHaveBeenCalledWith('support_click', { props: { placement: 'x' } })
  })

  it('loads the pageview script once, only after consent, with the configured domain', () => {
    document.head.querySelector('script[data-clipspike-analytics]')?.remove()
    expect(initAnalytics(plausible)).toBe(false)
    expect(document.querySelector('script[data-clipspike-analytics]')).toBeNull()
    setConsent({ ads: false, analytics: true })
    expect(initAnalytics(plausible)).toBe(true)
    expect(initAnalytics(plausible)).toBe(true)
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-clipspike-analytics]')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].dataset.domain).toBe('clipspike.com')
    scripts[0].remove()
  })
})

describe('waitlist', () => {
  const withEndpoint = buildConfig({ VITE_WAITLIST_ENDPOINT: 'https://formspree.io/f/abc', VITE_WAITLIST_EMAIL: 'a@b.co' }, [])

  it('posts JSON to the endpoint, falls back to mailto, else unavailable', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true })
    expect(await joinWaitlist('u@x.co', withEndpoint, ok as never)).toBe('sent')
    expect(ok.mock.calls[0][0]).toBe('https://formspree.io/f/abc')
    const bad = vi.fn().mockRejectedValue(new Error('net'))
    expect(await joinWaitlist('u@x.co', withEndpoint, bad as never)).toBe('mailto')
    expect(await joinWaitlist('u@x.co', monetization, bad as never)).toBe('unavailable')
  })

  it('Pro page validates email and says not open when unconfigured', async () => {
    const { unmount } = render(<Pro config={monetization} />)
    expect(screen.getByText(/isn.t open yet/)).toBeInTheDocument()
    unmount()
    render(<Pro config={withEndpoint} />)
    await userEvent.type(screen.getByLabelText('Email address'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid email')
  })
})

describe('hasSponsoredContent (disclosure)', () => {
  it('is false by default and with only a tip link or analytics', () => {
    expect(hasSponsoredContent(buildConfig({}, aff))).toBe(false)
    expect(hasSponsoredContent(buildConfig({ VITE_SUPPORT_URL: 'https://ko-fi.com/x' }, aff))).toBe(false)
    expect(hasSponsoredContent(plausible)).toBe(false)
    expect(hasSponsoredContent(buildConfig({ VITE_AFFILIATES_ENABLED: 'true' }, []))).toBe(false)
  })

  it('is true for a configured sponsor, AdSense, or affiliates', () => {
    const sponsor = { VITE_ADS_ENABLED: 'true', VITE_SPONSOR_NAME: 'Acme', VITE_SPONSOR_URL: 'https://acme.example' }
    expect(hasSponsoredContent(buildConfig(sponsor, []))).toBe(true)
    expect(hasSponsoredContent(adsense)).toBe(true)
    expect(hasSponsoredContent(buildConfig({ VITE_AFFILIATES_ENABLED: 'true' }, aff))).toBe(true)
  })
})
