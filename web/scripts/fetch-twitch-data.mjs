// Fetches live status + recent clips from the Twitch Helix API and writes static JSON
// to public/data/. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment.
// Never logs credentials or tokens. Run from web/: `node scripts/fetch-twitch-data.mjs`.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { labelsByBroadcaster } from './channel-labels.mjs'

// The shared default list (config/streamers.json) drives which streamers get live data.
const config = JSON.parse(await readFile(new URL('../../config/streamers.json', import.meta.url), 'utf8'))
const STREAMERS = [...new Set([config.primary, ...config.backups].map((l) => String(l).toLowerCase()))]
const CLIPS_PER_STREAMER = 12
const CLIP_WINDOW_DAYS = 7
const HELIX = 'https://api.twitch.tv/helix'
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

async function main() {
  const token = await getToken()
  const helix = async (path, params) => {
    const res = await fetch(`${HELIX}/${path}?${params}`, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(`Helix ${path} failed: HTTP ${res.status} ${String(body.message ?? '').slice(0, 200)}`.trim())
    }
    return (await res.json()).data
  }
  const generatedAt = new Date().toISOString()
  // Get Streams filters by `user_login`; Get Users filters by `login`.
  const [streams, users] = await Promise.all([
    helix('streams', new URLSearchParams(STREAMERS.map((l) => ['user_login', l]))),
    helix('users', new URLSearchParams(STREAMERS.map((l) => ['login', l]))),
  ])

  const liveByLogin = new Map(streams.filter((s) => s.type === 'live').map((s) => [s.user_login.toLowerCase(), s]))
  const status = {
    generatedAt,
    streamers: Object.fromEntries(
      STREAMERS.map((login) => {
        const s = liveByLogin.get(login)
        return [
          login,
          s ? { status: 'live', viewers: s.viewer_count, title: s.title, game: s.game_name } : { status: 'offline' },
        ]
      }),
    ),
  }

  const startedAt = new Date(Date.now() - CLIP_WINDOW_DAYS * 864e5).toISOString()
  const perStreamer = await Promise.all(
    users.map((u) =>
      helix(
        'clips',
        new URLSearchParams({ broadcaster_id: u.id, started_at: startedAt, first: String(CLIPS_PER_STREAMER) }),
      ).catch((err) => {
        console.warn(`Skipping clips for ${u.login}: ${err.message}`)
        return []
      }),
    ),
  )
  const rawClips = perStreamer.flat()
  // Channel content-classification labels (channel-level) feed the site's mature-content filter.
  const channelLabels = labelsByBroadcaster(
    await helix('channels', new URLSearchParams(users.map((u) => ['broadcaster_id', u.id]))).catch((err) => {
      console.warn(`Skipping channel labels: ${err.message}`)
      return []
    }),
  )
  const gameIds = [...new Set(rawClips.map((c) => c.game_id).filter(Boolean))].slice(0, 100)
  const games = gameIds.length
    ? await helix('games', new URLSearchParams(gameIds.map((id) => ['id', id]))).catch((err) => {
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
      matureLabels: channelLabels.get(c.broadcaster_id) ?? [],
    })),
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(`${outDir}status.json`, JSON.stringify(status, null, 2))
  await writeFile(`${outDir}clips.json`, JSON.stringify(clips, null, 2))
  const live = Object.values(status.streamers).filter((s) => s.status === 'live').length
  console.log(`Wrote status.json (${live}/${STREAMERS.length} live) and clips.json (${clips.clips.length} clips)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Unknown error')
  process.exit(1)
})
