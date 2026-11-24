import type { Clip } from '../data/clips'

export type SortKey = 'trending' | 'score' | 'recent' | 'views'
export type TimeRange = 'all' | 'today' | 'week'

export interface ClipFilters {
  query: string
  streamer: string
  game: string
  range: TimeRange
  minScore: number
  sort: SortKey
}

export const defaultFilters: ClipFilters = {
  query: '',
  streamer: 'all',
  game: 'all',
  range: 'all',
  minScore: 0,
  sort: 'score',
}

const HOUR = 3_600_000
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = { today: 24 * HOUR, week: 7 * 24 * HOUR }
const TRENDING_HALF_LIFE_HOURS = 24

function ageHours(c: Clip, now: number): number {
  const t = Date.parse(c.createdAt)
  return Number.isNaN(t) ? Infinity : Math.max(0, (now - t) / HOUR)
}

/** Views halved every 24h, so fresh clips with decent views beat stale clips with big totals. */
export function trendingScore(c: Clip, now: number = Date.now()): number {
  return c.views * Math.pow(0.5, ageHours(c, now) / TRENDING_HALF_LIFE_HOURS)
}

export function filterClips(clips: Clip[], f: ClipFilters, now: number = Date.now()): Clip[] {
  const q = f.query.trim().toLowerCase()
  const out = clips.filter(
    (c) =>
      (f.streamer === 'all' || c.streamer === f.streamer) &&
      (f.game === 'all' || c.game === f.game) &&
      (f.range === 'all' || ageHours(c, now) * HOUR <= RANGE_MS[f.range]) &&
      c.score >= f.minScore &&
      (!q || [c.title, c.streamer, c.game, c.signal].some((s) => s.toLowerCase().includes(q))),
  )
  const by: Record<SortKey, (a: Clip, b: Clip) => number> = {
    trending: (a, b) => trendingScore(b, now) - trendingScore(a, now) || b.views - a.views,
    score: (a, b) => b.score - a.score,
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
    views: (a, b) => b.views - a.views,
  }
  return out.sort(by[f.sort])
}

export function trendingClips(clips: Clip[], limit = 6, now: number = Date.now()): Clip[] {
  return filterClips(clips, { ...defaultFilters, range: 'week', sort: 'trending' }, now).slice(0, limit)
}

const SORTS: SortKey[] = ['trending', 'score', 'recent', 'views']
const RANGES: TimeRange[] = ['all', 'today', 'week']

export function filtersFromParams(p: URLSearchParams): ClipFilters {
  const sort = p.get('sort') as SortKey
  const range = p.get('range') as TimeRange
  const min = Number(p.get('min'))
  return {
    query: p.get('q') ?? '',
    streamer: p.get('streamer') || 'all',
    game: p.get('game') || 'all',
    range: RANGES.includes(range) ? range : 'all',
    minScore: Number.isFinite(min) && min > 0 ? min : 0,
    sort: SORTS.includes(sort) ? sort : defaultFilters.sort,
  }
}

/** Only non-default values are written so shared URLs stay short. */
export function filtersToParams(f: ClipFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.query.trim()) p.set('q', f.query)
  if (f.streamer !== 'all') p.set('streamer', f.streamer)
  if (f.game !== 'all') p.set('game', f.game)
  if (f.range !== 'all') p.set('range', f.range)
  if (f.minScore > 0) p.set('min', String(f.minScore))
  if (f.sort !== defaultFilters.sort) p.set('sort', f.sort)
  return p
}

export function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatViews(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n)
}

export function scoreTier(score: number): 'high' | 'mid' | 'low' {
  return score >= 85 ? 'high' : score >= 70 ? 'mid' : 'low'
}
