import Dexie, { type Table } from 'dexie'
import dexieCloud from 'dexie-cloud-addon'
import type { AppSettings, Bucket, Category, IncomeSource, Transaction } from '../types'

const cloudUrl = import.meta.env.VITE_DEXIE_CLOUD_URL as string | undefined

// The "@" primary-key marker is only meaningful to the Dexie Cloud addon's own
// dbcore middleware — with no addon attached, raw IndexedDB rejects "@id" as an
// invalid keyPath outright, breaking local-only mode entirely. Only use the
// cloud-required shape when the addon is actually attached.
const cloudRealmTables = {
  realms: '@realmId',
  members: '@id, [userId+realmId], [email+realmId], realmId',
  roles: '[realmId+name]',
}
const localRealmTables = {
  realms: 'realmId',
  members: 'id,[email+realmId],realmId,email',
  roles: '[realmId+name]',
}

export class FinanceDatabase extends Dexie {
  settings!: Table<AppSettings, string>
  buckets!: Table<Bucket, string>
  incomeSources!: Table<IncomeSource, string>
  categories!: Table<Category, string>
  transactions!: Table<Transaction, string>

  constructor() {
    super('FamilyFinanceDashboard', cloudUrl ? { addons: [dexieCloud] } : undefined)

    // realms/members/roles must match Dexie Cloud's required schema exactly, in every
    // version — the addon validates each version definition, not just the latest.
    // No real invite has ever gone through these tables, so it's safe to correct them here.
    const realmTables = cloudUrl ? cloudRealmTables : localRealmTables

    this.version(2).stores({
      settings: 'id, realmId, activeMonthKey',
      businesses: 'id, realmId, name, ownerId, archived',
      categories: 'id, realmId, name, scope, archived',
      assetItems: 'id, realmId, name, kind, currency, archived',
      transactions: 'id, realmId, date, type, ownerId, sourceBusinessId, categoryId',
      transactionSplits: 'id, realmId, transactionId, date, target, ownerId, businessId, assetId, categoryId, currency',
      monthClosures: 'id, realmId, monthKey, closedAt',
      ...realmTables,
    })

    // v3: buckets + sources model. Do not run content migrations against these
    // synced tables: a per-device clear can cause data loss and divergence.
    this.version(3)
      .stores({
        settings: 'id, realmId',
        buckets: 'id, realmId, name, ownerId, kind, archived',
        incomeSources: 'id, realmId, name, archived',
        categories: 'id, realmId, name, archived',
        transactions: 'id, realmId, date, type, bucketId, toBucketId, sourceId, categoryId',
        businesses: null,
        assetItems: null,
        transactionSplits: null,
        monthClosures: null,
        ...realmTables,
      })

    if (cloudUrl) {
      this.cloud.configure({
        databaseUrl: cloudUrl,
        requireAuth: true,
        // The app has its own AuthButton/login form; skip the addon's built-in modal.
        customLoginGui: true,
        // Keep one observable sync owner. The app explicitly reconciles while
        // open instead of delegating sync to an opaque background worker.
        tryUseServiceWorker: false,
      })
    }
  }
}

export const db = new FinanceDatabase()
export const isCloudConfigured = Boolean(cloudUrl)

export function getDexieCloudUrl() {
  return cloudUrl
}
