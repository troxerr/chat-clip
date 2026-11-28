import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import SponsorSlot from '../monetization/SponsorSlot'
import ClipCard from '../components/ClipCard'
import { SkeletonGrid } from '../components/DataStatus'
import {
  defaultFilters,
  filterClips,
  filtersFromParams,
  filtersToParams,
  type ClipFilters,
  type SortKey,
} from '../lib/clips'
import { useClipStore } from '../store/useClipStore'

const quickRanges = [['all', 'Any time'], ['today', 'Past 24 hours'], ['week', 'Past 7 days']] as const

export default function Clips() {
  const clips = useClipStore((s) => s.clips)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(params), [params])
  const streamers = useMemo(() => [...new Set(clips.map((c) => c.streamer))].sort(), [clips])
  const games = useMemo(() => [...new Set(clips.map((c) => c.game))].sort(), [clips])
  const shown = useMemo(() => filterClips(clips, filters), [clips, filters])
  const update = (next: ClipFilters) => setParams(filtersToParams(next), { replace: true })
  const set = <K extends keyof ClipFilters>(k: K, v: ClipFilters[K]) => update({ ...filters, [k]: v })
  const active = JSON.stringify(filters) !== JSON.stringify(defaultFilters)

  return (
    <section className="clip-discovery" aria-labelledby="clips-title">
      <h1 id="clips-title">Browse recent clips</h1>
      <div className="toolbar clip-filters" role="search" aria-label="Filter highlights">
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
          <span>Game</span>
          <select value={filters.game} onChange={(e) => set('game', e.target.value)}>
            <option value="all">All games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
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
          <option value="trending">Trending</option>
          <option value="score">Highest score</option>
          <option value="recent">Newest</option>
          <option value="views">Most viewed</option>
        </select>
        </label>
      </div>
      <div className="clip-discovery-summary">
        <div className="quick-filters" role="group" aria-label="Time range">
          {quickRanges.map(([range, label]) => (
            <button key={range} type="button" className="btn btn-ghost" aria-pressed={filters.range === range}
              onClick={() => set('range', range)}>{label}</button>
          ))}
          {active && <button type="button" className="linklike" onClick={() => update(defaultFilters)}>Clear filters</button>}
        </div>
        <p className="meta clip-results" role="status" aria-live="polite">
          {loading ? 'Loading highlights…' : `${shown.length} highlight${shown.length === 1 ? '' : 's'}`}
        </p>
      </div>
      {loading ? (
        <SkeletonGrid />
      ) : shown.length ? (
        <>
          <div className="grid">{shown.map((clip) => <ClipCard key={clip.id} clip={clip} />)}</div>
          <div className="browse-sponsor"><SponsorSlot placement="grid" /></div>
        </>
      ) : (
        <div className="empty">
          <p>
            {!clips.length
              ? 'No highlights yet. Check back once a stream gets going.'
              : filters.query.trim()
                ? `No highlights match “${filters.query.trim()}”.`
                : 'No highlights match your filters.'}
          </p>
          {clips.length > 0 && active && <p className="meta">Try a broader search or a wider time range.</p>}
        </div>
      )}
    </section>
  )
}
