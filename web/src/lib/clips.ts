import type { Clip } from '../data/clips'

export type SortKey = 'score' | 'recent' | 'views'

export interface ClipFilters {
  query: string
  streamer: string
  minScore: number
  sort: SortKey
}

export const defaultFilters: ClipFilters = { query: '', streamer: 'all', minScore: 0, sort: 'score' }

export function filterClips(clips: Clip[], f: ClipFilters): Clip[] {
  const q = f.query.trim().toLowerCase()
  const out = clips.filter(
    (c) =>
      (f.streamer === 'all' || c.streamer === f.streamer) &&
      c.score >= f.minScore &&
      (!q || [c.title, c.streamer, c.game, c.signal].some((s) => s.toLowerCase().includes(q))),
  )
  const by: Record<SortKey, (a: Clip, b: Clip) => number> = {
    score: (a, b) => b.score - a.score,
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
    views: (a, b) => b.views - a.views,
  }
  return out.sort(by[f.sort])
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
