// Fetches live status + recent clips from the Twitch Helix API and writes static JSON
// to public/data/. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment.
// Never logs credentials or tokens. Run from web/: `node scripts/fetch-twitch-data.mjs`.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The shared default list (config/streamers.json) drives which streamers get live data.
const config = JSON.parse(await readFile(new URL('../../config/streamers.json', import.meta.url), 'utf8'))
const STREAMERS = [...new Set([config.primary, ...config.backups].map((l) => String(l).toLowerCase()))]
const CLIPS_PER_STREAMER = 12
const CLIP_WINDOW_DAYS = 7
const HELIX = 'https://api.twitch.tv/helix'
// Get Streams, Get Users, Get Channels and Get Games each accept at most 100 ids.
const HELIX_BATCH = 100
const CLIP_CONCURRENCY = 5
const outDir = fileURLToPath(new URL('../public/data/', import.meta.url))

const clientId = process.env.TWITCH_CLIENT_ID
const clientSecret = process.env.TWITCH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set')
  process.exit(1)
}

async function getToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

function chunks(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Runs `fn` over `items` with a small pool so a long streamer list cannot stampede Helix. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  const token = await getToken()
  const helix = async (path, params) => {
    const res = await fetch(`${HELIX}/${path}?${params}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(`Helix ${path} failed: HTTP ${res.status} ${String(body.message ?? '').slice(0, 200)}`.trim())
    }
    return (await res.json()).data
  }
  const helixMany = async (path, key, values) => {
    const rows = []
    for (const batch of chunks(values, HELIX_BATCH)) {
      if (!batch.length) continue
      rows.push(...(await helix(path, new URLSearchParams(batch.map((v) => [key, v])))))
    }
    return rows
  }
  const generatedAt = new Date().toISOString()
  // Get Streams filters by `user_login`; Get Users filters by `login`. Both cap at 100.
  const [streams, users] = await Promise.all([
    helixMany('streams', 'user_login', STREAMERS),
    helixMany('users', 'login', STREAMERS),
  ])
  const known = new Map(users.map((u) => [u.login.toLowerCase(), u]))
  const tracked = []
  for (const login of STREAMERS) {
    if (known.has(login)) tracked.push(login)
    else console.warn(`Skipping unknown login: ${login}`)
  }

  if (!tracked.length) throw new Error("No configured Twitch channels resolved")

  const startedAt = new Date(Date.now() - CLIP_WINDOW_DAYS * 864e5).toISOString()
  const perStreamer = await mapPool(tracked, CLIP_CONCURRENCY, (login) =>
    helix(
      'clips',
      new URLSearchParams({
        broadcaster_id: known.get(login).id,
        started_at: startedAt,
        first: String(CLIPS_PER_STREAMER),
      }),
    ),
  )
  const rawClips = perStreamer.flat()
  // Channel labels and game names are id lookups; batch them so a long catalog still resolves.
  const broadcasterIds = tracked.map((login) => known.get(login).id)
  const channels = broadcasterIds.length
    ? await helixMany('channels', 'broadcaster_id', broadcasterIds).catch((err) => {
        console.warn(err.message)
        return []
      })
    : []
  const enabledLabels = (channel) => {
    const labels = channel?.content_classification_labels
    if (!Array.isArray(labels)) return []
    return labels.filter((label) => label?.is_enabled && label.id).map((label) => String(label.id))
  }
  const channelById = new Map(channels.map((ch) => [ch.broadcaster_id, ch]))
  const liveByLogin = new Map(streams.filter((s) => s.type === 'live').map((s) => [s.user_login.toLowerCase(), s]))
  const status = {
    generatedAt,
    streamers: Object.fromEntries(
      tracked.map((login) => {
        const s = liveByLogin.get(login)
        const entry = s
          ? { status: 'live', viewers: s.viewer_count, title: s.title, game: s.game_name }
          : { status: 'offline' }
        const labels = enabledLabels(channelById.get(known.get(login).id))
        if (labels.length) entry.matureLabels = labels
        return [login, entry]
      }),
    ),
  }
  const gameIds = [...new Set(rawClips.map((c) => c.game_id).filter(Boolean))]
  const games = gameIds.length
    ? await helixMany('games', 'id', gameIds).catch((err) => {
        console.warn(err.message)
        return []
      })
    : []
  const gameName = new Map(games.map((g) => [g.id, g.name]))

  const clips = {
    generatedAt,
    clips: rawClips.map((c) => ({
      id: c.id,
      slug: c.id, // Helix clip ids are the clips.twitch.tv slugs
      title: c.title,
      streamer: c.broadcaster_name,
      game: gameName.get(c.game_id) ?? 'Unknown',
      createdAt: c.created_at,
      vodOffset: c.vod_offset ?? 0,
      duration: Math.round(c.duration),
      views: c.view_count,
      url: c.url,
      thumbnailUrl: c.thumbnail_url,
    })),
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(`${outDir}status.json`, JSON.stringify(status, null, 2))
  await writeFile(`${outDir}clips.json`, JSON.stringify(clips, null, 2))
  const live = Object.values(status.streamers).filter((s) => s.status === 'live').length
  console.log(`Wrote status.json (${live}/${tracked.length} live) and clips.json (${clips.clips.length} clips)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Unknown error')
  process.exit(1)
})
