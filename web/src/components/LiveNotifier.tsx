import { useEffect } from 'react'
import { detectLiveTransitions, notificationContent } from '../lib/liveNotifications'
import { allStreamers } from '../lib/streamerConfig'
import { useClipStore } from '../store/useClipStore'
import { useNotifyStore } from '../store/useNotifyStore'
import { useStreamerStore } from '../store/useStreamerStore'

/** Fires one browser notification per offline->live transition seen in refreshed live data. */
export default function LiveNotifier() {
  useEffect(() => {
    return useClipStore.subscribe((state, prev) => {
      if (state.streamStatus === prev.streamStatus) return
      // Demo/mock timelines and the first live load are baselines, never notified.
      if (state.dataSource !== 'live' || prev.dataSource !== 'live') return
      if (!useNotifyStore.getState().enabled || typeof Notification === 'undefined') return
      if (Notification.permission !== 'granted') return
      const names = allStreamers(useStreamerStore.getState())
      for (const t of detectLiveTransitions(prev.streamStatus, state.streamStatus, names, state.streamDetails)) {
        const { title, body } = notificationContent(t)
        try {
          const n = new Notification(title, { body, tag: `live-${t.streamer}` })
          n.onclick = () => {
            window.focus()
            n.close()
          }
        } catch {
          // Some browsers (e.g. mobile Chrome) forbid the constructor; skip silently.
        }
      }
    })
  }, [])
  return null
}
