import { create } from 'zustand'

export interface Clip {
  id: number
  title: string
}

interface ClipState {
  clips: Clip[]
  addClip: (title: string) => void
  removeClip: (id: number) => void
}

export const useClipStore = create<ClipState>((set) => ({
  clips: [
    { id: 1, title: 'Sample clip one' },
    { id: 2, title: 'Sample clip two' },
  ],
  addClip: (title) =>
    set((s) => ({ clips: [...s.clips, { id: Date.now(), title }] })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
}))
