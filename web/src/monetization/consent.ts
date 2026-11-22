import { useSyncExternalStore } from 'react'

export const CONSENT_KEY = 'clipspike:consent'

export interface Consent {
  decided: boolean
  ads: boolean
  analytics: boolean
}

const none: Consent = { decided: false, ads: false, analytics: false }
const listeners = new Set<() => void>()
let cache: Consent | null = null

function read(): Consent {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? 'null')
    if (v && v.v === 1) return { decided: true, ads: v.ads === true, analytics: v.analytics === true }
  } catch {
    /* unreadable storage: treat as undecided */
  }
  return none
}

export function getConsent(): Consent {
  return (cache ??= read())
}

export function setConsent(c: { ads: boolean; analytics: boolean }) {
  cache = { decided: true, ...c }
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, ...c }))
  } catch {
    /* session-only if storage is blocked */
  }
  listeners.forEach((l) => l())
}

/** Forget the choice so the banner is shown again. */
export function resetConsent() {
  cache = none
  try {
    localStorage.removeItem(CONSENT_KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

/** Test helper: drop the in-memory cache after touching localStorage directly. */
export function reloadConsent() {
  cache = null
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useConsent(): Consent {
  return useSyncExternalStore(subscribe, getConsent, () => none)
}
