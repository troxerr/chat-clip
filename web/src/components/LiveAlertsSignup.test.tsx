import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConfig } from '../monetization/config'
import FollowButton from './FollowButton'
import LiveAlertsSignup from './LiveAlertsSignup'
import { useFollowStore } from '../store/useFollowStore'

const cfg = (env: Record<string, string>) => buildConfig(env, [])

describe('live alerts signup', () => {
  beforeEach(() => {
    localStorage.clear()
    useFollowStore.setState({ follows: [] })
  })

  it('renders nothing unless configured, and rejects non-Discord invite links', () => {
    const { container } = render(<LiveAlertsSignup config={cfg({ VITE_DISCORD_INVITE_URL: 'https://evil.example/x' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('follow button toggles and persists', async () => {
    render(<FollowButton login="Foo_bar" />)
    await userEvent.click(screen.getByRole('button', { name: /live alerts for foo_bar/i }))
    expect(useFollowStore.getState().follows).toEqual(['foo_bar'])
    expect(JSON.parse(localStorage.getItem('clipspike.follows')!).state.follows).toEqual(['foo_bar'])
  })

  it('requires consent and posts the followed streamers', async () => {
    useFollowStore.setState({ follows: ['foo_bar'] })
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<LiveAlertsSignup config={cfg({ VITE_WAITLIST_ENDPOINT: 'https://example.com/f', VITE_DISCORD_INVITE_URL: 'https://discord.gg/abc' })} />)
    expect(screen.getByRole('link', { name: /join our discord/i })).toHaveAttribute('href', 'https://discord.gg/abc')
    await userEvent.type(screen.getByLabelText('Email for live alerts'), 'a@b.co')
    await userEvent.click(screen.getByRole('button', { name: 'Sign up for alerts' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/agree/i)
    expect(fetchMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Sign up for alerts' }))
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body).toMatchObject({ email: 'a@b.co', streamers: 'foo_bar', source: 'clipspike-web-alerts' })
    vi.unstubAllGlobals()
  })
})
