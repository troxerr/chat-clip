import { useEffect } from 'react'
import { useNotifyStore } from '../store/useNotifyStore'

export default function NotifyToggle() {
  const { enabled, permission, enable, disable, syncPermission } = useNotifyStore()
  useEffect(() => {
    syncPermission()
  }, [syncPermission])
  const blocked = permission === 'denied'
  const unsupported = permission === 'unsupported'
  return (
    <section aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={blocked || unsupported}
          onChange={(e) => (e.target.checked ? void enable() : disable())}
        />{' '}
        Notify me when streamers go live
      </label>
      <p className="meta" role="status">
        {unsupported
          ? 'Your browser doesn’t support notifications.'
          : blocked
            ? 'Notifications are blocked. Allow them in your browser’s site settings, then reload.'
            : enabled
              ? 'You’ll get a notification when a streamer above goes live while ClipSpike is open.'
              : 'Works while ClipSpike is open in a tab. Your browser will ask for permission when you turn this on.'}
      </p>
    </section>
  )
}
