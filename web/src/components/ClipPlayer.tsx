import { useState } from 'react'
import type { Clip } from '../data/clips'
import { scoreTier } from '../lib/clips'
import { track } from '../monetization/analytics'
import { clipEmbedUrl } from '../lib/embed'

/** 16:9 player: a poster until clicked, then the Twitch embed iframe is mounted. */
export default function ClipPlayer({ clip, preloadEmbed = false }: { clip: Clip; preloadEmbed?: boolean }) {
  const [playing, setPlaying] = useState(false)
  const slug = clip.slug
  return (
    <div className="player" style={{ ['--hue' as string]: clip.hue }}>
      {slug && (playing || preloadEmbed) && (
        <iframe
          className="player-frame"
          src={clipEmbedUrl(slug, playing)}
          tabIndex={playing ? undefined : -1}
          aria-hidden={playing ? undefined : true}
          title={`Twitch clip: ${clip.title}`}
          allowFullScreen
          allow="autoplay; fullscreen"
        />
      )}
      {!playing && (
        <>
          {slug && (
            <button type="button" className={clip.mature ? 'player-poster player-poster-mature' : 'player-poster'} onClick={() => {
              setPlaying(true)
              const referrer = document.referrer
              const fromHomepage = referrer === `${location.origin}/`
              const fromShare = new URLSearchParams(location.search).get('from') === 'share'
              track('clip_play', { entry: fromShare ? 'shared_link' : fromHomepage ? 'homepage' : 'web_app' })
            }} aria-label={`Play clip: ${clip.title}`}>
              {clip.thumbnailUrl && <img src={clip.thumbnailUrl} alt="" loading="lazy" />}
              <span className="player-play">{clip.mature ? '▶ Mature content: click to play' : '▶ Play clip'}</span>
            </button>
          )}
          <span className={`score score-${scoreTier(clip.score)}`}>{clip.score}</span>
        </>
      )}
    </div>
  )
}
