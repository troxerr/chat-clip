import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_URL, canonicalClipUrl, shareClip, shareUrl } from './share'

const clip = { id: 'FunnyMoment', title: 'Big play', streamer: 'ninja', url: 'https://clips.twitch.tv/abc' }

function stubNav(nav: Partial<Navigator>) {
  vi.stubGlobal('navigator', nav)
}

afterEach(() => vi.unstubAllGlobals())

describe('shareUrl', () => {
  it('copies the canonical clipspike.com clip URL, not the Twitch URL', () => {
    expect(canonicalClipUrl(clip.id)).toBe('https://clipspike.com/app/clips/FunnyMoment/')
    expect(shareUrl(clip)).toBe('https://clipspike.com/app/clips/FunnyMoment/')
    expect(shareUrl({ title: clip.title, streamer: clip.streamer })).toBe(APP_URL)
  })
})

describe('shareClip', () => {
  it('copies the permalink with share attribution and reports copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNav({ share: vi.fn(), clipboard: { writeText } as never })
    expect(await shareClip(clip)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://clipspike.com/app/clips/FunnyMoment/?from=share')
  })

  it('returns failed when clipboard is unavailable', async () => {
    stubNav({})
    expect(await shareClip(clip)).toBe('failed')
  })
})
