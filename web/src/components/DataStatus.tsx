import { useEffect, useState } from 'react'
import { isStale, timeAgo } from '../lib/time'
import { useClipStore } from '../store/useClipStore'

export function UpdatedAt() {
  const generatedAt = useClipStore((s) => s.generatedAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const ago = timeAgo(generatedAt, now)
  if (!ago) return null
  if (isStale(generatedAt, now)) {
    return (
      <div className="stale-banner" role="status">
        Clip data is stale. Updated <time dateTime={generatedAt!}>{ago}</time>.
      </div>
    )
  }
  return (
    <span className="meta updated">
      Updated <time dateTime={generatedAt!}>{ago}</time>
    </span>
  )
}

export function ErrorBanner() {
  const loadState = useClipStore((s) => s.loadState)
  const retry = useClipStore((s) => s.refreshData)
  if (loadState !== 'error') return null
  return (
    <div className="error-banner" role="alert">
      <span>Couldn’t load live Twitch data. Showing demo highlights.</span>
      <button type="button" className="btn btn-ghost" onClick={() => void retry()}>
        Retry
      </button>
    </div>
  )
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" role="status" aria-label="Loading highlights" data-testid="skeleton-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card skeleton" aria-hidden="true">
          <div className="thumb sk" />
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
        </div>
      ))}
    </div>
  )
}
