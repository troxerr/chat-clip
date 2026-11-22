import { Link } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { FEATURED_STREAMER } from '../data/clips'
import { SkeletonGrid } from '../components/DataStatus'
import { useClipStore } from '../store/useClipStore'

export default function Home() {
  const clips = useClipStore((s) => s.clips)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const top = [...clips].sort((a, b) => b.score - a.score).slice(0, 3)
  const featured = clips.filter((c) => c.streamer === FEATURED_STREAMER).length
  const avg = clips.length ? Math.round(clips.reduce((n, c) => n + c.score, 0) / clips.length) : 0
  return (
    <>
      <section className="hero">
        <span className="live-pill">● Live highlight detection</span>
        <h1>Never miss the moment chat loses it.</h1>
        <p>
          ClipSpike watches chat velocity, audio peaks and play-by-play to surface the best moments from your
          favorite streams.
        </p>
        <Link className="btn" to="/clips">
          Browse highlights
        </Link>
      </section>
      <section className="stats">
        <div className="stat"><strong>{clips.length}</strong><span>highlights</span></div>
        <div className="stat"><strong>{avg}</strong><span>avg score</span></div>
        <div className="stat"><strong>{featured}</strong><span>from {FEATURED_STREAMER}</span></div>
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
