import { Link } from 'react-router-dom'
import { useClipStore } from '../store/useClipStore'

export default function Home() {
  const count = useClipStore((s) => s.clips.length)
  return (
    <>
      <h1>Welcome</h1>
      <p>
        You have {count} clip{count === 1 ? '' : 's'}. <Link to="/clips">Manage clips</Link>
      </p>
    </>
  )
}
