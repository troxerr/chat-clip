import { normalizeLogin, validateLogin } from './streamerConfig'

export const MAX_FOLLOWS = 25

/** Coerces untrusted (e.g. localStorage) data into a deduplicated list of valid logins. */
export function sanitizeFollows(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    const { login, error } = validateLogin(v, out)
    if (!error) out.push(login)
    if (out.length >= MAX_FOLLOWS) break
  }
  return out
}

export function toggleFollow(follows: string[], input: string): string[] {
  const login = normalizeLogin(input)
  if (follows.includes(login)) return follows.filter((f) => f !== login)
  const { error } = validateLogin(login, follows)
  if (error || follows.length >= MAX_FOLLOWS) return follows
  return [...follows, login]
}

/** Followed streamers when the user follows anyone, otherwise every monitored streamer (original behaviour). */
export function notifyTargets(follows: string[], monitored: string[]): string[] {
  return follows.length ? follows : monitored
}
