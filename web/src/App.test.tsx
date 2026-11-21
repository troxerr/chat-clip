import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useClipStore } from './store/useClipStore'

const initial = useClipStore.getState()

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
    await user.selectOptions(screen.getByLabelText('Streamer'), 'jasontheween')
    expect(screen.getByRole('status')).toHaveTextContent('4 highlights')
    await user.type(screen.getByLabelText('Search clips'), 'zzz')
    expect(screen.getByText('No highlights match your filters.')).toBeInTheDocument()
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

describe('backup streamer', () => {
  beforeEach(() => useClipStore.setState(initial, true))

  it('switches to a backup when the featured streamer goes offline and back', () => {
    renderAt('/')
    expect(screen.getByLabelText('Current streamer')).toHaveTextContent('jasontheween')
    act(() => useClipStore.getState().advanceMockStatus())
    expect(screen.getByLabelText('Current streamer')).toHaveTextContent('kaicenat')
    expect(screen.getByText(/Switched to backup/)).toBeInTheDocument()
    act(() => useClipStore.getState().setStreamStatus({ jasontheween: 'live' }))
    expect(screen.queryByText(/Switched to backup/)).not.toBeInTheDocument()
  })
})
