import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_URL, shareClip, shareUrl } from './share'

const clip = { title: 'Big play', streamer: 'ninja', url: 'https://clips.twitch.tv/abc' }

function stubNav(nav: Partial<Navigator>) {
  vi.stubGlobal('navigator', nav)
}

afterEach(() => vi.unstubAllGlobals())

describe('shareUrl', () => {
  it('uses the clip URL, falling back to the app root', () => {
    expect(shareUrl(clip)).toBe(clip.url)
    expect(shareUrl({ ...clip, url: '' })).toBe(APP_URL)
  })
})

describe('shareClip', () => {
  it('uses navigator.share when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNav({ share })
    expect(await shareClip(clip)).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: clip.url, title: 'Big play' }))
  })

  it('reports cancellation without copying', async () => {
    const writeText = vi.fn()
    stubNav({ share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')), clipboard: { writeText } as never })
    expect(await shareClip(clip)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies to clipboard when share is unavailable or fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNav({ clipboard: { writeText } as never })
    expect(await shareClip(clip)).toBe('copied')
    stubNav({ share: vi.fn().mockRejectedValue(new Error('nope')), clipboard: { writeText } as never })
    expect(await shareClip(clip)).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('returns failed when clipboard is unavailable', async () => {
    stubNav({})
    expect(await shareClip(clip)).toBe('failed')
  })
})
