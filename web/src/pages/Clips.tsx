import { useState, type FormEvent } from 'react'
import { useClipStore } from '../store/useClipStore'

export default function Clips() {
  const { clips, addClip, removeClip } = useClipStore()
  const [title, setTitle] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    addClip(title.trim())
    setTitle('')
  }

  return (
    <>
      <h1>Clips</h1>
      <form onSubmit={onSubmit} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New clip title" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {clips.map((c) => (
          <li key={c.id}>
            {c.title} <button onClick={() => removeClip(c.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </>
  )
}
