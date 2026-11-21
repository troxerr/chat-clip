export type Signal = 'Chat spike' | 'Audio peak' | 'Clutch play' | 'Funny moment' | 'Hype train' | 'Twitch clip'

export interface Clip {
  id: number | string
  title: string
  streamer: string
  game: string
  score: number
  signal: Signal
  createdAt: string
  vodOffset: number
  duration: number
  views: number
  chatRate: number
  hue: number
  favorite: boolean
  url?: string
  thumbnailUrl?: string
}

export const FEATURED_STREAMER = 'Jynxzi'

const clip = (
  id: number,
  title: string,
  streamer: string,
  game: string,
  score: number,
  signal: Signal,
  createdAt: string,
  vodOffset: number,
  duration: number,
  views: number,
  chatRate: number,
): Clip => ({
  id, title, streamer, game, score, signal, createdAt, vodOffset, duration, views, chatRate,
  hue: (id * 47) % 360,
  favorite: false,
})

export const mockClips: Clip[] = [
  clip(1, 'Chat explodes after the 1v4 ace', 'Jynxzi', 'Valorant', 97, 'Clutch play', '2026-11-20T21:14:00Z', 7522, 30, 18420, 212),
  clip(2, 'The prank call nobody saw coming', 'Jynxzi', 'Just Chatting', 91, 'Funny moment', '2026-11-20T19:02:00Z', 3905, 42, 12310, 168),
  clip(3, 'Raid train hits 5,000 viewers', 'Jynxzi', 'Just Chatting', 88, 'Hype train', '2026-11-19T23:40:00Z', 10211, 25, 9984, 190),
  clip(4, 'Scream heard around the lobby', 'Jynxzi', 'Phasmophobia', 84, 'Audio peak', '2026-11-19T20:31:00Z', 5120, 18, 8730, 143),
  clip(5, 'Impossible last-second parry', 'novaquill', 'Elden Ring', 93, 'Clutch play', '2026-11-20T17:45:00Z', 12044, 35, 15200, 175),
  clip(6, 'Chat spams the wrong emote', 'novaquill', 'Elden Ring', 62, 'Chat spike', '2026-11-18T18:10:00Z', 2210, 20, 3120, 96),
  clip(7, 'Speedrun skip finally lands', 'pixelmoth', 'Celeste', 79, 'Clutch play', '2026-11-20T14:20:00Z', 8800, 28, 6020, 88),
  clip(8, 'Cat walks across the keyboard', 'pixelmoth', 'Celeste', 71, 'Funny moment', '2026-11-17T16:05:00Z', 1500, 15, 5410, 120),
  clip(9, 'Sub goal smashed in 90 seconds', 'driftwoodtv', 'Fortnite', 85, 'Hype train', '2026-11-19T22:00:00Z', 6400, 40, 7800, 201),
  clip(10, 'Mic peaks on the final zone', 'driftwoodtv', 'Fortnite', 58, 'Audio peak', '2026-11-16T20:50:00Z', 9100, 22, 2100, 74),
]

// Real Twitch streamers, ordered by priority; the first live one is used when the featured streamer goes offline.
export const BACKUP_STREAMERS = ['kaicenat', 'xqc', 'ishowspeed', 'pokimane']

// Mock status timeline (no Twitch API); the store steps through it on a timer.
export const MOCK_STATUS_TIMELINE: Record<string, 'live' | 'offline'>[] = [
  { Jynxzi: 'live', kaicenat: 'live', xqc: 'live', ishowspeed: 'offline', pokimane: 'live' },
  { Jynxzi: 'offline', kaicenat: 'offline', xqc: 'live', ishowspeed: 'live', pokimane: 'live' },
  { Jynxzi: 'offline', kaicenat: 'offline', xqc: 'offline', ishowspeed: 'live', pokimane: 'live' },
  { Jynxzi: 'offline', kaicenat: 'offline', xqc: 'offline', ishowspeed: 'offline', pokimane: 'live' },
  { Jynxzi: 'live', kaicenat: 'live', xqc: 'live', ishowspeed: 'offline', pokimane: 'live' },
]
