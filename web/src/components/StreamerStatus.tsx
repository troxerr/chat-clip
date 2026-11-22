import { BACKUP_STREAMERS, FEATURED_STREAMER } from '../data/clips'
import { selectStreamer } from '../lib/streamers'
import { useClipStore } from '../store/useClipStore'

export default function StreamerStatus() {
  const status = useClipStore((s) => s.streamStatus)
  const source = useClipStore((s) => s.dataSource)
  const sel = selectStreamer(FEATURED_STREAMER, BACKUP_STREAMERS, status)
  const live = !sel.allOffline
  return (
    <div className="following" role="group" aria-label="Current streamer" aria-live="polite">
      <span className="meta">Now monitoring</span>
      <span className="streamer">{sel.streamer}</span>
      <span className={`status-pill ${live ? 'on' : 'off'}`}>{live ? '● Live' : '○ Offline'}</span>
      {sel.usingBackup && (
        <span className="backup-note">
          Switched to backup — {FEATURED_STREAMER} is offline
        </span>
      )}
      {source === 'demo' && (
        <span className="backup-note demo-badge" role="note">
          Demo data — live Twitch data unavailable
        </span>
      )}
      {sel.allOffline && <span className="backup-note">No backup streamers are live</span>}
    </div>
  )
}
