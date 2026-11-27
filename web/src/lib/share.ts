import { pageUrl } from './seo'

export const APP_URL = 'https://clipspike.com/app/'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

interface Shareable {
  id?: string | number
  title: string
  streamer: string
  url?: string
}

/** Canonical ClipSpike clip page. Trailing slash matches the prerendered URL. */
export function canonicalClipUrl(id: string | number): string {
  return pageUrl('/app/', `/clips/${id}`)
}

export function shareUrl(clip: Shareable): string {
  if (clip.id !== undefined && clip.id !== null && String(clip.id) !== '') return canonicalClipUrl(clip.id)
  return APP_URL
}

/** Copies a ClipSpike permalink with a source marker for aggregate share attribution. */
export async function shareClip(clip: Shareable): Promise<ShareResult> {
  try {
    const url = new URL(shareUrl(clip))
    if (url.href !== APP_URL) url.searchParams.set('from', 'share')
    await navigator.clipboard.writeText(url.href)
    return 'copied'
  } catch {
    return 'failed'
  }
}
