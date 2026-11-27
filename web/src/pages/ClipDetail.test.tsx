import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useClipStore } from '../store/useClipStore'

afterEach(() => vi.unstubAllGlobals())

describe('ClipDetail share', () => {
  it('copies the link and shows a confirmation when Web Share is unavailable', async () => {
    useClipStore.setState({ refreshData: async () => {} })
    const id = useClipStore.getState().clips[0].id
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test' })
    render(
      <MemoryRouter initialEntries={[`/clips/${id}`]}>
        <App />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(writeText).toHaveBeenCalledWith(`https://clipspike.com/app/clips/${id}/?from=share`)
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
  })
})
