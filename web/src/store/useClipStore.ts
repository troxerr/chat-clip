import { create } from 'zustand'
import { BACKUP_STREAMERS, FEATURED_STREAMER, mockClips, MOCK_STATUS_TIMELINE, type Clip } from '../data/clips'
import type { StatusMap } from '../lib/streamers'
import { parseClips, parseStatus } from '../lib/twitchData'

export type { Clip }
export type DataSource = 'live' | 'demo'
export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type Id = Clip['id']

interface ClipState {
  clips: Clip[]
  dismissed: Id[]
  toggleFavorite: (id: Id) => void
  removeClip: (id: Id) => void
  streamStatus: StatusMap
  timelineIndex: number
  dataSource: DataSource
  generatedAt: string | null
  loadState: LoadState
  setStreamStatus: (status: StatusMap) => void
  advanceMockStatus: () => void
  refreshData: () => Promise<void>
}

const NAMES = [FEATURED_STREAMER, ...BACKUP_STREAMERS]

async function fetchJson(file: string): Promise<unknown> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const useClipStore = create<ClipState>((set, get) => ({
  clips: mockClips,
  dismissed: [],
  toggleFavorite: (id) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)) })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id), dismissed: [...s.dismissed, id] })),
  streamStatus: MOCK_STATUS_TIMELINE[0],
  timelineIndex: 0,
  dataSource: 'demo',
  generatedAt: null,
  loadState: 'idle',
  setStreamStatus: (status) => set({ streamStatus: status }),
  advanceMockStatus: () =>
    set((s) => {
      if (s.dataSource === 'live') return s
      const i = (s.timelineIndex + 1) % MOCK_STATUS_TIMELINE.length
      return { timelineIndex: i, streamStatus: MOCK_STATUS_TIMELINE[i] }
    }),
  /** Loads generated Twitch JSON; keeps demo data (or the last live data) if the fetch or parse fails. */
  refreshData: async () => {
    // Background polls stay quiet; only the first load (or a retry after an error) shows skeletons.
    if (get().loadState !== 'ready') set({ loadState: 'loading' })
    try {
      const [statusJson, clipsJson] = await Promise.all([fetchJson('status.json'), fetchJson('clips.json')])
      const status = parseStatus(statusJson, NAMES)
      const fresh = parseClips(clipsJson, NAMES)
      if (!status || !fresh) throw new Error('Invalid data')
      const { clips, dismissed } = get()
      const favorites = new Set(clips.filter((c) => c.favorite).map((c) => c.id))
      set({
        streamStatus: status,
        clips: fresh.filter((c) => !dismissed.includes(c.id)).map((c) => ({ ...c, favorite: favorites.has(c.id) })),
        dataSource: 'live',
        loadState: 'ready',
        generatedAt: (statusJson as { generatedAt?: string }).generatedAt ?? null,
      })
    } catch {
      // Never loaded live data: stay on (or return to) bundled demo data.
      // After a successful load, keep showing last live data and don't flag an error.
      if (get().dataSource !== 'live') set({ dataSource: 'demo', loadState: 'error' })
      else set({ loadState: 'ready' })
    }
  },
}))
