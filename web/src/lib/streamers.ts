export type StreamStatus = 'live' | 'offline'
export type StatusMap = Record<string, StreamStatus>

export interface Selection {
  streamer: string
  usingBackup: boolean
  // true when neither the primary nor any backup is live
  allOffline: boolean
}

/** Picks the primary if live, otherwise the first live backup in order. */
export function selectStreamer(primary: string, backups: string[], status: StatusMap): Selection {
  if (status[primary] === 'live') return { streamer: primary, usingBackup: false, allOffline: false }
  const backup = backups.find((b) => b !== primary && status[b] === 'live')
  if (backup) return { streamer: backup, usingBackup: true, allOffline: false }
  return { streamer: primary, usingBackup: false, allOffline: true }
}
