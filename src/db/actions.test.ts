import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  addBucket,
  addCategory,
  addSource,
  deleteTransaction,
  renameBucket,
  renameCategory,
  renameSource,
  saveExpense,
  saveIncome,
  saveTransfer,
} from './actions'

const REALM = 'rlm_actions'

beforeEach(async () => {
  await Promise.all([db.buckets.clear(), db.incomeSources.clear(), db.categories.clear(), db.transactions.clear()])
})

describe('saving hands the new transaction back', () => {
  it('returns the stored row so the screen can name it and offer Undo', async () => {
    await addBucket('Cash', 'moon', 'spending', REALM)
    const [bucket] = await db.buckets.toArray()
    const saved = await saveExpense({ date: '2026-10-23', amount: 12.5, currency: 'rub', bucketId: bucket.id, categoryName: 'Groceries', realmId: REALM })

    expect(saved).toMatchObject({ type: 'expense', amount: 12.5, currency: 'RUB', bucketId: bucket.id })
    expect(await db.transactions.get(saved.id)).toEqual(saved)
  })

  it('Undo removes exactly that entry and nothing else', async () => {
    await addBucket('Cash', 'moon', 'spending', REALM)
    await addBucket('Salon', 'alena', 'spending', REALM)
    const [a, b] = await db.buckets.toArray()
    const keep = await saveIncome({ date: '2026-10-22', amount: 100, currency: 'RUB', bucketId: a.id, sourceName: 'Teaching', realmId: REALM })
    const oops = await saveTransfer({ date: '2026-10-23', amount: 5, currency: 'RUB', fromBucketId: a.id, toBucketId: b.id, realmId: REALM })

    await deleteTransaction(oops.id)

    expect((await db.transactions.toArray()).map((row) => row.id)).toEqual([keep.id])
  })
})

describe('renaming', () => {
  it('renames a bucket without touching its transactions', async () => {
    await addBucket('Cash', 'moon', 'spending', REALM)
    const [bucket] = await db.buckets.toArray()
    const saved = await saveExpense({ date: '2026-10-23', amount: 1, currency: 'RUB', bucketId: bucket.id, realmId: REALM })

    await renameBucket(bucket.id, '  Wallet ')

    expect((await db.buckets.get(bucket.id))?.name).toBe('Wallet')
    expect(await db.transactions.get(saved.id)).toEqual(saved)
  })

  it('refuses an empty bucket name', async () => {
    await addBucket('Cash', 'moon', 'spending', REALM)
    const [bucket] = await db.buckets.toArray()
    await expect(renameBucket(bucket.id, '   ')).rejects.toThrow('needs a name')
    expect((await db.buckets.get(bucket.id))?.name).toBe('Cash')
  })

  it('renames a category in place, so history keeps its tag', async () => {
    const id = await addCategory('Grocreies', REALM)
    const saved = await saveExpense({ date: '2026-10-23', amount: 9, currency: 'RUB', bucketId: 'b', categoryName: 'Grocreies', realmId: REALM })
    expect(saved.categoryId).toBe(id)

    await renameCategory(id, 'Groceries')

    expect((await db.categories.get(id))?.name).toBe('Groceries')
    expect((await db.transactions.get(saved.id))?.categoryId).toBe(id)
  })

  it('refuses a name another source already has, ignoring case, but allows the same name in another realm', async () => {
    const a = await addSource('Teaching', REALM)
    const b = await addSource('Salary', REALM)
    const other = await addSource('Freelance', 'rlm_other')

    await expect(renameSource(b, 'teaching')).rejects.toThrow('already a source')
    expect((await db.incomeSources.get(b))?.name).toBe('Salary')
    await renameSource(other, 'Teaching')
    expect((await db.incomeSources.get(other))?.name).toBe('Teaching')
    expect((await db.incomeSources.get(a))?.name).toBe('Teaching')
  })

  it('lets an item be re-saved under its own name with different casing', async () => {
    const id = await addCategory('groceries', REALM)
    await renameCategory(id, 'Groceries')
    expect((await db.categories.get(id))?.name).toBe('Groceries')
  })
})
