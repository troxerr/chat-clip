import { describe, expect, it } from 'vitest'
import { mockClips } from '../data/clips'
import {
  defaultFilters,
  filterClips,
  filtersFromParams,
  filtersToParams,
  formatOffset,
  formatViews,
  trendingClips,
  trendingScore,
} from './clips'

const NOW = Date.parse('2026-11-21T00:00:00Z')

describe('filterClips', () => {
  it('sorts by score descending by default', () => {
    const scores = filterClips(mockClips, defaultFilters).map((c) => c.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
  it('filters by streamer and min score', () => {
    const r = filterClips(mockClips, { ...defaultFilters, streamer: 'jynxzi', minScore: 90 })
    expect(r.map((c) => c.id)).toEqual([1, 2])
  })
  it('searches title, game and signal', () => {
    expect(filterClips(mockClips, { ...defaultFilters, query: 'celeste' })).toHaveLength(2)
  })
  it('sorts by recency', () => {
    expect(filterClips(mockClips, { ...defaultFilters, sort: 'recent' })[0].id).toBe(1)
  })
})

describe('discovery', () => {
  it('filters by game and time range', () => {
    expect(filterClips(mockClips, { ...defaultFilters, game: 'Celeste' }, NOW)).toHaveLength(2)
    const today = filterClips(mockClips, { ...defaultFilters, range: 'today' }, NOW).map((c) => c.id)
    expect(today.sort()).toEqual([1, 2, 5, 7])
    expect(filterClips(mockClips, { ...defaultFilters, range: 'week' }, NOW)).toHaveLength(10)
  })
  it('sorts by views', () => {
    expect(filterClips(mockClips, { ...defaultFilters, sort: 'views' }, NOW)[0].id).toBe(1)
  })
  it('weights trending by recency', () => {
    const old = { ...mockClips[0], views: 100000, createdAt: '2026-10-01T00:00:00Z' }
    const fresh = { ...mockClips[1], views: 500, createdAt: '2026-11-20T23:00:00Z' }
    expect(trendingScore(fresh, NOW)).toBeGreaterThan(trendingScore(old, NOW))
    expect(trendingClips([old, fresh], 1, NOW)).toEqual([fresh])
  })
  it('round-trips filters through URL params, omitting defaults', () => {
    expect(filtersToParams(defaultFilters).toString()).toBe('')
    const f = { ...defaultFilters, query: 'ace', game: 'Valorant', range: 'week' as const, sort: 'trending' as const }
    expect(filtersFromParams(filtersToParams(f))).toEqual(f)
  })
  it('ignores invalid params', () => {
    expect(filtersFromParams(new URLSearchParams('sort=bogus&range=year&min=abc'))).toEqual(defaultFilters)
  })
})

describe('formatters', () => {
  it('formats offsets and views', () => {
    expect(formatOffset(7522)).toBe('2:05:22')
    expect(formatOffset(65)).toBe('1:05')
    expect(formatViews(18420)).toBe('18.4K')
    expect(formatViews(950)).toBe('950')
  })
})
