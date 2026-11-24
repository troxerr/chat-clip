import { normalizeLogin } from '../lib/streamerConfig'
import { useFollowStore } from '../store/useFollowStore'

/** Bell toggle that remembers a streamer in this browser for live alerts. */
export default function FollowButton({ login, className = '' }: { login: string; className?: string }) {
  const name = normalizeLogin(login)
  const following = useFollowStore((s) => s.follows.includes(name))
  const toggle = useFollowStore((s) => s.toggle)
  return (
    <button
      type="button"
      className={`follow-btn${following ? ' on' : ''} ${className}`.trim()}
      aria-pressed={following}
      aria-label={`Live alerts for ${name}`}
      title={following ? `Stop live alerts for ${name}` : `Alert me when ${name} goes live`}
      onClick={() => toggle(name)}
    >
      <span aria-hidden="true">{following ? '🔔' : '🔕'}</span> {following ? 'Following' : 'Follow'}
    </button>
  )
}
