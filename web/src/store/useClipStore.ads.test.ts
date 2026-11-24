import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildConfig } from '../monetization/config'

const files = {
  'status.json': { generatedAt: 'now', streamers: { xqc: { status: 'offline' } } },
  'clips.json': {
    clips: [
      { id: 'ok', title: 'Clutch', streamer: 'xqc', game: 'G', createdAt: '2026-11-20T00:00:00Z', vodOffset: 0, duration: 20, views: 5 },
      { id: 'bad', title: 'GYATT', streamer: 'xqc', game: 'G', createdAt: '2026-11-20T00:00:00Z', vodOffset: 0, duration: 20, views: 9 },
    ],
  },
} as Record<string, unknown>

async function load(env: Record<string, string>) {
  vi.resetModules()
  vi.doMock('../monetization', () => ({ monetization: buildConfig(env, []) }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => files[url.split('/').pop()!] })))
  const { useClipStore } = await import('./useClipStore')
  await useClipStore.getState().refreshData()
  return useClipStore.getState().clips
}

describe('mature clips vs monetization', () => {
  afterEach(() => {
    vi.doUnmock('../monetization')
    vi.unstubAllGlobals()
  })

  it('keeps flagged clips (blurred in the UI) when nothing sponsored is configured', async () => {
    const clips = await load({ VITE_SUPPORT_URL: 'https://ko-fi.com/x' })
    expect(clips.map((c) => c.id).sort()).toEqual(['bad', 'ok'])
    expect(clips.find((c) => c.id === 'bad')?.mature).toBe(true)
  })

  it('drops flagged clips entirely once a sponsor is configured', async () => {
    const clips = await load({ VITE_ADS_ENABLED: 'true', VITE_SPONSOR_NAME: 'Acme', VITE_SPONSOR_URL: 'https://acme.example' })
    expect(clips.map((c) => c.id)).toEqual(['ok'])
  })
})
