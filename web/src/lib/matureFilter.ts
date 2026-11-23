// Conservative, ad- and platform-safe filter for clips that look sexual or explicit.
// Twitch's clips API exposes no mature flag, so this is a heuristic: a title word list plus a
// manual blocklist of clip ids. It errs on the side of hiding. Add ids/terms here as needed.

/** Whole-word, case-insensitive matches against the clip title. */
export const BLOCKED_TITLE_TERMS = [
  'gyatt', 'gyat', 'gyaat', 'gyaaat', 'shower', 'steamy', 'nude', 'nudes', 'naked', 'nsfw', 'porn', 'sex', 'sexy', 'onlyfans', 'thot',
  'tits', 'boobs', 'nipple', 'nipples', 'booty', 'thicc', 'strip', 'stripper', 'lap dance', '18+',
]

/** Twitch clip ids (the Helix `id`) to always hide, e.g. clips a human reviewed. */
export const BLOCKED_CLIP_IDS: string[] = []

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TITLE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BLOCKED_TITLE_TERMS.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu')

export function isLikelyMature(clip: { id: string | number; title: string }): boolean {
  return BLOCKED_CLIP_IDS.includes(String(clip.id)) || TITLE_RE.test(clip.title)
}
