import type { Clip } from '../data/clips'
import type { StatusMap } from './streamers'
import { isLikelyMature } from './matureFilter'

/** Maps the generated status.json onto the configured streamer names; null if the payload is invalid. */
export function parseStatus(json: unknown, names: string[]): StatusMap | null {
  const streamers = (json as { streamers?: unknown } | null)?.streamers
  if (!streamers || typeof streamers !== 'object') return null
  const byLogin = new Map(Object.entries(streamers as Record<string, { status?: unknown }>).map(([k, v]) => [k.toLowerCase(), v]))
  const out: StatusMap = {}
  for (const name of names) {
    out[name] = byLogin.get(name.toLowerCase())?.status === 'live' ? 'live' : 'offline'
  }
  return out
}

export interface StreamDetails {
  title?: string
  game?: string
  viewers?: number
}

/** Extracts title/game/viewers for live streamers, keyed by the configured names. */
export function parseStreamDetails(json: unknown, names: string[]): Record<string, StreamDetails> {
  const streamers = (json as { streamers?: unknown } | null)?.streamers
  if (!streamers || typeof streamers !== 'object') return {}
  const byLogin = new Map(Object.entries(streamers as Record<string, Record<string, unknown>>).map(([k, v]) => [k.toLowerCase(), v]))
  const out: Record<string, StreamDetails> = {}
  for (const name of names) {
    const s = byLogin.get(name.toLowerCase())
    if (s?.status !== 'live') continue
    out[name] = {
      title: typeof s.title === 'string' ? s.title : undefined,
      game: typeof s.game === 'string' ? s.game : undefined,
      viewers: typeof s.viewers === 'number' ? s.viewers : undefined,
    }
  }
  return out
}

interface RawClip {
  id: string
  title: string
  streamer: string
  game: string
  createdAt: string
  vodOffset: number
  duration: number
  views: number
  url?: string
  thumbnailUrl?: string
  slug?: string
}

const isRawClip = (c: unknown): c is RawClip => {
  const r = c as Partial<RawClip> | null
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.streamer === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.views === 'number'
  )
}

/** Twitch exposes no highlight score, so derive one (50–99) from views relative to the batch's best clip. */
export function scoreFromViews(views: number, maxViews: number): number {
  if (maxViews <= 0) return 50
  return Math.round(50 + 49 * (Math.log1p(Math.max(views, 0)) / Math.log1p(maxViews)))
}

/** Prefers the explicit slug; falls back to the Helix clip id, which is the slug. */
function clipSlug(c: RawClip): string | undefined {
  return typeof c.slug === 'string' && c.slug ? c.slug : c.id || undefined
}

function hueFor(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Maps clips.json to app clips; null if the payload is invalid. `names` canonicalizes streamer casing. */
export function parseClips(json: unknown, names: string[]): Clip[] | null {
  const list = (json as { clips?: unknown } | null)?.clips
  if (!Array.isArray(list)) return null
  // Hide likely-mature clips before scoring so they can't skew the relative scores.
  const raw = list.filter(isRawClip).filter((c) => !isLikelyMature(c))
  const max = Math.max(0, ...raw.map((c) => c.views))
  const canonical = new Map(names.map((n) => [n.toLowerCase(), n]))
  return raw.map((c) => ({
    id: c.id,
    title: c.title,
    streamer: canonical.get(c.streamer.toLowerCase()) ?? c.streamer,
    game: c.game || 'Unknown',
    score: scoreFromViews(c.views, max),
    signal: 'Twitch clip',
    createdAt: c.createdAt,
    vodOffset: c.vodOffset ?? 0,
    duration: c.duration ?? 0,
    views: c.views,
    chatRate: 0,
    hue: hueFor(c.id),
    favorite: false,
    url: c.url,
    thumbnailUrl: c.thumbnailUrl,
    slug: clipSlug(c),
  }))
}
