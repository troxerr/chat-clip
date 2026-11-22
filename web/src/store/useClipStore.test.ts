import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../lib/streamerConfig'
import { useClipStore } from './useClipStore'

const initial = useClipStore.getState()

describe('useClipStore', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('starts with mock highlights including Jynxzi', () => {
    const clips = useClipStore.getState().clips
    expect(clips.length).toBeGreaterThan(5)
    expect(clips.some((c) => c.streamer === DEFAULT_CONFIG.primary)).toBe(true)
  })

  it('toggles favorite', () => {
    useClipStore.getState().toggleFavorite(1)
    expect(useClipStore.getState().clips.find((c) => c.id === 1)?.favorite).toBe(true)
    useClipStore.getState().toggleFavorite(1)
    expect(useClipStore.getState().clips.find((c) => c.id === 1)?.favorite).toBe(false)
  })

  it('removes a clip by id and ignores unknown ids', () => {
    const n = useClipStore.getState().clips.length
    useClipStore.getState().removeClip(1)
    expect(useClipStore.getState().clips).toHaveLength(n - 1)
    useClipStore.getState().removeClip(999)
    expect(useClipStore.getState().clips).toHaveLength(n - 1)
  })

  describe('refreshData', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('loads live data and replaces demo clips and status', async () => {
      const files: Record<string, unknown> = {
        'status.json': { generatedAt: 'now', streamers: { jynxzi: { status: 'offline' }, xqc: { status: 'live' } } },
        'clips.json': { clips: [{ id: 'z', title: 'Real', streamer: 'xqc', game: 'G', createdAt: '2026-11-20T00:00:00Z', vodOffset: 0, duration: 20, views: 5 }] },
      }
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => files[url.split('/').pop()!] })))
      await useClipStore.getState().refreshData()
      const s = useClipStore.getState()
      expect(s.dataSource).toBe('live')
      expect(s.streamStatus.xqc).toBe('live')
      expect(s.clips.map((c) => c.id)).toEqual(['z'])
    })

    it('falls back to demo data when the fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
      await useClipStore.getState().refreshData()
      expect(useClipStore.getState().dataSource).toBe('demo')
      expect(useClipStore.getState().clips.length).toBeGreaterThan(5)
    })
  })
})
