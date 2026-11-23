import { describe, expect, it } from 'vitest'
import { isLikelyMature } from './matureFilter'

const t = (title: string, id = 'x') => isLikelyMature({ id, title })

describe('isLikelyMature', () => {
  it('flags explicit title words, case-insensitively', () => {
    expect(t('GYATT OMG THAT CRAZY')).toBe(true)
    expect(t('She is NAKED lol')).toBe(true)
    expect(t('nsfw moment')).toBe(true)
    expect(t('18+ only')).toBe(true)
    expect(t('lap dance gone wrong')).toBe(true)
  })

  it('matches whole words only', () => {
    expect(t('Essex derby')).toBe(false)
    expect(t('strips of paper')).toBe(false)
    expect(t('Insane 1v5 clutch')).toBe(false)
    expect(t('o0mg')).toBe(false)
  })
})
