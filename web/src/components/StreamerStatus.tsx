import { selectStreamer } from '../lib/streamers'
import { useClipStore } from '../store/useClipStore'
import { useStreamerStore } from '../store/useStreamerStore'

export default function StreamerStatus() {
  const status = useClipStore((s) => s.streamStatus)
  const source = useClipStore((s) => s.dataSource)
  const primary = useStreamerStore((s) => s.primary)
  const backups = useStreamerStore((s) => s.backups)
  const sel = selectStreamer(primary, backups, status)
  const live = !sel.allOffline
  return (
    <div className="following" role="group" aria-label="Current streamer" aria-live="polite">
      <span className="meta">Now monitoring</span>
      <span className="streamer">{sel.streamer}</span>
      <span className={`status-pill ${live ? 'on' : 'off'}`}>{live ? '● Live' : '○ Offline'}</span>
      {sel.usingBackup && (
        <span className="backup-note">
          Switched to backup — {primary} is offline
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
