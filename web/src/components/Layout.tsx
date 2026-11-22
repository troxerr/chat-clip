import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useClipStore } from '../store/useClipStore'
import { ErrorBanner, UpdatedAt } from './DataStatus'
import LiveNotifier from './LiveNotifier'
import StreamerStatus from './StreamerStatus'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/clips', label: 'Clips' },
  { to: '/streamers', label: 'Streamers' },
  { to: '/about', label: 'About' },
]

const REFRESH_MS = 60_000

export default function Layout() {
  const advance = useClipStore((s) => s.advanceMockStatus)
  const refresh = useClipStore((s) => s.refreshData)
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])
  useEffect(() => {
    const id = setInterval(advance, 8000)
    return () => clearInterval(id)
  }, [advance])
  const [open, setOpen] = useState(false)
  return (
    <div className="layout">
      <LiveNotifier />
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="sidebar">
        <div className="brand-row">
          <span className="brand">Clip<b>Spike</b></span>
          <button
            type="button"
            className="menu-btn"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
        <nav id="main-nav" className={`nav${open ? ' open' : ''}`} aria-label="Main" onClick={() => setOpen(false)}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <StreamerStatus />
      </header>
      <main className="main" id="main" tabIndex={-1}>
        <div className="content">
          <ErrorBanner />
          <UpdatedAt />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
