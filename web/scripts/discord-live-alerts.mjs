// Posts "X went live" to a Discord webhook when status.json flips offline -> live.
// No-op unless DISCORD_WEBHOOK_URL is set. Never logs the webhook URL.
// Env: DISCORD_WEBHOOK_URL, STATUS_URL (deployed status.json), STATE_FILE (previous snapshot path).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/

export const isWebhookUrl = (v) => WEBHOOK_RE.test(v ?? '')

/** Logins explicitly 'offline' in prev and 'live' in next. A first run (no prev) or unknown streamer never alerts. */
export function findWentLive(prev, next) {
  const before = prev?.streamers ?? {}
  return Object.entries(next?.streamers ?? {})
    .filter(([login, s]) => before[login]?.status === 'offline' && s?.status === 'live')
    .map(([login, s]) => ({ login, ...s }))
}

export function buildPayload(s) {
  const url = `https://www.twitch.tv/${encodeURIComponent(s.login)}`
  const fields = []
  if (s.game) fields.push({ name: 'Playing', value: String(s.game).slice(0, 256), inline: true })
  if (typeof s.viewers === 'number') fields.push({ name: 'Viewers', value: String(s.viewers), inline: true })
  return {
    username: 'ClipSpike',
    allowed_mentions: { parse: [] },
    embeds: [{ title: `${s.login} went live`, description: String(s.title ?? '').slice(0, 256), url, color: 0x9147ff, fields }],
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export async function run(env = process.env, fetchImpl = fetch) {
  const hook = env.DISCORD_WEBHOOK_URL
  if (!hook) return console.log('DISCORD_WEBHOOK_URL not set; skipping.')
  if (!isWebhookUrl(hook)) return console.log('DISCORD_WEBHOOK_URL is not a Discord webhook URL; skipping.')
  const statusUrl = env.STATUS_URL || 'https://clipspike.com/app/data/status.json'
  const stateFile = env.STATE_FILE || '.alerts-state/status.json'

  const res = await fetchImpl(statusUrl, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`status.json fetch failed: HTTP ${res.status}`)
  const next = await res.json()
  if (!next || typeof next.streamers !== 'object') throw new Error('status.json is invalid')

  const prev = await readJson(stateFile)
  const live = findWentLive(prev, next)
  for (const s of live) {
    const r = await fetchImpl(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(s)),
    })
    console.log(`${s.login}: webhook HTTP ${r.status}`)
  }
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, JSON.stringify(next))
  console.log(`Checked status.json: ${live.length} went live.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error(String(e.message ?? e))
    process.exit(1)
  })
}
