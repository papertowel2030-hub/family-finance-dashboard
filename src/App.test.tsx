import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App, { SyncBadge } from './App'

const { requestCloudSync } = vi.hoisted(() => ({
  requestCloudSync: vi.fn(async () => ({ requestedAt: '2026-07-18T00:00:00.000Z' })),
}))

vi.mock('./db/database', () => ({
  db: { cloud: {} },
  getDexieCloudUrl: () => 'https://example.dexie.cloud',
  isCloudConfigured: true,
}))

vi.mock('./db/sync', () => ({ requestCloudSync }))

describe('App', () => {
  beforeEach(() => {
    requestCloudSync.mockClear()
  })

  it('shows an explicit IndexedDB requirement when browser storage is unavailable', () => {
    render(<App />)

    expect(screen.getByText('IndexedDB is required')).toBeInTheDocument()
  })

  it('does not start a second blocking sync when an authenticated app mounts', () => {
    render(<SyncBadge currentUser={{ isLoggedIn: true }} syncState={{ status: 'connected', phase: 'in-sync' }} />)

    expect(screen.getByRole('button', { name: 'Synced' })).toBeEnabled()
    expect(requestCloudSync).not.toHaveBeenCalled()
  })

  it('requests a non-blocking retry only when the user asks for one', async () => {
    render(<SyncBadge currentUser={{ isLoggedIn: true }} syncState={{ status: 'connected', phase: 'in-sync' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Synced' }))

    await waitFor(() => expect(requestCloudSync).toHaveBeenCalledOnce())
  })

  it('turns a long-running phase into a recoverable delayed state', () => {
    vi.useFakeTimers()
    try {
      render(<SyncBadge currentUser={{ isLoggedIn: true }} syncState={{ status: 'connected', phase: 'pulling' }} />)

      expect(screen.getByRole('button', { name: 'Syncing…' })).toBeEnabled()
      act(() => vi.advanceTimersByTime(20_000))
      expect(screen.getByRole('button', { name: 'Sync delayed' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
