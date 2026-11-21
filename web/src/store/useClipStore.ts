import { create } from 'zustand'
import { mockClips, MOCK_STATUS_TIMELINE, type Clip } from '../data/clips'
import type { StatusMap } from '../lib/streamers'

export type { Clip }

interface ClipState {
  clips: Clip[]
  toggleFavorite: (id: number) => void
  removeClip: (id: number) => void
  streamStatus: StatusMap
  timelineIndex: number
  setStreamStatus: (status: StatusMap) => void
  advanceMockStatus: () => void
}

export const useClipStore = create<ClipState>((set) => ({
  clips: mockClips,
  toggleFavorite: (id) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)) })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  streamStatus: MOCK_STATUS_TIMELINE[0],
  timelineIndex: 0,
  setStreamStatus: (status) => set({ streamStatus: status }),
  advanceMockStatus: () =>
    set((s) => {
      const i = (s.timelineIndex + 1) % MOCK_STATUS_TIMELINE.length
      return { timelineIndex: i, streamStatus: MOCK_STATUS_TIMELINE[i] }
    }),
}))
