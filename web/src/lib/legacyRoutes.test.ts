import { describe, expect, it } from 'vitest'
import { resolveEntryPath } from './legacyRoutes'

const root = { pathname: '/app/', search: '', hash: '' }

describe('resolveEntryPath', () => {
  it('converts legacy hash links to paths', () => {
    expect(resolveEntryPath('/app/', { ...root, hash: '#/clips/abc' }, null)).toBe('/app/clips/abc')
    expect(resolveEntryPath('/app/', { ...root, hash: '#/' }, null)).toBe('/app/')
  })
  it('restores a path stashed by 404.html', () => {
    expect(resolveEntryPath('/app/', root, '/app/streamers?x=1')).toBe('/app/streamers?x=1')
  })
  it('ignores unrelated or foreign stored paths', () => {
    expect(resolveEntryPath('/app/', root, '/other/x')).toBeNull()
    expect(resolveEntryPath('/app/', { ...root, hash: '#main' }, null)).toBeNull()
  })
})
