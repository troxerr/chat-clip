import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sanitizeFollows, toggleFollow } from '../lib/follows'

export const FOLLOWS_STORAGE_KEY = 'clipspike.follows'

interface FollowState {
  follows: string[]
  toggle: (login: string) => void
}

/** Follows stay in this browser only; nothing is sent anywhere unless the user submits the alerts signup. */
export const useFollowStore = create<FollowState>()(
  persist(
    (set) => ({
      follows: [],
      toggle: (login) => set((s) => ({ follows: toggleFollow(s.follows, login) })),
    }),
    {
      name: FOLLOWS_STORAGE_KEY,
      partialize: ({ follows }) => ({ follows }),
      merge: (persisted, current) => ({
        ...current,
        follows: sanitizeFollows((persisted as { follows?: unknown } | null)?.follows),
      }),
    },
  ),
)
