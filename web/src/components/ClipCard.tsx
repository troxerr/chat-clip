import { Link } from 'react-router-dom'
import type { Clip } from '../data/clips'
import FollowButton from './FollowButton'
import { formatOffset, formatViews, scoreTier } from '../lib/clips'

export default function ClipCard({ clip }: { clip: Clip }) {
  return (
    <div className="card-wrap">
    <Link to={`/clips/${clip.id}`} className="card">
      <div
        className={clip.mature ? 'thumb thumb-mature' : 'thumb'}
        style={{
          ['--hue' as string]: clip.hue,
          // Mature clips draw the image on a blurred ::before layer so the score/duration badges stay sharp.
          ...(clip.thumbnailUrl &&
            (clip.mature
              ? { ['--thumb-img' as string]: `url(${clip.thumbnailUrl})` }
              : { backgroundImage: `url(${clip.thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' })),
        }}
      >
        {clip.mature && <span className="mature-tag">Mature · blurred</span>}
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
    <FollowButton login={clip.streamer} className="card-follow" />
    </div>
  )
}
