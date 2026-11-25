/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// vitest runs with cwd = web/
const html = readFileSync('../site/windows.html', 'utf8')
const home = readFileSync('../site/index.html', 'utf8')
const setup = 'https://github.com/troxerr/chat-clip/releases/download/win-v0.1.3/ClipSpike-0.1.3-x64.exe'
const portable = 'https://github.com/troxerr/chat-clip/releases/download/win-v0.1.3/ClipSpike-0.1.3-x64-portable.exe'

describe('site/windows.html', () => {
  it('links the published 0.1.3 assets and warns that the build is unsigned', () => {
    expect(html).toContain(setup)
    expect(html).toContain(portable)
    expect(html).toMatch(/UNSIGNED/)
    expect(html).toMatch(/SmartScreen/)
    expect(html).not.toContain('releases/latest')
    expect(html).not.toContain('coming soon')
    expect(html).not.toMatch(/href="(?!https:)[^"]*\.exe"/)
  })

  it('uses only relative asset paths so it works under any base path', () => {
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    for (const r of refs.filter((r) => !/^https?:/.test(r) && !r.startsWith('/app/'))) expect(r.startsWith('/')).toBe(false)
  })
})

describe('site/index.html', () => {
  it('leads with the live clip browser and does not promise a Mac download', () => {
    expect(home).toContain('href="/app/clips/"')
    expect(home).toContain('href="/app/"')
    expect(home).toContain(setup)
    expect(home).toContain(portable)
    expect(home).toMatch(/UNSIGNED/)
    expect(home).not.toContain('Mac release coming soon')
    expect(home).not.toContain('Once the app is out')
    expect(home).not.toMatch(/notariz/i)
    expect(home).not.toContain('releases/latest')
  })
})
