/** Clip JSON older than this should be called out, not only shown as a quiet relative time. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000

/** True only for a parseable timestamp strictly older than two hours. Missing or fresh is not stale. */
export function isStale(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return now - t > STALE_AFTER_MS
}

export function timeAgo(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const mins = Math.max(0, Math.floor((now - t) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
