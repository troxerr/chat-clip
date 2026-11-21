import { describe, expect, it } from 'vitest'
import { selectStreamer } from './streamers'

const backups = ['a', 'b', 'c']

describe('selectStreamer', () => {
  it('keeps the primary while live', () => {
    const r = selectStreamer('p', backups, { p: 'live', a: 'live' })
    expect(r).toEqual({ streamer: 'p', usingBackup: false, allOffline: false })
  })
  it('switches to the first live backup in order', () => {
    const r = selectStreamer('p', backups, { p: 'offline', a: 'offline', b: 'live', c: 'live' })
    expect(r).toEqual({ streamer: 'b', usingBackup: true, allOffline: false })
  })
  it('returns to the primary when it comes back', () => {
    const r = selectStreamer('p', backups, { p: 'live', a: 'live' })
    expect(r.streamer).toBe('p')
  })
  it('reports allOffline when nobody is live', () => {
    const r = selectStreamer('p', backups, {})
    expect(r).toEqual({ streamer: 'p', usingBackup: false, allOffline: true })
  })
})
