import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  addBackup,
  DEFAULT_CONFIG,
  moveBackup,
  removeBackup,
  sanitizeConfig,
  setPrimary,
  type StreamerConfig,
} from '../lib/streamerConfig'

export const STREAMERS_STORAGE_KEY = 'clipspike.streamers'

interface StreamerState extends StreamerConfig {
  /** Returns an error message, or null on success. */
  add: (input: string) => string | null
  remove: (login: string) => void
  makePrimary: (login: string) => void
  move: (login: string, delta: -1 | 1) => void
  reset: () => void
}

export const useStreamerStore = create<StreamerState>()(
  persist(
    (set, get) => {
      const apply = (config: StreamerConfig) => set(config)
      return {
        ...structuredClone(DEFAULT_CONFIG),
        add: (input) => {
          const { primary, backups } = get()
          const { config, error } = addBackup({ primary, backups }, input)
          if (!error) apply(config)
          return error
        },
        remove: (login) => apply(removeBackup(get(), login)),
        makePrimary: (login) => apply(setPrimary(get(), login)),
        move: (login, delta) => apply(moveBackup(get(), login, delta)),
        reset: () => apply(structuredClone(DEFAULT_CONFIG)),
      }
    },
    {
      name: STREAMERS_STORAGE_KEY,
      partialize: ({ primary, backups }) => ({ primary, backups }),
      merge: (persisted, current) => ({ ...current, ...sanitizeConfig(persisted ?? current) }),
    },
  ),
)
