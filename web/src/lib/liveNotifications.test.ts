import { describe, expect, it } from 'vitest'
import { detectLiveTransitions, notificationContent } from './liveNotifications'
import { parseStreamDetails } from './twitchData'

const names = ['a', 'b', 'c']

describe('detectLiveTransitions', () => {
  it('reports only offline -> live', () => {
    const prev = { a: 'offline', b: 'live', c: 'offline' } as const
    const next = { a: 'live', b: 'live', c: 'offline' } as const
    expect(detectLiveTransitions(prev, next, names, { a: { game: 'Chess', viewers: 5 } })).toEqual([
      { streamer: 'a', game: 'Chess', viewers: 5 },
    ])
  })
  it('ignores live -> offline and unchanged states', () => {
    expect(detectLiveTransitions({ a: 'live' }, { a: 'offline' }, ['a'])).toEqual([])
    expect(detectLiveTransitions({ a: 'live' }, { a: 'live' }, ['a'])).toEqual([])
  })
  it('ignores streamers missing from the previous snapshot or no longer configured', () => {
    expect(detectLiveTransitions({}, { a: 'live', z: 'live' }, ['a'])).toEqual([])
    expect(detectLiveTransitions({ z: 'offline' }, { z: 'live' }, ['a'])).toEqual([])
  })
})

describe('notificationContent', () => {
  it('includes title, game and viewers', () => {
    expect(notificationContent({ streamer: 'a', title: 'Ranked', game: 'Chess', viewers: 1234 })).toEqual({
      title: 'a is live',
      body: 'Ranked · Playing Chess · 1,234 viewers',
    })
  })
  it('handles missing details', () => {
    expect(notificationContent({ streamer: 'a' })).toEqual({ title: 'a is live', body: '' })
  })
})

describe('parseStreamDetails', () => {
  it('maps live streamers case-insensitively', () => {
    const json = { streamers: { A: { status: 'live', title: 't', game: 'g', viewers: 3 }, b: { status: 'offline' } } }
    expect(parseStreamDetails(json, ['a', 'b'])).toEqual({ a: { title: 't', game: 'g', viewers: 3 } })
  })
})
