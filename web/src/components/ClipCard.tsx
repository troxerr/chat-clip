import { Link } from 'react-router-dom'
import type { Clip } from '../data/clips'
import { formatOffset, formatViews, scoreTier } from '../lib/clips'

export default function ClipCard({ clip }: { clip: Clip }) {
  return (
    <Link to={`/clips/${clip.id}`} className="card">
      <div
        className="thumb"
        style={{
          ['--hue' as string]: clip.hue,
          ...(clip.thumbnailUrl && {
            backgroundImage: `url(${clip.thumbnailUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }),
        }}
      >
        <span className={`score score-${scoreTier(clip.score)}`} title="Highlight score">
          {clip.score}
        </span>
        <span className="dur">{clip.duration}s</span>
      </div>
      <h3 className="card-title">{clip.title}</h3>
      <p className="meta">
        <span className="streamer">{clip.streamer}</span> · {clip.game}
      </p>
      <p className="meta">
        {clip.signal} · {formatViews(clip.views)} views · at {formatOffset(clip.vodOffset)}
      </p>
    </Link>
  )
}
