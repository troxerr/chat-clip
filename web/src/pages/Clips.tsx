import { useMemo, useState } from 'react'
import ClipCard from '../components/ClipCard'
import { SkeletonGrid } from '../components/DataStatus'
import { defaultFilters, filterClips, type SortKey } from '../lib/clips'
import { useClipStore } from '../store/useClipStore'

export default function Clips() {
  const clips = useClipStore((s) => s.clips)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const [filters, setFilters] = useState(defaultFilters)
  const streamers = useMemo(() => [...new Set(clips.map((c) => c.streamer))].sort(), [clips])
  const shown = useMemo(() => filterClips(clips, filters), [clips, filters])
  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))

  return (
    <>
      <h1>Highlights</h1>
      <div className="toolbar" role="search" aria-label="Filter highlights">
        <label className="field field-grow">
          <span>Search clips</span>
          <input
          type="search"
          placeholder="Search clips, streamers, games"
          value={filters.query}
          onChange={(e) => set('query', e.target.value)}
        />
        </label>
        <label className="field">
          <span>Streamer</span>
        <select value={filters.streamer} onChange={(e) => set('streamer', e.target.value)}>
          <option value="all">All streamers</option>
          {streamers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        </label>
        <label className="field">
          <span>Minimum score</span>
        <select
          value={filters.minScore}
          onChange={(e) => set('minScore', Number(e.target.value))}
        >
          <option value={0}>Any score</option>
          <option value={70}>70+</option>
          <option value={85}>85+</option>
        </select>
        </label>
        <label className="field">
          <span>Sort by</span>
        <select value={filters.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
          <option value="score">Highest score</option>
          <option value="recent">Most recent</option>
          <option value="views">Most viewed</option>
        </select>
        </label>
      </div>
      <p className="meta" role="status" aria-live="polite">
        {loading ? 'Loading highlights…' : `${shown.length} highlight${shown.length === 1 ? '' : 's'}`}
      </p>
      {loading ? (
        <SkeletonGrid />
      ) : shown.length ? (
        <div className="grid">
          {shown.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>{clips.length ? 'No highlights match your filters.' : 'No highlights yet.'}</p>
          {clips.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setFilters(defaultFilters)}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </>
  )
}
