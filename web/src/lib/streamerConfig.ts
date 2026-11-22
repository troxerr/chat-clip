import defaults from '../../../config/streamers.json'

export interface StreamerConfig {
  primary: string
  backups: string[]
}

/** Shared with scripts/fetch-twitch-data.mjs: only these logins get live data from the pipeline. */
export const DEFAULT_CONFIG: StreamerConfig = {
  primary: defaults.primary,
  backups: [...defaults.backups],
}

export const MAX_STREAMERS = 25

// Twitch logins: 3–25 letters, digits and underscores (legacy accounts like xqc predate the 4-char minimum).
const LOGIN_RE = /^[a-z0-9_]{3,25}$/

/** Lowercases and strips whitespace, a leading "@" and a twitch.tv/ prefix. */
export function normalizeLogin(input: string): string {
  return input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .toLowerCase()
}

export function validateLogin(input: string, existing: string[] = []): { login: string; error: string | null } {
  const login = normalizeLogin(input)
  if (!login) return { login, error: 'Enter a Twitch username.' }
  if (!LOGIN_RE.test(login)) {
    return { login, error: 'Twitch usernames are 3–25 characters: letters, numbers and underscores only.' }
  }
  if (existing.includes(login)) return { login, error: `${login} is already in your list.` }
  return { login, error: null }
}

export const allStreamers = (c: StreamerConfig): string[] => [c.primary, ...c.backups]

/** Coerces untrusted (e.g. localStorage) data into a valid config, falling back to the defaults. */
export function sanitizeConfig(raw: unknown): StreamerConfig {
  const r = raw as { primary?: unknown; backups?: unknown } | null
  if (!r || typeof r.primary !== 'string' || !Array.isArray(r.backups)) return structuredClone(DEFAULT_CONFIG)
  const primary = normalizeLogin(r.primary)
  if (!LOGIN_RE.test(primary)) return structuredClone(DEFAULT_CONFIG)
  const seen = new Set([primary])
  const backups: string[] = []
  for (const b of r.backups) {
    const login = typeof b === 'string' ? normalizeLogin(b) : ''
    if (LOGIN_RE.test(login) && !seen.has(login) && seen.size < MAX_STREAMERS) {
      seen.add(login)
      backups.push(login)
    }
  }
  return { primary, backups }
}

export function addBackup(c: StreamerConfig, input: string): { config: StreamerConfig; error: string | null } {
  const all = allStreamers(c)
  const { login, error } = validateLogin(input, all)
  if (error) return { config: c, error }
  if (all.length >= MAX_STREAMERS) return { config: c, error: `You can follow up to ${MAX_STREAMERS} streamers.` }
  return { config: { ...c, backups: [...c.backups, login] }, error: null }
}

/** Removes a backup. The primary can't be removed; promote another streamer first. */
export function removeBackup(c: StreamerConfig, login: string): StreamerConfig {
  return { ...c, backups: c.backups.filter((b) => b !== login) }
}

/** Promotes a backup to primary; the old primary becomes the first backup. */
export function setPrimary(c: StreamerConfig, login: string): StreamerConfig {
  if (!c.backups.includes(login)) return c
  return { primary: login, backups: [c.primary, ...c.backups.filter((b) => b !== login)] }
}

export function moveBackup(c: StreamerConfig, login: string, delta: -1 | 1): StreamerConfig {
  const from = c.backups.indexOf(login)
  const to = from + delta
  if (from < 0 || to < 0 || to >= c.backups.length) return c
  const backups = [...c.backups]
  ;[backups[from], backups[to]] = [backups[to], backups[from]]
  return { ...c, backups }
}
