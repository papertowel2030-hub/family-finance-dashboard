import Dexie, { type Table } from 'dexie'
import { db } from './database'
import type { Bucket, Category, IncomeSource, Transaction } from '../types'

/**
 * Local-only safety net: a copy of every record this device has seen, so a
 * deleted entry (deleted here, or deleted on another device and synced) can be
 * put back one by one.
 *
 * Lives in its own IndexedDB database with no addons, so it never syncs and
 * never touches the app's cloud tables. It only ever reads the app tables; the
 * one write into them is `restoreDeleted`, which adds a missing row and never
 * overwrites an existing one.
 */

export type RecoverableTable = 'buckets' | 'incomeSources' | 'categories' | 'transactions'

type RecoverableRecord = Bucket | IncomeSource | Category | Transaction

export interface RecoveryEntry {
  /** `${table}:${id}` */
  key: string
  table: RecoverableTable
  id: string
  realmId?: string
  /** Latest version of the record this device has seen. */
  data: RecoverableRecord
  firstSeenAt: string
  /** When this device first noticed the record was gone. Unset while it still exists. */
  missingSince?: string
}

/** Deleted records are kept this long before being forgotten. */
export const RECOVERY_KEEP_DAYS = 90

class RecoveryDatabase extends Dexie {
  records!: Table<RecoveryEntry, string>

  constructor() {
    // addons: [] — never let the cloud addon (or any global addon) attach here.
    super('FamilyFinanceRecovery', { addons: [] })
    this.version(1).stores({
      records: 'key, table, realmId, missingSince',
    })
  }
}

export const recoveryDb = new RecoveryDatabase()

export interface LiveRecords {
  buckets: Bucket[]
  incomeSources: IncomeSource[]
  categories: Category[]
  transactions: Transaction[]
}

const TABLES: RecoverableTable[] = ['buckets', 'incomeSources', 'categories', 'transactions']

/** Compares full contents, not just `updatedAt`, so a change that forgot to bump the timestamp is still captured. */
function sameContent(a: RecoverableRecord, b: RecoverableRecord) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Pure diff between what the app holds now and what the log remembers.
 * Only records of `realmId` are compared, so another family space never looks "deleted".
 */
export function planRecoveryUpdate(
  live: LiveRecords,
  logged: RecoveryEntry[],
  realmId: string | undefined,
  now: string,
): { puts: RecoveryEntry[]; removeKeys: string[] } {
  const puts: RecoveryEntry[] = []
  const removeKeys: string[] = []
  const loggedByKey = new Map(logged.filter((entry) => entry.realmId === realmId).map((entry) => [entry.key, entry]))
  const liveKeys = new Set<string>()

  for (const table of TABLES) {
    for (const record of live[table] as RecoverableRecord[]) {
      if (record.realmId !== realmId) continue
      const key = `${table}:${record.id}`
      liveKeys.add(key)
      const existing = loggedByKey.get(key)
      if (!existing) {
        puts.push({ key, table, id: record.id, realmId, data: record, firstSeenAt: now })
      } else if (existing.missingSince || !sameContent(existing.data, record)) {
        puts.push({ ...existing, data: record, missingSince: undefined })
      }
    }
  }

  // An empty app usually means "still loading / just signed in", not "everything was deleted".
  const liveIsEmpty = TABLES.every((table) => live[table].length === 0)
  const cutoff = new Date(Date.parse(now) - RECOVERY_KEEP_DAYS * 86_400_000).toISOString()

  for (const [key, entry] of loggedByKey) {
    if (liveKeys.has(key)) continue
    if (entry.missingSince) {
      if (entry.missingSince < cutoff) removeKeys.push(key)
    } else if (!liveIsEmpty) {
      puts.push({ ...entry, missingSince: now })
    }
  }

  return { puts, removeKeys }
}

export async function updateRecoveryLog(live: LiveRecords, realmId: string | undefined) {
  const logged = await recoveryDb.records.where('realmId').equals(realmId ?? '').toArray()
  // Records without a realm (local-only mode) can't be found through the index above.
  const withoutRealm = realmId ? [] : await recoveryDb.records.filter((entry) => entry.realmId === undefined).toArray()
  const { puts, removeKeys } = planRecoveryUpdate(live, [...logged, ...withoutRealm], realmId, new Date().toISOString())
  if (!puts.length && !removeKeys.length) return
  await recoveryDb.transaction('rw', recoveryDb.records, async () => {
    if (puts.length) await recoveryDb.records.bulkPut(puts)
    if (removeKeys.length) await recoveryDb.records.bulkDelete(removeKeys)
  })
}

/** Deleted transactions this device remembers for the active family space, newest deletion first. */
export async function listDeletedTransactions(realmId: string | undefined) {
  const entries = await recoveryDb.records.where('table').equals('transactions').toArray()
  const candidates = entries.filter((entry) => entry.realmId === realmId && entry.missingSince)
  // Double-check against the live table: sync may have brought a row back since the log was updated.
  const live = await db.transactions.bulkGet(candidates.map((entry) => entry.id))
  return candidates
    .filter((_, index) => live[index] === undefined)
    .sort((a, b) => (b.missingSince ?? '').localeCompare(a.missingSince ?? ''))
}

/**
 * Puts a deleted transaction back, plus any bucket / source / category it needs
 * that was deleted too. Add-only: rows that already exist are never touched.
 */
export async function restoreDeleted(entry: RecoveryEntry) {
  if (entry.table !== 'transactions') throw new Error('Only transactions can be restored here.')
  const transaction = entry.data as Transaction
  const needed = (
    [
      ['buckets', transaction.bucketId],
      ['buckets', transaction.toBucketId],
      ['incomeSources', transaction.sourceId],
      ['categories', transaction.categoryId],
    ] as Array<[Exclude<RecoverableTable, 'transactions'>, string | undefined]>
  ).filter((pair): pair is [Exclude<RecoverableTable, 'transactions'>, string] => Boolean(pair[1]))

  // Read the log before opening the app transaction: awaiting another database
  // inside a Dexie transaction could let IndexedDB auto-commit it early.
  const remembered = new Map(
    (await recoveryDb.records.bulkGet(needed.map(([table, id]) => `${table}:${id}`)))
      .filter((row): row is RecoveryEntry => Boolean(row))
      .map((row) => [row.key, row.data]),
  )

  await db.transaction('rw', db.buckets, db.incomeSources, db.categories, db.transactions, async () => {
    if (await db.transactions.get(transaction.id)) return

    for (const [table, id] of needed) {
      if (await db[table].get(id)) continue
      const data = remembered.get(`${table}:${id}`)
      if (!data) throw new Error('This entry uses a bucket, source or category that no longer exists, so it cannot be restored.')
      await db[table].add(data as never)
    }

    await db.transactions.add(transaction)
  })
}

/** Removes a deleted entry from the recovery list for good (local only). */
export async function forgetDeleted(entry: RecoveryEntry) {
  await recoveryDb.records.delete(entry.key)
}
