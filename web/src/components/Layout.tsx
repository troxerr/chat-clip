import { NavLink, Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { useClipStore } from '../store/useClipStore'
import StreamerStatus from './StreamerStatus'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/clips', label: 'Clips' },
  { to: '/about', label: 'About' },
]

export default function Layout() {
  const advance = useClipStore((s) => s.advanceMockStatus)
  useEffect(() => {
    const id = setInterval(advance, 8000)
    return () => clearInterval(id)
  }, [advance])
  return (
    <div className="layout">
      <aside className="sidebar">
        <span className="brand">Clip<b>Spike</b></span>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <StreamerStatus />
      </aside>
      <main className="main">
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
