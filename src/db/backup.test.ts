import { describe, expect, it } from 'vitest'
import type { BackupFile } from './backup'
import { parseBackup, prepareBackupForRealm } from './backup'

const backup: BackupFile = {
  app: 'family-finance-dashboard',
  version: 1,
  exportedAt: '2026-07-17T00:00:00.000Z',
  settings: [{ id: 'settings-1', realmId: 'old-realm', defaultCurrency: 'RUB', createdAt: 'now', updatedAt: 'now' }],
  buckets: [
    { id: 'bucket-1', realmId: 'old-realm', owner: 'old-owner', name: 'Shared', ownerId: 'shared', kind: 'spending', createdAt: 'now', updatedAt: 'now' },
  ],
  incomeSources: [],
  categories: [],
  transactions: [],
}

describe('backup safety', () => {
  it('rejects unsupported backup versions', () => {
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow('not a Family Finance backup')
  })

  it('remaps records to the active realm and removes a stale cloud owner', () => {
    const prepared = prepareBackupForRealm(backup, 'active-realm')

    expect(prepared.buckets).toEqual([
      expect.objectContaining({ id: 'bucket-1', realmId: 'active-realm' }),
    ])
    expect(prepared.buckets[0]).not.toHaveProperty('owner')
  })

  it('does not merge records from another realm in a multi-realm backup', () => {
    const prepared = prepareBackupForRealm(
      { ...backup, buckets: [...backup.buckets, { ...backup.buckets[0], id: 'bucket-2', realmId: 'other-realm' }] },
      'active-realm',
    )

    expect(prepared.buckets.map((row) => row.id)).toEqual(['bucket-1'])
  })
})
