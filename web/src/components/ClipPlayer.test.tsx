import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Clip } from '../data/clips'
import { clipEmbedUrl } from '../lib/embed'
import { parseClips } from '../lib/twitchData'
import ClipPlayer from './ClipPlayer'

const base: Clip = {
  id: 'AbcSlug', title: 'Big play', streamer: 'xqc', game: 'G', score: 90, signal: 'Twitch clip',
  createdAt: '2026-01-01T00:00:00Z', vodOffset: 0, duration: 10, views: 5, chatRate: 0, hue: 10, favorite: false,
  slug: 'AbcSlug', thumbnailUrl: 'https://img/x.jpg',
}

describe('ClipPlayer', () => {
  it('builds the embed url with both parents', () => {
    expect(clipEmbedUrl('AbcSlug')).toBe(
      'https://clips.twitch.tv/embed?clip=AbcSlug&parent=clipspike.com&parent=www.clipspike.com&parent=troxerr.github.io&parent=localhost&autoplay=true',
    )
  })

  it('mounts the iframe only after clicking the poster', async () => {
    render(<ClipPlayer clip={base} />)
    expect(document.querySelector('iframe')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play clip: Big play' }))
    expect(screen.getByTitle('Twitch clip: Big play')).toHaveAttribute('src', clipEmbedUrl('AbcSlug'))
  })

  it('blurs the poster for mature clips and still plays on click', async () => {
    render(<ClipPlayer clip={{ ...base, mature: true }} />)
    const btn = screen.getByRole('button', { name: 'Play clip: Big play' })
    expect(btn).toHaveClass('player-poster-mature')
    expect(btn).toHaveTextContent('Mature content')
    await userEvent.click(btn)
    expect(screen.getByTitle('Twitch clip: Big play')).toBeInTheDocument()
  })

  it('does not blur normal clips', () => {
    render(<ClipPlayer clip={base} />)
    expect(screen.getByRole('button')).not.toHaveClass('player-poster-mature')
  })

  it('shows no play button without a slug', () => {
    render(<ClipPlayer clip={{ ...base, slug: undefined }} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('derives slug from id when clips.json lacks one', () => {
    const clips = parseClips({ clips: [{ id: 'Z1', title: 't', streamer: 's', createdAt: 'x', views: 1 }] }, [])
    expect(clips?.[0].slug).toBe('Z1')
  })
})
