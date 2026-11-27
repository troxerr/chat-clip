import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './../App'
import { DEFAULT_CONFIG } from '../lib/streamerConfig'
import { useClipStore } from '../store/useClipStore'
import { STREAMERS_STORAGE_KEY, useStreamerStore } from '../store/useStreamerStore'

const initialClips = { ...useClipStore.getState(), refreshData: async () => {} }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/streamers']}>
      <App />
    </MemoryRouter>,
  )
}

const backupNames = () =>
  within(screen.getByRole('list', { name: 'Backup streamers' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.streamer')?.textContent)

describe('Streamers page', () => {
  beforeEach(() => {
    localStorage.clear()
    useClipStore.setState(initialClips, true)
    useStreamerStore.getState().reset()
  })

  it('shows the defaults', () => {
    renderPage()
    expect(within(screen.getByRole('list', { name: 'Primary streamer' })).getByText('jynxzi')).toBeInTheDocument()
    expect(backupNames()).toEqual(DEFAULT_CONFIG.backups)
  })

  it('validates input and shows "No data yet" for streamers outside the pipeline', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Add a backup streamer'), 'no way')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/3–25 characters/)

    await user.clear(screen.getByLabelText('Add a backup streamer'))
    await user.type(screen.getByLabelText('Add a backup streamer'), '@MyFriend')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(backupNames()).toContain('myfriend')
    const row = screen.getByText('myfriend').closest('li')!
    expect(within(row).getByText('No data yet')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STREAMERS_STORAGE_KEY)!).state.backups).toContain('myfriend')
  })

  it('removes, reorders and promotes', async () => {
    const user = userEvent.setup()
    renderPage()
    const [first, second, third] = DEFAULT_CONFIG.backups
    await user.click(screen.getByRole('button', { name: `Remove ${third}` }))
    await user.click(screen.getByRole('button', { name: `Move ${second} up` }))
    expect(backupNames()?.slice(0, 3)).toEqual([second, first, DEFAULT_CONFIG.backups[3]])
    await user.click(within(screen.getByText(second).closest('li')!).getByRole('button', { name: 'Make primary' }))
    expect(within(screen.getByRole('list', { name: 'Primary streamer' })).getByText(second)).toBeInTheDocument()
    expect(backupNames()?.slice(0, 2)).toEqual(['jynxzi', first])
  })

  it('restores a saved configuration', async () => {
    localStorage.setItem(STREAMERS_STORAGE_KEY, JSON.stringify({ state: { primary: 'xqc', backups: ['kaicenat'] }, version: 0 }))
    await useStreamerStore.persist.rehydrate()
    renderPage()
    expect(backupNames()).toEqual(['kaicenat'])
  })
})
