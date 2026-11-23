export const APP_URL = 'https://clipspike.com/app/'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

interface Shareable {
  title: string
  streamer: string
  url?: string
}

// Routes are client-rendered, so crawlers only see the static OG tags of the
// app root or the Twitch clip page. Prefer the clip URL when we have one.
export function shareUrl(clip: Shareable): string {
  return clip.url || APP_URL
}

export async function shareClip(clip: Shareable): Promise<ShareResult> {
  const url = shareUrl(clip)
  const data = { title: clip.title, text: `${clip.title} — ${clip.streamer} on ClipSpike`, url }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
