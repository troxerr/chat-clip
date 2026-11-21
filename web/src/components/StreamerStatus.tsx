import { BACKUP_STREAMERS, FEATURED_STREAMER } from '../data/clips'
import { selectStreamer } from '../lib/streamers'
import { useClipStore } from '../store/useClipStore'

export default function StreamerStatus() {
  const status = useClipStore((s) => s.streamStatus)
  const sel = selectStreamer(FEATURED_STREAMER, BACKUP_STREAMERS, status)
  const live = !sel.allOffline
  return (
    <div className="following" aria-label="Current streamer">
      <span className="meta">Now monitoring</span>
      <span className="streamer">{sel.streamer}</span>
      <span className={`status-pill ${live ? 'on' : 'off'}`}>{live ? '● Live' : '○ Offline'}</span>
      {sel.usingBackup && (
        <span className="backup-note" role="status">
          Switched to backup — {FEATURED_STREAMER} is offline
        </span>
      )}
      {sel.allOffline && <span className="backup-note" role="status">No backup streamers are live</span>}
    </div>
  )
}
