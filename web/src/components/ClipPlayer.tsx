import { useState } from 'react'
import type { Clip } from '../data/clips'
import { scoreTier } from '../lib/clips'
import { clipEmbedUrl } from '../lib/embed'

/** 16:9 player: a poster until clicked, then the Twitch embed iframe is mounted. */
export default function ClipPlayer({ clip }: { clip: Clip }) {
  const [playing, setPlaying] = useState(false)
  const slug = clip.slug
  return (
    <div className="player" style={{ ['--hue' as string]: clip.hue }}>
      {slug && playing ? (
        <iframe
          className="player-frame"
          src={clipEmbedUrl(slug)}
          title={`Twitch clip: ${clip.title}`}
          allowFullScreen
          allow="autoplay; fullscreen"
        />
      ) : (
        <>
          {slug && (
            <button type="button" className="player-poster" onClick={() => setPlaying(true)} aria-label={`Play clip: ${clip.title}`}>
              {clip.thumbnailUrl && <img src={clip.thumbnailUrl} alt="" loading="lazy" />}
              <span className="player-play">▶ Play clip</span>
            </button>
          )}
          <span className={`score score-${scoreTier(clip.score)}`}>{clip.score}</span>
        </>
      )}
    </div>
  )
}
