import { db } from './database'
import type { AppSettings, Bucket, Category, FitnessGoal, FitnessProfile, IncomeSource, Meal, Transaction, Workout } from '../types'

export interface BackupFile {
  app: 'family-finance-dashboard'
  version: 1
  exportedAt: string
  settings: AppSettings[]
  buckets: Bucket[]
  incomeSources: IncomeSource[]
  categories: Category[]
  transactions: Transaction[]
  /** Fitness tables are optional so backups made before the fitness section still restore. */
  workouts?: Workout[]
  meals?: Meal[]
  fitnessGoals?: FitnessGoal[]
  fitnessProfiles?: FitnessProfile[]
}

export interface BackupMergeResult {
  added: {
    buckets: number
    incomeSources: number
    categories: number
    transactions: number
    workouts: number
    meals: number
    fitnessGoals: number
    fitnessProfiles: number
  }
  skippedExisting: number
}

export async function exportBackup(realmId?: string): Promise<BackupFile> {
  const [
    allSettings,
    allBuckets,
    allIncomeSources,
    allCategories,
    allTransactions,
    allWorkouts,
    allMeals,
    allFitnessGoals,
    allFitnessProfiles,
  ] = await Promise.all([
    db.settings.toArray(),
    db.buckets.toArray(),
    db.incomeSources.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.workouts.toArray(),
    db.meals.toArray(),
    db.fitnessGoals.toArray(),
    db.fitnessProfiles.toArray(),
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
    workouts: allWorkouts.filter(inRealm),
    meals: allMeals.filter(inRealm),
    fitnessGoals: allFitnessGoals.filter(inRealm),
    fitnessProfiles: allFitnessProfiles.filter(inRealm),
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
  const requiredTables = [backup.settings, backup.buckets, backup.incomeSources, backup.categories, backup.transactions]
  const optionalTables = [backup.workouts, backup.meals, backup.fitnessGoals, backup.fitnessProfiles]
  if (
    backup.app !== 'family-finance-dashboard' ||
    backup.version !== 1 ||
    !requiredTables.every(Array.isArray) ||
    !optionalTables.every((table) => table === undefined || Array.isArray(table))
  ) {
    throw new Error('That file is not a Family Finance backup.')
  }
  const tables = [...requiredTables, ...optionalTables.filter((table) => table !== undefined)]
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
    added: { buckets: 0, incomeSources: 0, categories: 0, transactions: 0, workouts: 0, meals: 0, fitnessGoals: 0, fitnessProfiles: 0 },
    skippedExisting: 0,
  }

  await db.transaction(
    'rw',
    [db.settings, db.buckets, db.incomeSources, db.categories, db.transactions, db.workouts, db.meals, db.fitnessGoals, db.fitnessProfiles],
    async () => {
      const [buckets, incomeSources, categories, transactions, workouts, meals, fitnessGoals, fitnessProfiles] = await Promise.all([
        missingRecords(db.buckets, prepared.buckets),
        missingRecords(db.incomeSources, prepared.incomeSources),
        missingRecords(db.categories, prepared.categories),
        missingRecords(db.transactions, prepared.transactions),
        missingRecords(db.workouts, prepared.workouts),
        missingRecords(db.meals, prepared.meals),
        missingRecords(db.fitnessGoals, prepared.fitnessGoals),
        missingRecords(db.fitnessProfiles, prepared.fitnessProfiles),
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
      if (workouts.length) await db.workouts.bulkAdd(workouts)
      if (meals.length) await db.meals.bulkAdd(meals)
      if (fitnessGoals.length) await db.fitnessGoals.bulkAdd(fitnessGoals)
      if (fitnessProfiles.length) await db.fitnessProfiles.bulkAdd(fitnessProfiles)

      result.added = {
        buckets: buckets.length,
        incomeSources: incomeSources.length,
        categories: categories.length,
        transactions: transactions.length,
        workouts: workouts.length,
        meals: meals.length,
        fitnessGoals: fitnessGoals.length,
        fitnessProfiles: fitnessProfiles.length,
      }
      const preparedCount = Object.values(prepared).reduce((sum, rows) => sum + rows.length, 0)
      result.skippedExisting = preparedCount - Object.values(result.added).reduce((sum, count) => sum + count, 0)
    },
  )

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
    workouts: prepare(backup.workouts ?? []),
    meals: prepare(backup.meals ?? []),
    fitnessGoals: prepare(backup.fitnessGoals ?? []),
    fitnessProfiles: prepare(backup.fitnessProfiles ?? []),
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
