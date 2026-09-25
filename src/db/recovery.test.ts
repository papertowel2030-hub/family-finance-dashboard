import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  listDeletedTransactions,
  planRecoveryUpdate,
  recoveryDb,
  restoreDeleted,
  updateRecoveryLog,
  type LiveRecords,
  type RecoveryEntry,
} from './recovery'
import type { Bucket, Category, Transaction } from '../types'

const REALM = 'realm-1'

const bucket = (id: string, realmId = REALM): Bucket => ({
  id,
  realmId,
  name: id,
  ownerId: 'shared',
  kind: 'spending',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const category = (id: string): Category => ({
  id,
  realmId: REALM,
  name: id,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const txn = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  realmId: REALM,
  date: '2026-08-28',
  type: 'expense',
  amount: 500,
  currency: 'RUB',
  bucketId: 'b1',
  createdAt: '2026-08-28T10:00:00.000Z',
  updatedAt: '2026-08-28T10:00:00.000Z',
  ...extra,
})

const live = (partial: Partial<LiveRecords>): LiveRecords => ({
  buckets: [],
  incomeSources: [],
  categories: [],
  transactions: [],
  ...partial,
})

const NOW = '2026-09-25T12:00:00.000Z'

describe('planRecoveryUpdate', () => {
  it('logs every new record', () => {
    const { puts, removeKeys } = planRecoveryUpdate(live({ buckets: [bucket('b1')], transactions: [txn('t1')] }), [], REALM, NOW)

    expect(puts.map((entry) => entry.key).sort()).toEqual(['buckets:b1', 'transactions:t1'])
    expect(puts.every((entry) => !entry.missingSince)).toBe(true)
    expect(removeKeys).toEqual([])
  })

  it('writes nothing when nothing changed', () => {
    const first = planRecoveryUpdate(live({ transactions: [txn('t1')] }), [], REALM, NOW)
    const second = planRecoveryUpdate(live({ transactions: [txn('t1')] }), first.puts, REALM, NOW)

    expect(second).toEqual({ puts: [], removeKeys: [] })
  })

  it('keeps the latest edited version', () => {
    const first = planRecoveryUpdate(live({ transactions: [txn('t1')] }), [], REALM, NOW)
    const edited = txn('t1', { amount: 900, updatedAt: '2026-09-01T00:00:00.000Z' })
    const { puts } = planRecoveryUpdate(live({ transactions: [edited] }), first.puts, REALM, NOW)

    expect(puts).toHaveLength(1)
    expect((puts[0].data as Transaction).amount).toBe(900)
  })

  it('captures a change even when updatedAt was not bumped', () => {
    const first = planRecoveryUpdate(live({ transactions: [txn('t1')] }), [], REALM, NOW)
    const { puts } = planRecoveryUpdate(live({ transactions: [txn('t1', { bucketId: 'b2' })] }), first.puts, REALM, NOW)

    expect((puts[0].data as Transaction).bucketId).toBe('b2')
  })

  it('marks a vanished record as deleted instead of forgetting it', () => {
    const first = planRecoveryUpdate(live({ transactions: [txn('t1'), txn('t2')] }), [], REALM, NOW)
    const { puts } = planRecoveryUpdate(live({ transactions: [txn('t2')] }), first.puts, REALM, NOW)

    expect(puts).toEqual([expect.objectContaining({ key: 'transactions:t1', missingSince: NOW })])
    expect((puts[0].data as Transaction).amount).toBe(500)
  })

  it('does not mark anything deleted while the app is empty (loading or just signed in)', () => {
    const first = planRecoveryUpdate(live({ transactions: [txn('t1')] }), [], REALM, NOW)

    expect(planRecoveryUpdate(live({}), first.puts, REALM, NOW)).toEqual({ puts: [], removeKeys: [] })
  })

  it('clears the deleted mark when the record comes back', () => {
    const deleted: RecoveryEntry = {
      key: 'transactions:t1',
      table: 'transactions',
      id: 't1',
      realmId: REALM,
      data: txn('t1'),
      firstSeenAt: NOW,
      missingSince: NOW,
    }
    const { puts } = planRecoveryUpdate(live({ transactions: [txn('t1')] }), [deleted], REALM, NOW)

    expect(puts).toEqual([expect.objectContaining({ key: 'transactions:t1', missingSince: undefined })])
  })

  it('forgets deleted records only after the keep period', () => {
    const entry = (id: string, missingSince: string): RecoveryEntry => ({
      key: `transactions:${id}`,
      table: 'transactions',
      id,
      realmId: REALM,
      data: txn(id),
      firstSeenAt: missingSince,
      missingSince,
    })
    const { removeKeys } = planRecoveryUpdate(
      live({ transactions: [txn('other')] }),
      [entry('old', '2026-06-01T00:00:00.000Z'), entry('recent', '2026-09-01T00:00:00.000Z')],
      REALM,
      NOW,
    )

    expect(removeKeys).toEqual(['transactions:old'])
  })

  it('ignores records from another family space', () => {
    const otherRealm = { ...bucket('x', 'realm-2') }
    const { puts } = planRecoveryUpdate(live({ buckets: [otherRealm, bucket('b1')] }), [], REALM, NOW)

    expect(puts.map((entry) => entry.key)).toEqual(['buckets:b1'])
  })
})

describe('recovery log with a real database', () => {
  beforeEach(async () => {
    await Promise.all([db.buckets.clear(), db.categories.clear(), db.incomeSources.clear(), db.transactions.clear()])
    await recoveryDb.records.clear()
  })

  async function snapshotLive() {
    const [buckets, incomeSources, categories, transactions] = await Promise.all([
      db.buckets.toArray(),
      db.incomeSources.toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
    ])
    await updateRecoveryLog({ buckets, incomeSources, categories, transactions }, REALM)
  }

  it('restores a deleted transaction exactly as it was', async () => {
    await db.buckets.add(bucket('b1'))
    await db.transactions.bulkAdd([txn('t1', { note: 'For saving August' }), txn('t2')])
    await snapshotLive()

    await db.transactions.delete('t1')
    await snapshotLive()

    const deleted = await listDeletedTransactions(REALM)
    expect(deleted.map((entry) => entry.id)).toEqual(['t1'])

    await restoreDeleted(deleted[0])
    expect(await db.transactions.get('t1')).toEqual(txn('t1', { note: 'For saving August' }))

    await snapshotLive()
    expect(await listDeletedTransactions(REALM)).toEqual([])
  })

  it('also restores a category that was deleted after the transaction', async () => {
    await db.buckets.add(bucket('b1'))
    await db.categories.add(category('c1'))
    await db.transactions.bulkAdd([txn('t1', { categoryId: 'c1' }), txn('t2')])
    await snapshotLive()

    await db.transactions.delete('t1')
    await db.categories.delete('c1')
    await snapshotLive()

    const [entry] = await listDeletedTransactions(REALM)
    await restoreDeleted(entry)

    expect(await db.categories.get('c1')).toEqual(category('c1'))
    expect(await db.transactions.get('t1')).toBeDefined()
  })

  it('never overwrites a row that already exists', async () => {
    await db.buckets.add(bucket('b1'))
    await db.transactions.bulkAdd([txn('t1'), txn('t2')])
    await snapshotLive()
    await db.transactions.delete('t1')
    await snapshotLive()
    const [entry] = await listDeletedTransactions(REALM)

    // Meanwhile the row came back with newer content (e.g. restored on the other device).
    await db.transactions.add(txn('t1', { amount: 777, updatedAt: '2026-09-20T00:00:00.000Z' }))
    await restoreDeleted(entry)

    expect((await db.transactions.get('t1'))?.amount).toBe(777)
  })
})
