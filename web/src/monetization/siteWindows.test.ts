/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// vitest runs with cwd = web/
const html = readFileSync('../site/windows.html', 'utf8')

describe('site/windows.html', () => {
  it('shows a coming-soon status instead of a download link until a signed release is public', () => {
    expect(html).toContain('Windows release coming soon')
    expect(html).not.toContain('releases/latest')
    expect(html).not.toMatch(/href="[^"]*\.exe"/)
  })

  it('still describes both builds and the SmartScreen warning', () => {
    expect(html).toMatch(/Setup/)
    expect(html).toMatch(/Portable/)
    expect(html).toMatch(/SmartScreen/)
  })

  it('uses only relative asset paths so it works under any base path', () => {
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    for (const r of refs.filter((r) => !/^https?:/.test(r))) expect(r.startsWith('/')).toBe(false)
  })
})
