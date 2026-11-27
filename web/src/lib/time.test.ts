import { describe, expect, it } from 'vitest'
import { isStale, STALE_AFTER_MS } from './time'

const now = Date.parse('2026-11-26T12:00:00Z')

describe('isStale', () => {
  it('hides the warning for a missing, invalid, fresh, or exactly two-hour timestamp', () => {
    expect(isStale(null, now)).toBe(false)
    expect(isStale(undefined, now)).toBe(false)
    expect(isStale('not-a-date', now)).toBe(false)
    expect(isStale(new Date(now - 90 * 60_000).toISOString(), now)).toBe(false)
    expect(isStale(new Date(now - STALE_AFTER_MS).toISOString(), now)).toBe(false)
  })

  it('is stale only when the timestamp is older than two hours', () => {
    expect(isStale(new Date(now - STALE_AFTER_MS - 1).toISOString(), now)).toBe(true)
  })
})
