import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipStore } from './useClipStore'

const initial = useClipStore.getState()

describe('useClipStore', () => {
  beforeEach(() => useClipStore.setState(initial, true))
  afterEach(() => vi.useRealTimers())

  it('starts with two sample clips', () => {
    expect(useClipStore.getState().clips.map((c) => c.title)).toEqual([
      'Sample clip one',
      'Sample clip two',
    ])
  })

  it('adds a clip with a timestamp id', () => {
    vi.useFakeTimers()
    vi.setSystemTime(12345)
    useClipStore.getState().addClip('New')
    const clips = useClipStore.getState().clips
    expect(clips).toHaveLength(3)
    expect(clips[2]).toEqual({ id: 12345, title: 'New' })
  })

  it('removes a clip by id and ignores unknown ids', () => {
    useClipStore.getState().removeClip(1)
    expect(useClipStore.getState().clips.map((c) => c.id)).toEqual([2])
    useClipStore.getState().removeClip(999)
    expect(useClipStore.getState().clips).toHaveLength(1)
  })
})
