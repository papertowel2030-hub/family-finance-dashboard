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

export async function exportBackup(): Promise<BackupFile> {
  const [settings, buckets, incomeSources, categories, transactions] = await Promise.all([
    db.settings.toArray(),
    db.buckets.toArray(),
    db.incomeSources.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
  ])
  return {
    app: 'family-finance-dashboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    buckets,
    incomeSources,
    categories,
    transactions,
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
  if (backup.app !== 'family-finance-dashboard' || !tables.every(Array.isArray)) {
    throw new Error('That file is not a Family Finance backup.')
  }
  return backup as BackupFile
}

/** Replaces everything in the app with the backup's content. */
export async function restoreBackup(backup: BackupFile) {
  await db.transaction('rw', db.settings, db.buckets, db.incomeSources, db.categories, db.transactions, async () => {
    await Promise.all([db.settings.clear(), db.buckets.clear(), db.incomeSources.clear(), db.categories.clear(), db.transactions.clear()])
    await db.settings.bulkPut(backup.settings)
    await db.buckets.bulkPut(backup.buckets)
    await db.incomeSources.bulkPut(backup.incomeSources)
    await db.categories.bulkPut(backup.categories)
    await db.transactions.bulkPut(backup.transactions)
  })
}

export function backupFileName() {
  const today = new Date().toISOString().slice(0, 10)
  return `family-finance-backup-${today}.json`
}
