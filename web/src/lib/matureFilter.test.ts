import { describe, expect, it } from 'vitest'
import { hasMatureLabel, isLikelyMature, normalizeTitle, visibleClips } from './matureFilter'

const t = (title: string, id = 'x') => isLikelyMature({ id, title })

describe('isLikelyMature', () => {
  it('flags explicit title words, case-insensitively', () => {
    expect(t('GYATT OMG THAT CRAZY')).toBe(true)
    expect(t('She is NAKED lol')).toBe(true)
    expect(t('nsfw moment')).toBe(true)
    expect(t('18+ only')).toBe(true)
    expect(t('lap dance gone wrong')).toBe(true)
    expect(t('Jynxzi looks at a mans shaft....')).toBe(true)
    expect(t('GTA 6 gone wild')).toBe(true)
  })

  it('catches elongation, leetspeak, accents and spaced letters', () => {
    expect(t('gyaaaat')).toBe(true)
    expect(t('GYAAAATT')).toBe(true)
    expect(t('s3x scene')).toBe(true)
    expect(t('p0rn')).toBe(true)
    expect(t('nüde')).toBe(true)
    expect(t('s.e.x tape')).toBe(true)
    expect(t('sexxx')).toBe(true)
  })

  it('catches star-masked profanity and slurs', () => {
    expect(t('XQC gets called a f****** P**** right after')).toBe(true)
    expect(t('what the s**t')).toBe(true)
    expect(t('kys')).toBe(true)
  })

  it('flags clips on the manual id blocklist only when listed', () => {
    expect(t('totally normal title', 'some-id')).toBe(false)
  })

  it('matches whole words only and leaves ordinary titles alone', () => {
    expect(t('Essex derby')).toBe(false)
    expect(t('strips of paper')).toBe(false)
    expect(t('Insane 1v5 clutch')).toBe(false)
    expect(t('o0mg')).toBe(false)
    expect(t('xQc listening to gta VI radio')).toBe(false)
    expect(t('THIS STREAM GOT WILD!!')).toBe(false)
    expect(t('Cockpit view in GTA 6')).toBe(false)
    expect(t('Scunthorpe vs Sussex')).toBe(false)
    expect(t('gta6 review so far 10/10')).toBe(false)
  })
})

describe('normalizeTitle', () => {
  it('only rewrites digits glued to letters', () => {
    expect(normalizeTitle('s3x')).toBe('sex')
    expect(normalizeTitle('gta 6 at 100%')).toBe('gta 6 at 100%')
  })
})

describe('visibleClips', () => {
  const clips = [{ id: 'a', mature: true }, { id: 'b', mature: false }, { id: 'c' }]
  it('keeps flagged clips (to be blurred) unless hiding', () => {
    expect(visibleClips(clips, false)).toHaveLength(3)
    expect(visibleClips(clips, true).map((c) => c.id)).toEqual(['b', 'c'])
  })
})

describe('hasMatureLabel', () => {
  it('counts only sexual and graphic-violence channel labels', () => {
    expect(hasMatureLabel(['SexualThemes'])).toBe(true)
    expect(hasMatureLabel(['MatureGame', 'ViolentGraphic'])).toBe(true)
    expect(hasMatureLabel(['MatureGame', 'ProfanityVulgarity', 'Gambling'])).toBe(false)
    expect(hasMatureLabel(undefined)).toBe(false)
    expect(hasMatureLabel('SexualThemes')).toBe(false)
  })
})
