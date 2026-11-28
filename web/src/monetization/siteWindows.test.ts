/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { publicOffer } from './offer'

// vitest runs with cwd = web/
const html = readFileSync('../site/windows.html', 'utf8')
const capture = readFileSync('../site/capture.html', 'utf8')
const home = readFileSync('../site/index.html', 'utf8')
const setup = 'https://github.com/troxerr/chat-clip/releases/download/win-v0.1.6/ClipSpike-0.1.6-x64.exe'
const portable = 'https://github.com/troxerr/chat-clip/releases/download/win-v0.1.6/ClipSpike-0.1.6-x64-portable.exe'

describe('site/windows.html', () => {
  it('links the published 0.1.6 trial and the Polar checkout, and warns that the build is unsigned', () => {
    expect(html).toContain(setup)
    expect(html).toContain(portable)
    expect(html).toContain(publicOffer.checkoutUrl)
    expect(html.indexOf(setup)).toBeLessThan(html.indexOf(publicOffer.checkoutUrl))
    expect(html).toContain(publicOffer.priceLabel)
    expect(html).toMatch(/UNSIGNED/)
    expect(html).toMatch(/SmartScreen/)
    expect(html).not.toContain('releases/latest')
    expect(html).not.toContain('coming soon')
    expect(html).not.toMatch(/href="(?!https:)[^"]*\.exe"/)
    const win = JSON.parse(readFileSync('../win/build-config.json', 'utf8')) as { checkoutUrl: string; priceLabel: string }
    expect(win.checkoutUrl).toBe(publicOffer.checkoutUrl)
    expect(win.priceLabel).toBe(publicOffer.priceLabel)
  })

  it('uses only relative asset paths so it works under any base path', () => {
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    for (const r of refs.filter((r) => !/^https?:/.test(r) && !r.startsWith('/app/'))) expect(r.startsWith('/')).toBe(false)
  })
})

describe('ClipSpike landing pages', () => {
  it('links the viewer and creator paths and puts the trial before checkout', () => {
    expect(home).toContain('href="/app/clips/"')
    expect(home).toContain('href="/capture.html"')
    expect(home).toContain('class="btn primary" href="windows.html"')
    expect(home).toContain(`href="${publicOffer.checkoutUrl}" data-checkout="homepage"`)
    expect(home.indexOf('class="btn primary" href="windows.html"'))
      .toBeLessThan(home.indexOf(`href="${publicOffer.checkoutUrl}"`))
  })

  it('shows Windows pricing, the trial link, and a downloadable sample on the capture page', () => {
    expect(capture).toContain(publicOffer.checkoutUrl)
    expect(capture).toContain(publicOffer.priceLabel)
    expect(capture).toContain('href="windows.html"')
    expect(capture).toContain('href="media/sample-highlight.mp4" download')
    expect(capture).not.toContain(setup)
    expect(capture).not.toContain(portable)
    expect(capture).toMatch(/unsigned/i)
    expect(capture).not.toContain('Mac release coming soon')
  })
})
