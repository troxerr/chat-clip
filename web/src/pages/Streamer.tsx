import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import { SkeletonGrid } from '../components/DataStatus'
import { useClipStore } from '../store/useClipStore'

export default function Streamer() {
  const { login = '' } = useParams()
  const clips = useClipStore((s) => s.clips)
  const loading = useClipStore((s) => s.loadState === 'loading')
  const mine = useMemo(
    () => clips.filter((c) => c.streamer.toLowerCase() === login.toLowerCase()).sort((a, b) => b.score - a.score),
    [clips, login],
  )
  const name = mine[0]?.streamer ?? login
  return (
    <>
      <h1>{name} clips &amp; highlights</h1>
      <p className="meta">
        The best recent Twitch clips from {name}, ranked by views and chat activity.{' '}
        <a href={`https://www.twitch.tv/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer">
          Watch {name} on Twitch
        </a>
      </p>
      {loading ? (
        <SkeletonGrid />
      ) : mine.length ? (
        <div className="grid">
          {mine.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No highlights from {name} yet. Check back once they go live.</p>
        </div>
      )}
      <p>
        <Link to="/clips">All highlights</Link> · <Link to="/streamers">All streamers</Link>
      </p>
    </>
  )
}
