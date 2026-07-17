import { db } from './database'
import type { AppSettings, Bucket, Category, IncomeSource, Transaction } from '../types'

export interface BackupFile {
  app: 'family-finance-dashboard'
  version: 1
  exportedAt: string
  settings: AppSettings[]
  buckets: Bucket[]
  incomeSources: IncomeSource[]
  categories: Category[]
  transactions: Transaction[]
}

export interface BackupMergeResult {
  added: {
    buckets: number
    incomeSources: number
    categories: number
    transactions: number
  }
  skippedExisting: number
}

export async function exportBackup(realmId?: string): Promise<BackupFile> {
  const [allSettings, allBuckets, allIncomeSources, allCategories, allTransactions] = await Promise.all([
    db.settings.toArray(),
    db.buckets.toArray(),
    db.incomeSources.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
  ])
  const inRealm = (record: { realmId?: string }) => record.realmId === realmId
  return {
    app: 'family-finance-dashboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: allSettings.filter(inRealm),
    buckets: allBuckets.filter(inRealm),
    incomeSources: allIncomeSources.filter(inRealm),
    categories: allCategories.filter(inRealm),
    transactions: allTransactions.filter(inRealm),
  }
}

export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not a valid backup (not JSON).')
  }
  const backup = data as Partial<BackupFile>
  const tables = [backup.settings, backup.buckets, backup.incomeSources, backup.categories, backup.transactions]
  if (backup.app !== 'family-finance-dashboard' || backup.version !== 1 || !tables.every(Array.isArray)) {
    throw new Error('That file is not a Family Finance backup.')
  }
  if (!tables.flat().every((record) => record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string')) {
    throw new Error('That backup contains an invalid record.')
  }
  return backup as BackupFile
}

/**
 * Add records missing from the active realm. Existing IDs always win, so a
 * stale backup cannot overwrite or delete newer synced data.
 */
export async function mergeBackup(backup: BackupFile, targetRealmId?: string): Promise<BackupMergeResult> {
  const prepared = prepareBackupForRealm(backup, targetRealmId)
  const result: BackupMergeResult = {
    added: { buckets: 0, incomeSources: 0, categories: 0, transactions: 0 },
    skippedExisting: 0,
  }

  await db.transaction('rw', db.settings, db.buckets, db.incomeSources, db.categories, db.transactions, async () => {
    const [buckets, incomeSources, categories, transactions] = await Promise.all([
      missingRecords(db.buckets, prepared.buckets),
      missingRecords(db.incomeSources, prepared.incomeSources),
      missingRecords(db.categories, prepared.categories),
      missingRecords(db.transactions, prepared.transactions),
    ])
    const inTargetRealm = (record: { realmId?: string }) => record.realmId === targetRealmId

    validateReferences(
      [...(await db.buckets.toArray()).filter(inTargetRealm), ...buckets],
      [...(await db.incomeSources.toArray()).filter(inTargetRealm), ...incomeSources],
      [...(await db.categories.toArray()).filter(inTargetRealm), ...categories],
      transactions,
    )

    if (buckets.length) await db.buckets.bulkAdd(buckets)
    if (incomeSources.length) await db.incomeSources.bulkAdd(incomeSources)
    if (categories.length) await db.categories.bulkAdd(categories)
    if (transactions.length) await db.transactions.bulkAdd(transactions)

    result.added = {
      buckets: buckets.length,
      incomeSources: incomeSources.length,
      categories: categories.length,
      transactions: transactions.length,
    }
    result.skippedExisting =
      prepared.buckets.length +
      prepared.incomeSources.length +
      prepared.categories.length +
      prepared.transactions.length -
      buckets.length -
      incomeSources.length -
      categories.length -
      transactions.length
  })

  return result
}

export function prepareBackupForRealm(backup: BackupFile, targetRealmId?: string) {
  const sourceRealmId = backup.settings[0]?.realmId
  const prepare = <T extends { id: string; realmId?: string; owner?: string | null }>(rows: T[]) => {
    const unique = new Map<string, T>()
    rows
      .filter((row) => row.realmId === sourceRealmId)
      .forEach((row) => {
        const { owner: _owner, ...record } = row
        unique.set(row.id, { ...record, realmId: targetRealmId } as T)
      })
    return [...unique.values()]
  }

  return {
    buckets: prepare(backup.buckets),
    incomeSources: prepare(backup.incomeSources),
    categories: prepare(backup.categories),
    transactions: prepare(backup.transactions),
  }
}

async function missingRecords<T extends { id: string }>(table: { bulkGet: (ids: string[]) => Promise<Array<T | undefined>> }, rows: T[]) {
  const existing = await table.bulkGet(rows.map((row) => row.id))
  return rows.filter((_, index) => existing[index] === undefined)
}

function validateReferences(buckets: Bucket[], incomeSources: IncomeSource[], categories: Category[], transactions: Transaction[]) {
  const bucketIds = new Set(buckets.map((row) => row.id))
  const sourceIds = new Set(incomeSources.map((row) => row.id))
  const categoryIds = new Set(categories.map((row) => row.id))
  const broken = transactions.find(
    (row) =>
      !bucketIds.has(row.bucketId) ||
      (row.toBucketId !== undefined && !bucketIds.has(row.toBucketId)) ||
      (row.sourceId !== undefined && !sourceIds.has(row.sourceId)) ||
      (row.categoryId !== undefined && !categoryIds.has(row.categoryId)),
  )
  if (broken) throw new Error(`Backup transaction ${broken.id} references a missing bucket, source, or category.`)
}

export function backupFileName() {
  const today = new Date().toISOString().slice(0, 10)
  return `family-finance-backup-${today}.json`
}
