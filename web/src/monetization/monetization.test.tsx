import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AD_CONSENT_KEY, monetization, type MonetizationConfig } from './config'
import SponsorSlot from './SponsorSlot'
import SupportLink from './SupportLink'

const on: MonetizationConfig = {
  ...monetization,
  adsEnabled: true,
  slot: {
    provider: 'sponsor',
    sponsor: { name: 'Acme', url: 'https://acme.example', text: 'Gaming chairs' },
    adsense: { client: 'ca-pub-1', slot: '2' },
  },
}

afterEach(() => {
  localStorage.clear()
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})

describe('monetization defaults', () => {
  it('ships disabled with no support link', () => {
    expect(monetization.adsEnabled).toBe(false)
    expect(monetization.supportUrl).toBe('')
  })
})

describe('SponsorSlot', () => {
  it('renders nothing and loads no scripts by default', () => {
    const { container } = render(<SponsorSlot />)
    expect(container).toBeEmptyDOMElement()
    expect(document.querySelector('script[src*="googlesyndication"]')).toBeNull()
  })

  it('renders a labelled sponsor link when enabled', () => {
    render(<SponsorSlot config={on} />)
    expect(screen.getByLabelText('Sponsored')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('rel', expect.stringContaining('sponsored'))
  })

  it('rejects non-http sponsor URLs', () => {
    const bad = { ...on, slot: { ...on.slot, sponsor: { ...on.slot.sponsor, url: 'javascript:alert(1)' } } }
    const { container } = render(<SponsorSlot config={bad} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not load AdSense without consent, and does with it', () => {
    const cfg = { ...on, slot: { ...on.slot, provider: 'adsense' as const } }
    const { container, unmount } = render(<SponsorSlot config={cfg} />)
    expect(container).toBeEmptyDOMElement()
    expect(document.querySelector('script[src*="googlesyndication"]')).toBeNull()
    unmount()
    localStorage.setItem(AD_CONSENT_KEY, 'granted')
    render(<SponsorSlot config={cfg} />)
    expect(document.querySelector('script[src*="googlesyndication"]')).not.toBeNull()
  })
})

describe('SupportLink', () => {
  it('is hidden until a URL is configured', () => {
    const { container, rerender } = render(<SupportLink />)
    expect(container).toBeEmptyDOMElement()
    rerender(<SupportLink url="https://ko-fi.com/clipspike" />)
    expect(screen.getByRole('link', { name: 'Support ClipSpike' })).toBeInTheDocument()
  })
})
