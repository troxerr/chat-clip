import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { SkeletonGrid } from '../components/DataStatus'
import { trendingClips } from '../lib/clips'
import { useClipStore } from '../store/useClipStore'
import { useFollowStore } from '../store/useFollowStore'

export default function Home() {
  const clips = useClipStore((s) => s.clips)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const follows = useFollowStore((s) => s.follows)
  const followed = useMemo(() => {
    const names = new Set(follows.map((login) => login.toLowerCase()))
    return clips.filter((clip) => names.has(clip.streamer.toLowerCase()))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6)
  }, [clips, follows])
  const top = [...clips].sort((a, b) => b.score - a.score).slice(0, 3)
  const trending = useMemo(() => trendingClips(clips, 3), [clips])
  return (
    <>
      <section className="hero">
        <h1>Recent Twitch highlights</h1>
        <p>
          Find clips by streamer, game, or date, and follow channels to keep their recent highlights together.
        </p>
        <div className="hero-actions">
          <Link className="btn" to="/clips">Browse highlights</Link>
          <Link className="btn btn-ghost" to="/pro">Get the desktop app</Link>
        </div>
      </section>
      {follows.length > 0 && (
        <section aria-labelledby="following-heading">
          <div className="section-head">
            <h2 id="following-heading">From streamers you follow</h2>
            <Link to="/streamers">Manage streamers</Link>
          </div>
          {loading ? <SkeletonGrid count={3} /> : followed.length > 0 ? (
            <div className="grid">{followed.map((clip) => <ClipCard key={clip.id} clip={clip} />)}</div>
          ) : (
            <p className="empty">No recent highlights from your followed streamers.</p>
          )}
        </section>
      )}
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
