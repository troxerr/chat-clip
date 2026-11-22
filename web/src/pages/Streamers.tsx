import { useId, useState, type FormEvent } from 'react'
import { allStreamers, DEFAULT_CONFIG, MAX_STREAMERS } from '../lib/streamerConfig'
import NotifyToggle from '../components/NotifyToggle'
import { useClipStore } from '../store/useClipStore'
import { useStreamerStore } from '../store/useStreamerStore'

function DataBadge({ login }: { login: string }) {
  const pipeline = useClipStore((s) => s.pipelineLogins)
  const status = useClipStore((s) => s.streamStatus[login])
  const source = useClipStore((s) => s.dataSource)
  const tracked = pipeline ?? allStreamers(DEFAULT_CONFIG)
  if (!tracked.includes(login)) {
    return (
      <span className="status-pill off" title="Not in config/streamers.json, so the data pipeline doesn't fetch it">
        No data yet
      </span>
    )
  }
  if (source === 'demo' && status === undefined) return <span className="status-pill off">○ Unknown</span>
  return <span className={`status-pill ${status === 'live' ? 'on' : 'off'}`}>{status === 'live' ? '● Live' : '○ Offline'}</span>
}

export default function Streamers() {
  const { primary, backups, add, remove, makePrimary, move, reset } = useStreamerStore()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const errId = useId()
  const full = backups.length + 1 >= MAX_STREAMERS

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err = add(value)
    setError(err)
    if (!err) setValue('')
  }

  return (
    <>
      <h1>Streamers</h1>
      <p className="meta">
        The primary streamer is monitored first; if they’re offline, the first live backup (top to bottom) is used.
      </p>

      <form onSubmit={submit} noValidate aria-label="Add streamer">
        <label htmlFor="add-streamer">Add a backup streamer</label>
        <div className="toolbar">
          <input
            id="add-streamer"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Twitch username"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            disabled={full}
          />
          <button type="submit" className="btn" disabled={full}>
            Add
          </button>
        </div>
        {error && (
          <p id={errId} role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>

      <h2>Primary</h2>
      <ul className="streamer-list" aria-label="Primary streamer">
        <li>
          <span className="streamer">{primary}</span>
          <DataBadge login={primary} />
        </li>
      </ul>

      <h2>Backups</h2>
      {backups.length ? (
        <ol className="streamer-list" aria-label="Backup streamers">
          {backups.map((login, i) => (
            <li key={login}>
              <span className="streamer">{login}</span>
              <DataBadge login={login} />
              <span className="row-actions">
                <button type="button" className="btn btn-ghost" onClick={() => makePrimary(login)}>
                  Make primary
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Move ${login} up`}
                  disabled={i === 0}
                  onClick={() => move(login, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Move ${login} down`}
                  disabled={i === backups.length - 1}
                  onClick={() => move(login, 1)}
                >
                  ↓
                </button>
                <button type="button" className="btn btn-ghost" aria-label={`Remove ${login}`} onClick={() => remove(login)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">No backups. Add one above so monitoring can fail over.</p>
      )}

      <p className="meta">
        Live status and clips come from a scheduled data job that only covers the streamers listed in the repo’s{' '}
        <code>config/streamers.json</code>. Streamers you add here are saved in this browser and show “No data yet”
        until they’re added to that file.
      </p>
      <NotifyToggle />
      <button type="button" className="btn btn-ghost" onClick={() => { reset(); setError(null) }}>
        Reset to defaults
      </button>
    </>
  )
}
