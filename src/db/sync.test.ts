import { describe, expect, it, vi } from 'vitest'
import { reconcileCloud } from './sync'

describe('reconcileCloud', () => {
  it('waits for a pull before pushing local-only records', async () => {
    const calls: string[] = []
    const sync = vi.fn(async ({ purpose }: { purpose: 'pull' | 'push' }) => {
      calls.push(purpose)
    })

    await reconcileCloud({ sync } as never)

    expect(calls).toEqual(['pull', 'push'])
    expect(sync).toHaveBeenNthCalledWith(1, { wait: true, purpose: 'pull' })
    expect(sync).toHaveBeenNthCalledWith(2, { wait: true, purpose: 'push' })
  })

  it('does not push when the pull fails', async () => {
    const sync = vi.fn(async ({ purpose }: { purpose: 'pull' | 'push' }) => {
      if (purpose === 'pull') throw new Error('offline')
    })

    await expect(reconcileCloud({ sync } as never)).rejects.toThrow('offline')
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
