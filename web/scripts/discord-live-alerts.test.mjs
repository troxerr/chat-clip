import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildPayload, findWentLive, isWebhookUrl, run } from './discord-live-alerts.mjs'

const HOOK = 'https://discord.com/api/webhooks/123456/abc-DEF_1'
const snap = (m) => ({ streamers: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'string' ? { status: v } : v])) })

describe('discord live alerts', () => {
  it('detects only offline -> live flips', () => {
    const prev = snap({ a: 'offline', b: 'live', c: 'offline' })
    const next = snap({ a: { status: 'live', game: 'G' }, b: 'live', c: 'offline', d: 'live' })
    expect(findWentLive(prev, next).map((s) => s.login)).toEqual(['a'])
    expect(findWentLive(null, next)).toEqual([])
  })

  it('validates webhook URLs and builds a mention-safe payload', () => {
    expect(isWebhookUrl(HOOK)).toBe(true)
    expect(isWebhookUrl('https://evil.example/api/webhooks/1/x')).toBe(false)
    const p = buildPayload({ login: 'a', title: '@everyone hi', viewers: 5 })
    expect(p.allowed_mentions).toEqual({ parse: [] })
    expect(p.embeds[0].title).toBe('a went live')
  })

  it('is a no-op without a secret and never logs the webhook', async () => {
    const fetchImpl = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await run({}, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    const dir = await mkdtemp(join(tmpdir(), 'alerts-'))
    const stateFile = join(dir, 's.json')
    const fetchOk = vi.fn(async () => ({ ok: true, status: 204, json: async () => snap({ a: 'offline' }) }))
    await run({ DISCORD_WEBHOOK_URL: HOOK, STATE_FILE: stateFile }, fetchOk)
    fetchOk.mockImplementation(async () => ({ ok: true, status: 200, json: async () => snap({ a: 'live' }) }))
    await run({ DISCORD_WEBHOOK_URL: HOOK, STATE_FILE: stateFile }, fetchOk)
    expect(fetchOk.mock.calls.some(([u]) => u === HOOK)).toBe(true)
    expect(JSON.parse(await readFile(stateFile, 'utf8')).streamers.a.status).toBe('live')
    expect(log.mock.calls.flat().join('\n')).not.toContain(HOOK)
    log.mockRestore()
  })
})
