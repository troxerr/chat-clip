import { NavLink, Outlet } from 'react-router-dom'
import { FEATURED_STREAMER } from '../data/clips'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/clips', label: 'Clips' },
  { to: '/about', label: 'About' },
]

export default function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <span className="brand">Chat<b>Clip</b></span>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="following">
          <span className="meta">Featured streamer</span>
          <span className="streamer">{FEATURED_STREAMER}</span>
        </div>
      </aside>
      <main className="main">
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
