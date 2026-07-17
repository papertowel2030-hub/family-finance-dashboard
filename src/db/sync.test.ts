import { describe, expect, it, vi } from 'vitest'
import { requestCloudSync } from './sync'

describe('requestCloudSync', () => {
  it('requests one non-blocking two-way reconciliation', async () => {
    const sync = vi.fn(async () => undefined)

    await requestCloudSync({ sync } as never)

    expect(sync).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledWith({ wait: false, purpose: 'pull' })
  })

  it('surfaces a failure to request the retry', async () => {
    const sync = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(requestCloudSync({ sync } as never)).rejects.toThrow('offline')
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
