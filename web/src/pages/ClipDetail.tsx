import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatOffset, formatViews, scoreTier } from '../lib/clips'
import { useClipStore } from '../store/useClipStore'

export default function ClipDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const clip = useClipStore((s) => s.clips.find((c) => String(c.id) === id))
  const { toggleFavorite, removeClip } = useClipStore()

  if (!clip) {
    return (
      <>
        <h1>Clip not found</h1>
        <Link to="/clips">Back to highlights</Link>
      </>
    )
  }

  return (
    <>
      <Link to="/clips" className="back">← All highlights</Link>
      <div className="player" style={{ ['--hue' as string]: clip.hue }}>
        <span className={`score score-${scoreTier(clip.score)}`}>{clip.score}</span>
      </div>
      <h1>{clip.title}</h1>
      <p className="meta">
        <span className="streamer">{clip.streamer}</span> · {clip.game} ·{' '}
        {new Date(clip.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}
      </p>
      <dl className="facts">
        <div><dt>Highlight score</dt><dd>{clip.score}/100</dd></div>
        <div><dt>Detected signal</dt><dd>{clip.signal}</dd></div>
        <div><dt>VOD timestamp</dt><dd>{formatOffset(clip.vodOffset)}</dd></div>
        <div><dt>Length</dt><dd>{clip.duration}s</dd></div>
        {clip.chatRate > 0 && <div><dt>Chat rate</dt><dd>{clip.chatRate} msg/min</dd></div>}
        <div><dt>Views</dt><dd>{formatViews(clip.views)}</dd></div>
      </dl>
      <div className="row">
        {clip.url && (
          <a className="btn" href={clip.url} target="_blank" rel="noreferrer">
            Watch on Twitch
          </a>
        )}
        <button className="btn" onClick={() => toggleFavorite(clip.id)} aria-pressed={clip.favorite}>
          {clip.favorite ? '★ Saved' : '☆ Save'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            removeClip(clip.id)
            navigate('/clips')
          }}
        >
          Dismiss
        </button>
      </div>
    </>
  )
}
