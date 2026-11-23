export const REDIRECT_KEY = 'clipspike:spa-redirect'

// Returns the path (relative to the app base) that history should be rewritten to, or null.
export function resolveEntryPath(
  base: string,
  loc: { pathname: string; search: string; hash: string },
  stored: string | null,
): string | null {
  const b = base.endsWith('/') ? base : `${base}/`
  // 404.html stashed the originally requested URL before bouncing to the app root.
  if (stored && stored.startsWith(b) && loc.pathname === b && !loc.hash) return stored
  // Old HashRouter links: /app/#/clips -> /app/clips
  if (loc.hash.startsWith('#/') && loc.pathname === b) {
    return b + loc.hash.slice(2).replace(/^\/+/, '') + loc.search
  }
  return null
}

export function restoreEntryPath(base: string): void {
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(REDIRECT_KEY)
    sessionStorage.removeItem(REDIRECT_KEY)
  } catch {
    // storage unavailable
  }
  const next = resolveEntryPath(base, window.location, stored)
  if (next) window.history.replaceState(null, '', next)
}
