import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { AppSettings, Bucket, Category, IncomeSource, Transaction } from '../types'

// A browser that already holds real finance data at schema v3 must open cleanly at v4
// with every finance row untouched and the new fitness tables empty.

const REALM = 'rlm_test'
const stamp = '2026-08-01T00:00:00.000Z'

const settings: AppSettings = { id: 's1', realmId: REALM, defaultCurrency: 'RUB', createdAt: stamp, updatedAt: stamp }
const buckets: Bucket[] = [
  { id: 'b1', realmId: REALM, name: 'Moon', ownerId: 'moon', kind: 'spending', createdAt: stamp, updatedAt: stamp },
  { id: 'b2', realmId: REALM, name: 'Family', ownerId: 'shared', kind: 'savings', archived: true, createdAt: stamp, updatedAt: stamp },
]
const incomeSources: IncomeSource[] = [{ id: 'i1', realmId: REALM, name: 'Salary', createdAt: stamp, updatedAt: stamp }]
const categories: Category[] = [{ id: 'c1', realmId: REALM, name: 'Food', createdAt: stamp, updatedAt: stamp }]
const transactions: Transaction[] = [
  { id: 't1', realmId: REALM, date: '2026-08-02', type: 'income', amount: 1000.5, currency: 'RUB', bucketId: 'b1', sourceId: 'i1', note: 'pay', createdAt: stamp, updatedAt: stamp },
  { id: 't2', realmId: REALM, date: '2026-08-03', type: 'expense', amount: 250, currency: 'USD', bucketId: 'b1', categoryId: 'c1', createdAt: stamp, updatedAt: stamp },
  { id: 't3', realmId: REALM, date: '2026-08-04', type: 'transfer', amount: 100, currency: 'RUB', bucketId: 'b1', toBucketId: 'b2', createdAt: stamp, updatedAt: stamp },
]

describe('schema v3 → v4 upgrade', () => {
  it('keeps every finance row identical and adds empty fitness tables', async () => {
    // Build a database exactly as the previous release (schema v3, local-only shape) left it.
    const old = new Dexie('FamilyFinanceDashboard')
    old.version(3).stores({
      settings: 'id, realmId',
      buckets: 'id, realmId, name, ownerId, kind, archived',
      incomeSources: 'id, realmId, name, archived',
      categories: 'id, realmId, name, archived',
      transactions: 'id, realmId, date, type, bucketId, toBucketId, sourceId, categoryId',
      realms: 'realmId',
      members: 'id,[email+realmId],realmId,email',
      roles: '[realmId+name]',
    })
    await old.open()
    await old.table('settings').add(settings)
    await old.table('buckets').bulkAdd(buckets)
    await old.table('incomeSources').bulkAdd(incomeSources)
    await old.table('categories').bulkAdd(categories)
    await old.table('transactions').bulkAdd(transactions)
    old.close()

    // Now open it with the current code (schema v4).
    const { db } = await import('./database')
    await db.open()

    expect(await db.settings.toArray()).toEqual([settings])
    expect(await db.buckets.orderBy('id').toArray()).toEqual(buckets)
    expect(await db.incomeSources.toArray()).toEqual(incomeSources)
    expect(await db.categories.toArray()).toEqual(categories)
    expect(await db.transactions.orderBy('id').toArray()).toEqual(transactions)

    expect(await db.workouts.count()).toBe(0)
    expect(await db.meals.count()).toBe(0)
    expect(await db.fitnessGoals.count()).toBe(0)
    expect(await db.fitnessProfiles.count()).toBe(0)

    // Fitness writes must not disturb finance rows.
    await db.workouts.add({
      id: 'w1',
      realmId: REALM,
      ownerId: 'moon',
      date: '2026-08-05',
      kind: 'cardio',
      title: 'Run',
      minutes: 30,
      createdAt: stamp,
      updatedAt: stamp,
    })
    expect(await db.transactions.count()).toBe(3)
    expect(await db.workouts.count()).toBe(1)
    db.close()
  })
})
