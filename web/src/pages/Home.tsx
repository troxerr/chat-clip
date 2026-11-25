import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { SkeletonGrid } from '../components/DataStatus'
import { trendingClips } from '../lib/clips'
import { useClipStore } from '../store/useClipStore'
import { useStreamerStore } from '../store/useStreamerStore'

export default function Home() {
  const clips = useClipStore((s) => s.clips)
  const primary = useStreamerStore((s) => s.primary)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const top = [...clips].sort((a, b) => b.score - a.score).slice(0, 3)
  const trending = useMemo(() => trendingClips(clips, 3), [clips])
  const featured = clips.filter((c) => c.streamer === primary).length
  const avg = clips.length ? Math.round(clips.reduce((n, c) => n + c.score, 0) / clips.length) : 0
  return (
    <>
      <section className="hero">
        <span className="live-pill">● Live highlight detection</span>
        <h1>Never miss the moment chat loses it.</h1>
        <p>
          Browse the moments a Twitch chat reacts to. The Windows app watches chat and saves the 30 seconds
          around a spike, a raid, a moderator&apos;s !clip, or Save highlight.
        </p>
        <Link className="btn" to="/clips">
          Browse highlights
        </Link>
      </section>
      <section className="stats">
        <div className="stat"><strong>{clips.length}</strong><span>highlights</span></div>
        <div className="stat"><strong>{avg}</strong><span>avg score</span></div>
        <div className="stat"><strong>{featured}</strong><span>from {primary}</span></div>
      </section>
      <section aria-labelledby="trending-heading">
        <div className="section-head">
          <h2 id="trending-heading">Trending now</h2>
          <Link to="/clips?sort=trending&range=week">See all trending</Link>
        </div>
        {loading ? (
          <SkeletonGrid count={3} />
        ) : trending.length ? (
          <div className="grid">
            {trending.map((c) => (
              <ClipCard key={c.id} clip={c} />
            ))}
          </div>
        ) : (
          <p className="empty">Nothing trending this week. Browse all highlights instead.</p>
        )}
      </section>
      <h2>Top highlights</h2>
      {loading ? (
        <SkeletonGrid count={3} />
      ) : top.length ? (
        <div className="grid">
          {top.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      ) : (
        <p className="empty">No highlights yet. Check back once a stream gets going.</p>
      )}
    </>
  )
}
