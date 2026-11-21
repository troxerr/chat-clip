import { describe, expect, it } from 'vitest'
import { mockClips } from '../data/clips'
import { defaultFilters, filterClips, formatOffset, formatViews } from './clips'

describe('filterClips', () => {
  it('sorts by score descending by default', () => {
    const scores = filterClips(mockClips, defaultFilters).map((c) => c.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
  it('filters by streamer and min score', () => {
    const r = filterClips(mockClips, { ...defaultFilters, streamer: 'Jynxzi', minScore: 90 })
    expect(r.map((c) => c.id)).toEqual([1, 2])
  })
  it('searches title, game and signal', () => {
    expect(filterClips(mockClips, { ...defaultFilters, query: 'celeste' })).toHaveLength(2)
  })
  it('sorts by recency', () => {
    expect(filterClips(mockClips, { ...defaultFilters, sort: 'recent' })[0].id).toBe(1)
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
