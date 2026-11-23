// Conservative, ad- and platform-safe filter for clips that look sexual, explicit or profane.
// Twitch's clips API exposes no mature flag, so this is a heuristic over the clip title plus a
// manual blocklist of clip ids. It errs on the side of hiding. Add ids/terms here as needed.
//
// Matching is whole-word and tolerant of the usual dodges: elongation ("gyaaat"), leetspeak
// ("s3x", "p0rn"), accents, spaced or dotted letters ("s.e.x") and star-masked words ("f****").
// What happens to a flagged clip depends on monetization: blurred by default, hidden entirely
// once ads, sponsors or affiliate links are configured (see `visibleClips`).

/** Whole-word matches against the normalized clip title. Phrases may contain spaces. */
export const BLOCKED_TITLE_TERMS = [
  // sexual / nudity
  'gyatt', 'gyat', 'gyatts', 'shower', 'steamy', 'nude', 'nudes', 'naked', 'nsfw', 'porn', 'porno', 'pornhub', 'xxx', 'sex', 'sexy', 'sexual',
  'sexting', 'onlyfans', 'thot', 'tits', 'titty', 'titties', 'boob', 'boobs', 'boobies', 'nipple', 'nipples', 'booty', 'thicc', 'thirst trap', 'strip',
  'stripper', 'strippers', 'strip club', 'lap dance', 'twerk', 'twerking', 'horny', 'erotic', 'fetish', 'orgasm', 'moan', 'moaning', 'cleavage', 'lingerie',
  'topless', 'bikini', 'panties', 'thong', 'cum', 'blowjob', 'handjob', 'dildo', 'milf', 'hentai', 'masturbat', 'jerking off', 'gone wild', 'dick', 'dicks',
  'penis', 'vagina', 'pussy', 'cock', 'shaft', 'balls deep', 'rape', 'raped', 'rapist', 'molest', 'pedo', 'pedophile', 'incest', 'hooker', 'prostitute',
  // slurs (kept to the unambiguous ones)
  'nigga', 'nigger', 'faggot', 'fag', 'retard', 'retarded', 'tranny', 'kys',
  // gore / self-harm
  'suicide', 'kill yourself', 'decapitat', 'beheaded', 'gore', 'dismember', 'self harm',
  // age gates
  '18+', '21+', 'adult only',
]

/** Twitch clip ids (the Helix `id`) to always hide, e.g. clips a human reviewed. */
export const BLOCKED_CLIP_IDS: string[] = []

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' }

/** Lowercases, strips accents, undoes leetspeak next to letters ("s3x") and joins dotted letters ("s.e.x"). Match-only: never shown. */
export function normalizeTitle(title: string): string {
  const base = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  const unleet = base.replace(/[013457@$]/g, (ch, i: number) =>
    /\p{L}/u.test(base[i - 1] ?? '') || /\p{L}/u.test(base[i + 1] ?? '') ? LEET[ch] : ch,
  )
  return unleet.replace(/\b(?:\p{L}[.\-_*]){2,}\p{L}\b/gu, (m) => m.replace(/[.\-_*]/g, ''))
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Each letter may repeat ("gyaaat", "sexxx"); spaces in phrases match any run of whitespace.
const elongate = (term: string) =>
  term
    .split('')
    .map((ch) => (/\p{L}/u.test(ch) ? `${ch}+` : ch === ' ' ? '\\s+' : escape(ch)))
    .join('')
const STEMS = new Set(['decapitat', 'dismember', 'masturbat', 'molest'])
const alternation = (terms: string[]) => terms.map(elongate).join('|')
const TITLE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${alternation(BLOCKED_TITLE_TERMS.filter((t) => !STEMS.has(t)))})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?:${alternation([...STEMS])})`,
  'iu',
)
// A word with 2+ asterisks standing in for letters: "f******", "P****", "s**t".
const MASKED_RE = /\p{L}\*{2,}|\p{L}\*+\p{L}|\*{2,}\p{L}/u

export function isLikelyMature(clip: { id: string | number; title: string }): boolean {
  if (BLOCKED_CLIP_IDS.includes(String(clip.id))) return true
  const { title } = clip
  return TITLE_RE.test(title) || TITLE_RE.test(normalizeTitle(title)) || MASKED_RE.test(title)
}

/** Ad-safe view of a clip list: flagged clips are dropped when `hide` is set, otherwise returned (to be blurred). */
export function visibleClips<T extends { mature?: boolean }>(clips: T[], hide: boolean): T[] {
  return hide ? clips.filter((c) => !c.mature) : clips
}
