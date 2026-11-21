import { render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()
    expect(screen.getByText(/You have 2 clips/)).toBeInTheDocument()
  })

  it('renders Clips at /clips and supports add/remove', async () => {
    const user = userEvent.setup()
    renderAt('/clips')
    expect(screen.getByRole('heading', { name: 'Clips' })).toBeInTheDocument()
    expect(screen.getByText(/Sample clip one/)).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('New clip title'), '  Fresh  ')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText(/Fresh/)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.queryByText(/Sample clip one/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()
  })
})
