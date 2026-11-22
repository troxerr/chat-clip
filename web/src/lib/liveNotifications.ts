import type { StatusMap } from './streamers'
import type { StreamDetails } from './twitchData'

export interface LiveTransition extends StreamDetails {
  streamer: string
}

/**
 * Streamers that went offline -> live between two snapshots. A streamer must be
 * explicitly 'offline' in `prev`; missing (e.g. just added) counts as unknown, so no notification.
 */
export function detectLiveTransitions(
  prev: StatusMap,
  next: StatusMap,
  names: string[],
  details: Record<string, StreamDetails> = {},
): LiveTransition[] {
  return names
    .filter((n) => prev[n] === 'offline' && next[n] === 'live')
    .map((streamer) => ({ streamer, ...details[streamer] }))
}

export function notificationContent(t: LiveTransition): { title: string; body: string } {
  const parts = [t.title, t.game && `Playing ${t.game}`, t.viewers !== undefined && `${t.viewers.toLocaleString('en-US')} viewers`]
  return { title: `${t.streamer} is live`, body: parts.filter(Boolean).join(' · ') }
}

export type NotifySupport = 'unsupported' | NotificationPermission

export function notifySupport(): NotifySupport {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}
