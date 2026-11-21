import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/clips', label: 'Clips' },
  { to: '/about', label: 'About' },
]

export default function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <span className="brand">ChatClip</span>
        <nav className="nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">© ChatClip</footer>
    </div>
  )
}
