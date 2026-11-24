import { describe, expect, it } from 'vitest'
import { MAX_FOLLOWS, notifyTargets, sanitizeFollows, toggleFollow } from './follows'

describe('follows', () => {
  it('sanitizes untrusted data', () => {
    expect(sanitizeFollows(['Foo_bar', 'foo_bar', 'x', 3, '@abc'])).toEqual(['foo_bar', 'abc'])
    expect(sanitizeFollows('nope')).toEqual([])
    expect(sanitizeFollows(Array.from({ length: 40 }, (_, i) => `user${i}`))).toHaveLength(MAX_FOLLOWS)
  })
  it('toggles and rejects invalid logins', () => {
    expect(toggleFollow([], 'Foo_Bar')).toEqual(['foo_bar'])
    expect(toggleFollow(['foo_bar'], 'foo_bar')).toEqual([])
    expect(toggleFollow([], '!!')).toEqual([])
  })
  it('notifies followed streamers, else all monitored', () => {
    expect(notifyTargets(['a'], ['a', 'b'])).toEqual(['a'])
    expect(notifyTargets([], ['a', 'b'])).toEqual(['a', 'b'])
  })
})
