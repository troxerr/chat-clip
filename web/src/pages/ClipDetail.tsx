import FollowButton from '../components/FollowButton'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatOffset, formatViews } from '../lib/clips'
import ClipCard from '../components/ClipCard'
import ClipPlayer from '../components/ClipPlayer'
import { useClipStore } from '../store/useClipStore'
import SupportCard from '../monetization/SupportCard'
import AffiliateCards from '../monetization/AffiliateCards'
import { track } from '../monetization/analytics'
import { canonicalClipUrl, shareClip } from '../lib/share'

export default function ClipDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const clips = useClipStore((s) => s.clips)
  const loadState = useClipStore((s) => s.loadState)
  const clip = clips.find((c) => String(c.id) === id)
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
    if (result === 'copied') {
      setToast('Link copied')
      track('clip_share')
    }
    else if (result === 'failed') setToast('Could not share — copy the link manually')
  }

  if (!clip && (loadState === 'idle' || loadState === 'loading')) {
    return <p role="status">Loading highlight…</p>
  }

  if (!clip) {
    return (
      <>
        <h1>Clip not found</h1>
        <p>This highlight may have expired or been removed.</p>
        <Link to="/clips">Back to highlights</Link>
      </>
    )
  }

  const related = clips.filter((item) => item.id !== clip.id && item.streamer === clip.streamer)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3)

  return (
    <>
      <Link to="/clips" className="back">← All highlights</Link>
      <h1>{clip.title}</h1>
      <ClipPlayer
        key={clip.id}
        clip={clip}
        preloadEmbed={!clip.mature &&
          document.head.querySelector('meta[property="og:type"]')?.getAttribute('content') === 'video.other' &&
          document.head.querySelector('meta[name="robots"]')?.getAttribute('content') === 'index,follow' &&
          document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') === canonicalClipUrl(clip.id)}
      />
      {clip.url && (
        <a className="back" href={clip.url} target="_blank" rel="noreferrer">
          Open on Twitch
        </a>
      )}
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
      {related.length > 0 && (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading">More from {clip.streamer}</h2>
          <div className="grid">{related.map((item) => <ClipCard key={item.id} clip={item} />)}</div>
        </section>
      )}
      <SupportCard />
      <AffiliateCards />
    </>
  )
}
