import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Clip } from '../data/clips'
import ClipCard from './ClipCard'

const clip: Clip = {
  id: 'a', title: 't', streamer: 's', game: 'g', score: 90, signal: 'Twitch clip', createdAt: '2026-01-01T00:00:00Z',
  vodOffset: 0, duration: 10, views: 5, chatRate: 0, hue: 10, favorite: false, thumbnailUrl: 'https://img/x.jpg',
}
const thumb = (c: Clip) => render(<MemoryRouter><ClipCard clip={c} /></MemoryRouter>).container.querySelector('.thumb') as HTMLElement

describe('ClipCard thumbnail', () => {
  it('shows a normal thumbnail unblurred', () => {
    const el = thumb(clip)
    expect(el).not.toHaveClass('thumb-mature')
    expect(el.style.backgroundImage).toContain('https://img/x.jpg')
    expect(el.querySelector('.mature-tag')).toBeNull()
  })

  it('blurs mature thumbnails via the mature layer and labels them', () => {
    const el = thumb({ ...clip, mature: true })
    expect(el).toHaveClass('thumb-mature')
    expect(el.style.backgroundImage).toBe('')
    expect(el.style.getPropertyValue('--thumb-img')).toContain('https://img/x.jpg')
    expect(el.querySelector('.mature-tag')).not.toBeNull()
    expect(el.querySelector('.score')).not.toBeNull()
  })
})
