import FollowButton from '../components/FollowButton'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatOffset, formatViews } from '../lib/clips'
import ClipPlayer from '../components/ClipPlayer'
import { useClipStore } from '../store/useClipStore'
import SupportCard from '../monetization/SupportCard'
import AffiliateCards from '../monetization/AffiliateCards'
import { shareClip } from '../lib/share'

export default function ClipDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const clip = useClipStore((s) => s.clips.find((c) => String(c.id) === id))
  const { toggleFavorite, removeClip } = useClipStore()
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function onShare() {
    if (!clip) return
    const result = await shareClip(clip)
    if (result === 'copied') setToast('Link copied to clipboard')
    else if (result === 'failed') setToast('Could not share — copy the link manually')
  }

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
      <ClipPlayer clip={clip} />
      <h1>{clip.title}</h1>
      <p className="meta">
        <span className="streamer">{clip.streamer}</span> · {clip.game} ·{' '}
        {new Date(clip.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}
      </p>
      <FollowButton login={clip.streamer} />
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
            Open on Twitch
          </a>
        )}
        <button className="btn" onClick={() => toggleFavorite(clip.id)} aria-pressed={clip.favorite}>
          {clip.favorite ? '★ Saved' : '☆ Save'}
        </button>
        <button className="btn" onClick={onShare}>
          Share
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
      <p className="toast" role="status" aria-live="polite">{toast}</p>
      <SupportCard />
      <AffiliateCards />
    </>
  )
}
