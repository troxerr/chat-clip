import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { notifySupport, type NotifySupport } from '../lib/liveNotifications'

export const NOTIFY_STORAGE_KEY = 'clipspike.notify'

interface NotifyState {
  enabled: boolean
  permission: NotifySupport
  /** Must be called from a user click: permission is only requested when enabling. */
  enable: () => Promise<void>
  disable: () => void
  syncPermission: () => void
}

export const useNotifyStore = create<NotifyState>()(
  persist(
    (set) => ({
      enabled: false,
      permission: notifySupport(),
      enable: async () => {
        if (typeof Notification === 'undefined') {
          set({ permission: 'unsupported', enabled: false })
          return
        }
        let permission: NotificationPermission = Notification.permission
        if (permission === 'default') {
          try {
            permission = await Notification.requestPermission()
          } catch {
            permission = Notification.permission
          }
        }
        set({ permission, enabled: permission === 'granted' })
      },
      disable: () => set({ enabled: false }),
      syncPermission: () => set({ permission: notifySupport() }),
    }),
    {
      name: NOTIFY_STORAGE_KEY,
      partialize: ({ enabled }) => ({ enabled }),
      merge: (persisted, current) => ({
        ...current,
        enabled: (persisted as { enabled?: unknown } | null)?.enabled === true && notifySupport() === 'granted',
      }),
    },
  ),
)
