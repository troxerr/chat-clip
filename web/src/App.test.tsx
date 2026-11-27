import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useClipStore } from './store/useClipStore'

const initial = { ...useClipStore.getState(), refreshData: async () => {} }

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('routing', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('renders Home at /', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Never miss the moment/ })).toBeInTheDocument()
    expect(screen.getByText('Top highlights')).toBeInTheDocument()
  })

  it('filters clips by streamer and sort on /clips', async () => {
    const user = userEvent.setup()
    renderAt('/clips')
    expect(screen.getByRole('heading', { name: 'Highlights' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('10 highlights')
    await user.selectOptions(screen.getByLabelText('Streamer'), 'jynxzi')
    expect(screen.getByRole('status')).toHaveTextContent('4 highlights')
    await user.type(screen.getByLabelText('Search clips'), 'zzz')
    expect(screen.getByText('No highlights match “zzz”.')).toBeInTheDocument()
  })

  it('restores filters from URL params on /clips', () => {
    renderAt('/clips?streamer=pixelmoth&game=Celeste&sort=views&q=cat')
    expect(screen.getByRole('status')).toHaveTextContent('1 highlight')
    expect(screen.getByLabelText('Streamer')).toHaveValue('pixelmoth')
    expect(screen.getByLabelText('Game')).toHaveValue('Celeste')
    expect(screen.getByLabelText('Sort by')).toHaveValue('views')
    expect(screen.getByLabelText('Search clips')).toHaveValue('cat')
  })

  it('shows an empty state with a working clear button', async () => {
    const user = userEvent.setup()
    renderAt('/clips?q=zzz')
    expect(screen.getByText('No highlights match “zzz”.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('status')).toHaveTextContent('10 highlights')
    expect(screen.getByLabelText('Search clips')).toHaveValue('')
  })

  it('shows a Trending now section on Home', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Trending now' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all trending' })).toHaveAttribute(
      'href',
      '/clips?sort=trending&range=week',
    )
  })

  it('keeps the footer disclosure truthful when nothing is sponsored', () => {
    renderAt('/')
    expect(screen.getByText(/Not affiliated with or endorsed by Twitch/)).toBeInTheDocument()
    expect(screen.queryByText(/sponsored or affiliate links/)).toBeNull()
  })

  it('opens a clip detail and dismisses it', async () => {
    const user = userEvent.setup()
    renderAt('/clips')
    await user.click(screen.getByRole('link', { name: /Chat explodes after the 1v4 ace/ }))
    expect(screen.getByRole('heading', { name: /1v4 ace/ })).toBeInTheDocument()
    expect(screen.getByText('2:05:22')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByRole('status')).toHaveTextContent('9 highlights')
  })

  it('shows not found for an unknown clip', () => {
    renderAt('/clips/999')
    expect(screen.getByRole('heading', { name: 'Clip not found' })).toBeInTheDocument()
  })

  it('renders About at /about', () => {
    renderAt('/about')
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
  })

  it('renders the 404 page for unknown routes', () => {
    renderAt('/nope/nothing')
    expect(screen.getByRole('heading', { name: /404/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back home' })).toHaveAttribute('href', '/')
  })

  it('navigates via the nav links', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(screen.getByRole('link', { name: 'About' }))
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Home' }))
    expect(screen.getByRole('heading', { name: /Never miss/ })).toBeInTheDocument()
  })
})

describe('branding', () => {
  it('shows the ClipSpike name in the header', () => {
    renderAt('/')
    expect(screen.getByText('Clip', { selector: '.brand' })).toBeInTheDocument()
    expect(document.querySelector('.brand')).toHaveTextContent('ClipSpike')
  })
})

describe('backup streamer', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('switches to a backup when the featured streamer goes offline and back', () => {
    renderAt('/')
    expect(screen.getByLabelText('Current streamer')).toHaveTextContent('jynxzi')
    act(() => useClipStore.getState().advanceMockStatus())
    expect(screen.getByLabelText('Current streamer')).toHaveTextContent('xqc')
    expect(screen.getByText(/Switched to backup/)).toBeInTheDocument()
    act(() => useClipStore.getState().setStreamStatus({ jynxzi: 'live' }))
    expect(screen.queryByText(/Switched to backup/)).not.toBeInTheDocument()
  })
})

describe('data states', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('shows skeletons while loading', () => {
    useClipStore.setState({ loadState: 'loading' })
    renderAt('/clips')
    expect(screen.getByTestId('skeleton-grid')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /1v4 ace/ })).not.toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    const user = userEvent.setup()
    const refreshData = vi.fn(async () => {})
    useClipStore.setState({ loadState: 'error', refreshData })
    renderAt('/clips')
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t load live Twitch data/)
    const before = refreshData.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refreshData).toHaveBeenCalledTimes(before + 1)
  })

  it('shows an empty state with clear filters', async () => {
    const user = userEvent.setup()
    renderAt('/clips')
    await user.type(screen.getByLabelText('Search clips'), 'zzz')
    expect(screen.getByText('No highlights match “zzz”.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('status')).toHaveTextContent('10 highlights')
  })

  it('shows an updated-ago indicator from generatedAt and hides it when missing', () => {
    useClipStore.setState({ generatedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
    const { unmount } = renderAt('/')
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
    expect(screen.getByText('5 min ago')).toBeInTheDocument()
    expect(screen.queryByText(/Clip data is stale/)).toBeNull()
    unmount()
    useClipStore.setState({ generatedAt: null })
    const missing = renderAt('/')
    expect(document.querySelector('.updated')).toBeNull()
    expect(screen.queryByText(/Clip data is stale/)).toBeNull()
    missing.unmount()
    useClipStore.setState({ generatedAt: new Date(Date.now() - 90 * 60_000).toISOString() })
    const fresh = renderAt('/')
    expect(screen.queryByText(/Clip data is stale/)).toBeNull()
    expect(screen.getByText('1 hr ago')).toBeInTheDocument()
    fresh.unmount()
    useClipStore.setState({ generatedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() })
    renderAt('/')
    expect(screen.getByText(/Clip data is stale/)).toBeInTheDocument()
    expect(document.querySelector('.updated')).toBeNull()
  })

  it('links the clip browser, Windows download, and Pro from the layout', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Browse Twitch clips' })).toHaveAttribute('href', '/clips')
    expect(screen.getByRole('link', { name: 'Windows download' })).toHaveAttribute('href', 'https://clipspike.com/windows.html')
    expect(screen.getByRole('link', { name: 'ClipSpike Pro' })).toHaveAttribute('href', '/pro')
  })

  it('exposes landmarks', () => {
    renderAt('/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})

describe('legal and pro routes', () => {
  it('renders privacy, terms and pro, with footer links', () => {
    const { unmount } = renderAt('/privacy')
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getByText(/Twitch embeds and content/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    unmount()
    renderAt('/terms')
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
  })
})
