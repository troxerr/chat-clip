import { describe, expect, it } from 'vitest'
import { parseClips, parseStatus, scoreFromViews } from './twitchData'
import { selectStreamer } from './streamers'

const NAMES = ['Jynxzi', 'kaicenat', 'xqc']

describe('parseStatus', () => {
  it('maps lowercase logins onto configured names and defaults to offline', () => {
    const s = parseStatus({ streamers: { jynxzi: { status: 'offline' }, kaicenat: { status: 'live' } } }, NAMES)
    expect(s).toEqual({ Jynxzi: 'offline', kaicenat: 'live', xqc: 'offline' })
  })

  it('drives backup fallback from real status', () => {
    const s = parseStatus({ streamers: { jynxzi: { status: 'offline' }, xqc: { status: 'live' } } }, NAMES)!
    expect(selectStreamer('Jynxzi', ['kaicenat', 'xqc'], s)).toMatchObject({ streamer: 'xqc', usingBackup: true })
  })

  it('rejects invalid payloads', () => {
    expect(parseStatus(null, NAMES)).toBeNull()
    expect(parseStatus({ streamers: 5 }, NAMES)).toBeNull()
  })
})

describe('parseClips', () => {
  const raw = (id: string, views: number, streamer = 'jynxzi') => ({
    id, title: `t${id}`, streamer, game: 'Valorant', createdAt: '2026-11-20T00:00:00Z',
    vodOffset: 10, duration: 30, views, url: 'https://clips.twitch.tv/x',
  })

  it('maps clips, canonicalizes streamer names and skips malformed entries', () => {
    const clips = parseClips({ clips: [raw('a', 1000), { bogus: true }, raw('b', 10)] }, NAMES)!
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ id: 'a', streamer: 'Jynxzi', score: 99, favorite: false })
    expect(clips[1].score).toBeLessThan(clips[0].score)
  })

  it('keeps mature-titled clips but flags them', () => {
    const clips = parseClips(
      { clips: [{ ...raw('a', 50), title: 'GYATT OMG THAT CRAZY' }, { ...raw('b', 10), title: 'Insane clutch' }] },
      NAMES,
    )!
    expect(clips.map((c) => [c.id, c.mature])).toEqual([['a', true], ['b', false]])
  })

  it('flags clips from channels labelled with sexual or graphic-violence themes', () => {
    const clips = parseClips(
      {
        clips: [
          { ...raw('a', 50), matureLabels: ['SexualThemes'] },
          { ...raw('b', 40), matureLabels: ['MatureGame', 'ProfanityVulgarity'] },
          { ...raw('c', 30), matureLabels: 'bogus' },
          raw('d', 20),
        ],
      },
      NAMES,
    )!
    expect(clips.map((c) => [c.id, c.mature])).toEqual([['a', true], ['b', false], ['c', false], ['d', false]])
  })

  it('rejects invalid payloads', () => {
    expect(parseClips({}, NAMES)).toBeNull()
  })

  it('scores within 50-99', () => {
    expect(scoreFromViews(0, 0)).toBe(50)
    expect(scoreFromViews(0, 100)).toBe(50)
    expect(scoreFromViews(100, 100)).toBe(99)
  })
})
