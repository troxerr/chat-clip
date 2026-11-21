import { useMemo, useState } from 'react'
import ClipCard from '../components/ClipCard'
import { defaultFilters, filterClips, type SortKey } from '../lib/clips'
import { useClipStore } from '../store/useClipStore'

export default function Clips() {
  const clips = useClipStore((s) => s.clips)
  const [filters, setFilters] = useState(defaultFilters)
  const streamers = useMemo(() => [...new Set(clips.map((c) => c.streamer))].sort(), [clips])
  const shown = useMemo(() => filterClips(clips, filters), [clips, filters])
  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))

  return (
    <>
      <h1>Highlights</h1>
      <div className="toolbar">
        <input
          type="search"
          aria-label="Search clips"
          placeholder="Search clips, streamers, games"
          value={filters.query}
          onChange={(e) => set('query', e.target.value)}
        />
        <select aria-label="Streamer" value={filters.streamer} onChange={(e) => set('streamer', e.target.value)}>
          <option value="all">All streamers</option>
          {streamers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Minimum score"
          value={filters.minScore}
          onChange={(e) => set('minScore', Number(e.target.value))}
        >
          <option value={0}>Any score</option>
          <option value={70}>70+</option>
          <option value={85}>85+</option>
        </select>
        <select aria-label="Sort by" value={filters.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
          <option value="score">Highest score</option>
          <option value="recent">Most recent</option>
          <option value="views">Most viewed</option>
        </select>
      </div>
      <p className="meta" role="status">
        {shown.length} highlight{shown.length === 1 ? '' : 's'}
      </p>
      {shown.length ? (
        <div className="grid">
          {shown.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      ) : (
        <p className="empty">No highlights match your filters.</p>
      )}
    </>
  )
}
