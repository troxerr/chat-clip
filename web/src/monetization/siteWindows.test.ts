/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// vitest runs with cwd = web/
const html = readFileSync('../site/windows.html', 'utf8')

describe('site/windows.html', () => {
  it('links to GitHub Releases latest and describes both builds', () => {
    expect(html).toContain('href="https://github.com/troxerr/chat-clip/releases/latest"')
    expect(html).toMatch(/Setup/)
    expect(html).toMatch(/Portable/)
    expect(html).toMatch(/SmartScreen/)
  })

  it('uses only relative asset paths so it works under any base path', () => {
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    for (const r of refs.filter((r) => !/^https?:/.test(r))) expect(r.startsWith('/')).toBe(false)
  })
})
