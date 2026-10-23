import type { Table } from 'dexie'
import { db } from './database'
import type { AppSettings, Bucket, BucketKind, BucketOwner, Transaction, TransactionType } from '../types'
import { makeId, nowIso } from '../utils/id'
import { roundMoney } from '../utils/money'

export function defaultSettings(realmId?: string): AppSettings {
  const now = nowIso()
  return {
    id: makeId('settings'),
    realmId,
    defaultCurrency: 'RUB',
    createdAt: now,
    updatedAt: now,
  }
}

const DEFAULT_BUCKETS: Array<Pick<Bucket, 'name' | 'ownerId' | 'kind'>> = [
  { name: 'Moon', ownerId: 'moon', kind: 'spending' },
  { name: 'Alena', ownerId: 'alena', kind: 'spending' },
  { name: 'Family', ownerId: 'shared', kind: 'spending' },
]

async function seedDefaultBuckets(realmId?: string) {
  const now = nowIso()
  await db.buckets.bulkAdd(
    DEFAULT_BUCKETS.map((bucket) => ({
      id: makeId('bucket'),
      realmId,
      ...bucket,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function createLocalFamilySpace() {
  await db.transaction('rw', db.settings, db.buckets, async () => {
    await db.settings.add(defaultSettings())
    await seedDefaultBuckets()
  })
}

export async function createCloudFamilySpace(spouseEmail: string, spouseName = 'Alena') {
  // Dexie Cloud requires custom realm IDs to start with "rlm" (its own reserved prefix for this table).
  const realmId = makeId('rlm')
  const currentUserId = db.cloud.currentUserId

  await db.transaction('rw', db.realms, db.members, db.settings, db.buckets, async () => {
    await db.realms.add({
      realmId,
      name: 'Moon & Alena Finance',
      represents: 'a shared family finance dashboard',
      owner: currentUserId,
    })

    if (currentUserId) {
      await db.members.add({
        realmId,
        userId: currentUserId,
        name: 'Moon',
        permissions: { manage: '*' },
      })
    }

    if (spouseEmail.trim()) {
      await db.members.add({
        realmId,
        email: spouseEmail.trim(),
        name: spouseName.trim() || 'Alena',
        invite: true,
        permissions: { manage: '*' },
      })
    }

    await db.settings.add(defaultSettings(realmId))
    await seedDefaultBuckets(realmId)
  })
}

export async function addBucket(name: string, ownerId: BucketOwner, kind: BucketKind, realmId?: string) {
  const now = nowIso()
  await db.buckets.add({
    id: makeId('bucket'),
    realmId,
    name: name.trim(),
    ownerId,
    kind,
    createdAt: now,
    updatedAt: now,
  })
}

export async function setBucketArchived(bucketId: string, archived: boolean) {
  await db.buckets.update(bucketId, { archived, updatedAt: nowIso() })
}

/**
 * Runs a usage check and a delete atomically in one Dexie transaction, so a sync write
 * landing between the two can't leave a dangling reference to the deleted row.
 */
async function deleteIfUnused(noun: string, usage: () => Promise<number>, remove: () => Promise<unknown>) {
  await db.transaction('rw', db.transactions, db.buckets, db.incomeSources, db.categories, async () => {
    const used = await usage()
    if (used > 0) {
      throw new Error(`This ${noun} is used by ${used} transaction${used === 1 ? '' : 's'}. Archive it instead, or delete its transactions first.`)
    }
    await remove()
  })
}

/** Deletes a bucket only while no transaction references it — otherwise history and balances would silently break. */
export async function deleteBucket(bucketId: string) {
  await deleteIfUnused(
    'bucket',
    async () => {
      const [asSource, asTarget] = await Promise.all([
        db.transactions.where('bucketId').equals(bucketId).count(),
        db.transactions.where('toBucketId').equals(bucketId).count(),
      ])
      return asSource + asTarget
    },
    () => db.buckets.delete(bucketId),
  )
}

/** Renames only the label; every transaction points at the bucket by id, so history and balances stay put. */
export async function renameBucket(bucketId: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A bucket needs a name.')
  await db.buckets.update(bucketId, { name: trimmed, updatedAt: nowIso() })
}

export async function addSource(name: string, realmId?: string) {
  const now = nowIso()
  const id = makeId('source')
  await db.incomeSources.add({ id, realmId, name: name.trim(), createdAt: now, updatedAt: now })
  return id
}

/**
 * Renames a source or category. Names are how the forms match existing ones, so a name already taken
 * (ignoring case) is refused instead of creating a lookalike. Transactions keep pointing at the same id.
 */
async function renameNamed(
  table: Table<{ id: string; realmId?: string; name: string; updatedAt: string }, string>,
  noun: string,
  id: string,
  name: string,
) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(`A ${noun} needs a name.`)
  await db.transaction('rw', table, async () => {
    const row = await table.get(id)
    if (!row) throw new Error(`This ${noun} no longer exists.`)
    const clash = (await table.toArray()).find(
      (other) => other.id !== id && other.realmId === row.realmId && other.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (clash) throw new Error(`There is already a ${noun} called “${clash.name}”. To merge them, switch its entries over to that one first.`)
    await table.update(id, { name: trimmed, updatedAt: nowIso() })
  })
}

export function renameSource(sourceId: string, name: string) {
  return renameNamed(db.incomeSources, 'source', sourceId, name)
}

export function renameCategory(categoryId: string, name: string) {
  return renameNamed(db.categories, 'category', categoryId, name)
}

export async function setSourceArchived(sourceId: string, archived: boolean) {
  await db.incomeSources.update(sourceId, { archived, updatedAt: nowIso() })
}

/** Deletes an income source only while no transaction references it — otherwise history would silently lose its tag. */
export async function deleteSource(sourceId: string) {
  await deleteIfUnused(
    'source',
    () => db.transactions.where('sourceId').equals(sourceId).count(),
    () => db.incomeSources.delete(sourceId),
  )
}

export async function addCategory(name: string, realmId?: string) {
  const now = nowIso()
  const id = makeId('category')
  await db.categories.add({ id, realmId, name: name.trim(), createdAt: now, updatedAt: now })
  return id
}

export async function setCategoryArchived(categoryId: string, archived: boolean) {
  await db.categories.update(categoryId, { archived, updatedAt: nowIso() })
}

/** Deletes an expense category only while no transaction references it — otherwise history would silently lose its tag. */
export async function deleteCategory(categoryId: string) {
  await deleteIfUnused(
    'category',
    () => db.transactions.where('categoryId').equals(categoryId).count(),
    () => db.categories.delete(categoryId),
  )
}

async function findOrCreateSource(name: string, realmId?: string) {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  const existing = (await db.incomeSources.toArray()).find(
    (source) => source.realmId === realmId && source.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) return existing.id
  return addSource(trimmed, realmId)
}

async function findOrCreateCategory(name: string, realmId?: string) {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  const existing = (await db.categories.toArray()).find(
    (category) => category.realmId === realmId && category.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) return existing.id
  return addCategory(trimmed, realmId)
}

export interface SaveMoneyInInput {
  date: string
  amount: number
  currency: string
  bucketId: string
  /** Free-text income source; matched to an existing source or created on the fly. Ignored for funding. */
  sourceName?: string
  note?: string
  realmId?: string
}

/** Money into a spending/savings bucket. Counts as income, tagged with its source. */
export async function saveIncome(input: SaveMoneyInInput) {
  const sourceId = await findOrCreateSource(input.sourceName ?? '', input.realmId)
  return addTransaction(buildTransaction({ ...input, type: 'income', sourceId }))
}

/** Money into a business bucket. Earmarked for business expenses — NOT income. */
export async function saveFunding(input: SaveMoneyInInput) {
  return addTransaction(buildTransaction({ ...input, type: 'funding' }))
}

export interface SaveExpenseInput {
  date: string
  amount: number
  currency: string
  bucketId: string
  /** Free-text category; matched to an existing category or created on the fly. */
  categoryName?: string
  note?: string
  realmId?: string
}

export async function saveExpense(input: SaveExpenseInput) {
  const categoryId = await findOrCreateCategory(input.categoryName ?? '', input.realmId)
  return addTransaction(buildTransaction({ ...input, type: 'expense', categoryId }))
}

export interface SaveTransferInput {
  date: string
  amount: number
  currency: string
  fromBucketId: string
  toBucketId: string
  note?: string
  realmId?: string
}

export async function saveTransfer(input: SaveTransferInput) {
  if (input.fromBucketId === input.toBucketId) throw new Error('Choose two different buckets.')
  return addTransaction(
    buildTransaction({
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      bucketId: input.fromBucketId,
      toBucketId: input.toBucketId,
      note: input.note,
      realmId: input.realmId,
      type: 'transfer',
    }),
  )
}

export interface SaveAdjustmentInput {
  date: string
  /** Signed correction applied to the bucket balance (new balance − current balance). */
  delta: number
  currency: string
  bucketId: string
  note?: string
  realmId?: string
}

export async function saveAdjustment(input: SaveAdjustmentInput) {
  return addTransaction(buildTransaction({ ...input, amount: input.delta, type: 'adjustment' }))
}

export interface UpdateTransactionInput {
  id: string
  date: string
  amount: number
  currency: string
  bucketId: string
  toBucketId?: string
  sourceName?: string
  categoryName?: string
  note?: string
  realmId?: string
}

export async function updateTransaction(input: UpdateTransactionInput) {
  const existing = await db.transactions.get(input.id)
  if (!existing) throw new Error('Transaction not found.')

  const sourceId = existing.type === 'income' ? await findOrCreateSource(input.sourceName ?? '', input.realmId) : existing.sourceId
  const categoryId =
    existing.type === 'expense' ? await findOrCreateCategory(input.categoryName ?? '', input.realmId) : existing.categoryId

  await db.transactions.update(input.id, {
    date: input.date,
    amount: existing.type === 'adjustment' ? roundMoney(input.amount) : Math.abs(roundMoney(input.amount)),
    currency: normalizeCurrency(input.currency),
    bucketId: input.bucketId,
    toBucketId: existing.type === 'transfer' ? input.toBucketId : undefined,
    sourceId,
    categoryId,
    note: input.note?.trim() || undefined,
    updatedAt: nowIso(),
  })
}

export async function deleteTransaction(transactionId: string) {
  await db.transactions.delete(transactionId)
}

/** Puts back a just-deleted transaction unchanged (the Undo in the delete toast). */
export async function restoreTransaction(transaction: Transaction) {
  await db.transactions.put(transaction)
}

export async function updateDefaultCurrency(settings: AppSettings, currency: string) {
  await db.settings.update(settings.id, {
    defaultCurrency: normalizeCurrency(currency),
    updatedAt: nowIso(),
  })
}

/** Stores a new transaction and hands it back, so the screen can name it and offer Undo. */
async function addTransaction(transaction: Transaction) {
  await db.transactions.add(transaction)
  return transaction
}

function buildTransaction(input: {
  type: TransactionType
  date: string
  amount: number
  currency: string
  bucketId: string
  toBucketId?: string
  sourceId?: string
  categoryId?: string
  note?: string
  realmId?: string
}): Transaction {
  const now = nowIso()
  return {
    id: makeId('txn'),
    realmId: input.realmId,
    date: input.date,
    type: input.type,
    amount: input.type === 'adjustment' ? roundMoney(input.amount) : Math.abs(roundMoney(input.amount)),
    currency: normalizeCurrency(input.currency),
    bucketId: input.bucketId,
    toBucketId: input.toBucketId,
    sourceId: input.sourceId,
    categoryId: input.categoryId,
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeCurrency(currency: string) {
  return (currency || 'RUB').trim().toUpperCase()
}
