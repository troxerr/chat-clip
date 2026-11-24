import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import RouteHead from './RouteHead'

describe('RouteHead', () => {
  it('updates title, canonical and JSON-LD for the current route', () => {
    render(<MemoryRouter initialEntries={['/streamer/xqc']}><RouteHead /></MemoryRouter>)
    expect(document.title).toContain('xqc')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/streamer\/xqc\/$/)
    expect(document.head.querySelector('script[data-seo-jsonld]')?.textContent).toContain('BreadcrumbList')
  })
})
