import { create } from 'zustand'
import { mockClips, type Clip } from '../data/clips'

export type { Clip }

interface ClipState {
  clips: Clip[]
  toggleFavorite: (id: number) => void
  removeClip: (id: number) => void
}

export const useClipStore = create<ClipState>((set) => ({
  clips: mockClips,
  toggleFavorite: (id) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)) })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
}))
