import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adsenseReady, buildConfig, hasSponsoredContent, consentRequired, httpsOrEmpty, type AffiliateItem, type MonetizationConfig } from './config'
import { publicOffer } from './offer'
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
  it('ships ads and analytics off, with the public checkout', () => {
    expect(monetization.adsEnabled).toBe(false)
    expect(monetization.affiliatesEnabled).toBe(false)
    expect(monetization.supportUrl).toBe('')
    expect(monetization.analytics.provider).toBe('none')
    expect(monetization.checkoutUrl).toBe(publicOffer.checkoutUrl)
    expect(consentRequired(monetization)).toBe(false)
  })

  it('treats empty-string env values (unset GitHub repo variables) the same as unset', () => {
    const names = ['VITE_ADS_ENABLED', 'VITE_AD_PROVIDER', 'VITE_ADSENSE_CLIENT', 'VITE_ADSENSE_SLOT_GRID', 'VITE_ADSENSE_SLOT_SIDEBAR', 'VITE_SPONSOR_NAME', 'VITE_SPONSOR_URL', 'VITE_SPONSOR_TEXT', 'VITE_AFFILIATES_ENABLED', 'VITE_SUPPORT_URL', 'VITE_WAITLIST_ENDPOINT', 'VITE_WAITLIST_EMAIL', 'VITE_CHECKOUT_URL', 'VITE_ANALYTICS_PROVIDER', 'VITE_PLAUSIBLE_DOMAIN', 'VITE_PLAUSIBLE_SRC']
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
    expect(c.checkoutUrl).toBe(publicOffer.checkoutUrl)
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

describe('checkout URL', () => {
  it('accepts https and drops junk', () => {
    expect(httpsOrEmpty(' https://buy.example/pro ')).toBe('https://buy.example/pro')
    expect(httpsOrEmpty('http://buy.example/pro')).toBe('')
    expect(httpsOrEmpty('javascript:alert(1)')).toBe('')
    expect(httpsOrEmpty('not a url')).toBe('')
    expect(httpsOrEmpty('')).toBe('')
    expect(buildConfig({}, []).checkoutUrl).toBe(publicOffer.checkoutUrl)
    expect(buildConfig({ VITE_CHECKOUT_URL: '' }, []).checkoutUrl).toBe(publicOffer.checkoutUrl)
    expect(buildConfig({ VITE_CHECKOUT_URL: 'https://buy.example/pro' }, []).checkoutUrl).toBe('https://buy.example/pro')
    expect(buildConfig({ VITE_CHECKOUT_URL: 'http://buy.example/pro' }, []).checkoutUrl).toBe(publicOffer.checkoutUrl)
  })

  it('shows the Polar price and checkout, and hides the button when checkout is blank', async () => {
    const { unmount } = render(<Pro config={monetization} />)
    expect(screen.getByRole('link', { name: 'Get ClipSpike Pro' })).toHaveAttribute('href', publicOffer.checkoutUrl)
    expect(screen.getByText(/\$39 one-time/)).toBeInTheDocument()
    unmount()

    const hidden = { ...monetization, checkoutUrl: '' }
    const { unmount: unmountHidden } = render(<Pro config={hidden} />)
    expect(screen.queryByRole('link', { name: 'Get ClipSpike Pro' })).toBeNull()
    unmountHidden()

    setConsent({ ads: false, analytics: true })
    const spy = vi.fn()
    window.plausible = spy as never
    const paid = buildConfig(
      { VITE_CHECKOUT_URL: 'https://buy.example/pro', VITE_ANALYTICS_PROVIDER: 'plausible', VITE_PLAUSIBLE_DOMAIN: 'clipspike.com' },
      [],
    )
    render(<Pro config={paid} />)
    const link = screen.getByRole('link', { name: 'Get ClipSpike Pro' })
    expect(link).toHaveAttribute('href', 'https://buy.example/pro')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText(/Ad-free/)).toBeNull()
    await userEvent.click(link)
    expect(spy).toHaveBeenCalledWith('pro_checkout_click', { props: { entry: 'pro' } })
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

  it('validates email and submits a macOS signup when the waitlist is configured', async () => {
    const { unmount } = render(<Pro config={monetization} />)
    expect(screen.queryByRole('heading', { name: 'Join the macOS waitlist' })).toBeNull()
    expect(screen.queryByText(/isn.t open yet/)).toBeNull()
    unmount()
    render(<Pro config={withEndpoint} />)
    expect(screen.getByRole('heading', { name: 'Join the macOS waitlist' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Email address'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Notify me' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid email')
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    try {
      const email = screen.getByLabelText('Email address')
      await userEvent.clear(email)
      await userEvent.type(email, 'creator@example.com')
      await userEvent.click(screen.getByRole('button', { name: 'Notify me' }))
      expect(await screen.findByText(/on the list/)).toBeInTheDocument()
      expect(send).toHaveBeenCalledWith(withEndpoint.waitlist.endpoint, expect.objectContaining({
        body: JSON.stringify({ email: 'creator@example.com', source: 'clipspike-macos' }),
      }))
    } finally {
      send.mockRestore()
    }
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
