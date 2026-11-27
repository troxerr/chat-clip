const site = new URL(process.env.CLIPSPIKE_SITE_URL || 'https://clipspike.com/')
const maxAgeMinutes = Number(process.env.CLIPSPIKE_MAX_FEED_AGE_MINUTES || 75)

async function get(path) {
  const url = new URL(path, site)
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

function feedAge(name, value) {
  const age = (Date.now() - Date.parse(value)) / 60_000
  if (!Number.isFinite(age) || age < -5) throw new Error(`${name}: invalid generatedAt`)
  console.log(`${name}: ${Math.round(age)} minutes old`)
  if (age > maxAgeMinutes) throw new Error(`${name}: older than ${maxAgeMinutes} minutes`)
}

try {
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) throw new Error('Invalid feed age limit')
  const [, , status, clips, featured] = await Promise.all([
    get('/'), get('/app/'),
    get('/app/data/status.json').then((r) => r.json()),
    get('/app/data/clips.json').then((r) => r.json()),
    get('/app/data/featured.json').then((r) => r.json()),
  ])
  if (!status.streamers || !Array.isArray(clips.clips)) throw new Error('Invalid Twitch feed shape')
  feedAge('Live status', status.generatedAt)
  feedAge('Clips', clips.generatedAt)
  if (!featured) {
    console.log('The feed is fresh and has no eligible featured clip to check')
  } else {
    if (!/^[a-z0-9_-]+$/i.test(featured.slug) ||
        !clips.clips.some((clip) => clip.id === featured.id)) throw new Error('Missing or invalid featured clip')
    const html = await get(`/app/clips/${encodeURIComponent(featured.id)}/`).then((r) => r.text())
    if (!html.includes('https://clips.twitch.tv/embed?') || !html.includes('property="og:image"')) {
      throw new Error('Featured clip page is missing its player or social preview')
    }
    console.log(`Featured watch page resolves for ${featured.id}`)
  }
} catch (error) {
  console.error(error.cause?.message || error.message)
  process.exitCode = 1
}
