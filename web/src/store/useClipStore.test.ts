import { beforeEach, describe, expect, it } from 'vitest'
import { FEATURED_STREAMER } from '../data/clips'
import { useClipStore } from './useClipStore'

const initial = useClipStore.getState()

describe('useClipStore', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('starts with mock highlights including jasontheween', () => {
    const clips = useClipStore.getState().clips
    expect(clips.length).toBeGreaterThan(5)
    expect(clips.some((c) => c.streamer === FEATURED_STREAMER)).toBe(true)
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
})
