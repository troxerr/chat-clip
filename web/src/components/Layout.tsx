import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useClipStore } from '../store/useClipStore'
import { ErrorBanner, UpdatedAt } from './DataStatus'
import LiveNotifier from './LiveNotifier'
import StreamerStatus from './StreamerStatus'
import SponsorSlot from '../monetization/SponsorSlot'
import SupportLink from '../monetization/SupportLink'
import ConsentBanner, { CookieSettingsButton } from '../monetization/ConsentBanner'
import { Link } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/clips', label: 'Clips' },
  { to: '/streamers', label: 'Streamers' },
  { to: '/pro', label: 'Pro' },
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
        <SupportLink placement="sidebar" className="support-link support-sidebar" />
        <SponsorSlot placement="sidebar" />
      </header>
      <main className="main" id="main" tabIndex={-1}>
        <div className="content">
          <ErrorBanner />
          <UpdatedAt />
          <Outlet />
        </div>
        <footer className="site-footer">
          <p className="meta">
            Some links on ClipSpike are sponsored or affiliate links; we may earn a commission. Not affiliated with or endorsed by Twitch.
          </p>
          <nav aria-label="Footer" className="footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/pro">Pro</Link>
            <SupportLink placement="footer" />
            <CookieSettingsButton />
          </nav>
        </footer>
      </main>
      <ConsentBanner />
    </div>
  )
}
