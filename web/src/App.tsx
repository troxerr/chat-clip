import { Route, Routes, useSearchParams } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Clips from './pages/Clips'
import ClipDetail from './pages/ClipDetail'
import Streamers from './pages/Streamers'
import About from './pages/About'
import Pro from './pages/Pro'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import NotFound from './pages/NotFound'
import Streamer from './pages/Streamer'
import RouteHead from './components/RouteHead'

function ProRoute() {
  const [params] = useSearchParams()
  const mac = params.get('platform') === 'mac'
  return <Pro key={mac ? 'mac' : 'pro'} mac={mac} />
}

export default function App() {
  return (
    <>
      <RouteHead />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="clips" element={<Clips />} />
          <Route path="clips/:id" element={<ClipDetail />} />
          <Route path="streamers" element={<Streamers />} />
          <Route path="streamer/:login" element={<Streamer />} />
          <Route path="about" element={<About />} />
          <Route path="pro" element={<ProRoute />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  )
}
