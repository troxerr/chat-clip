export const EMBED_PARENTS = ['clipspike.com', 'www.clipspike.com', 'troxerr.github.io', 'localhost']

export function clipEmbedUrl(slug: string): string {
  const params = new URLSearchParams({ clip: slug })
  for (const p of EMBED_PARENTS) params.append('parent', p)
  params.set('autoplay', 'true')
  return `https://clips.twitch.tv/embed?${params}`
}
