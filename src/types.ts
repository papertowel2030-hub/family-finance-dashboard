export type OwnerId = 'moon' | 'alena'
export type BucketOwner = OwnerId | 'shared'

export type BucketKind = 'spending' | 'business' | 'savings'

export type TransactionType =
  | 'income'
  | 'funding'
  | 'expense'
  | 'transfer'
  | 'adjustment'

export interface SyncRecord {
  realmId?: string
  owner?: string | null
}

export interface AppSettings extends SyncRecord {
  id: string
  defaultCurrency: string
  createdAt: string
  updatedAt: string
}

export interface Bucket extends SyncRecord {
  id: string
  name: string
  ownerId: BucketOwner
  kind: BucketKind
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface IncomeSource extends SyncRecord {
  id: string
  name: string
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface Category extends SyncRecord {
  id: string
  name: string
  archived?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Every money movement is a single-bucket transaction:
 * - income     → +amount into bucketId (tagged with sourceId, counts as income)
 * - funding    → +amount into bucketId (business money, NOT income)
 * - expense    → -amount out of bucketId (tagged with categoryId)
 * - transfer   → -amount out of bucketId, +amount into toBucketId
 * - adjustment → signed amount applied to bucketId (balance correction)
 */
export interface Transaction extends SyncRecord {
  id: string
  date: string
  type: TransactionType
  amount: number
  currency: string
  bucketId: string
  toBucketId?: string
  sourceId?: string
  categoryId?: string
  note?: string
  createdAt: string
  updatedAt: string
}

export interface MoneyBucket {
  currency: string
  amount: number
}

export interface BucketBalance {
  bucket: Bucket
  totals: MoneyBucket[]
  monthIn: MoneyBucket[]
  monthOut: MoneyBucket[]
}

export interface LedgerSnapshot {
  balances: BucketBalance[]
  /** Income received in the selected month across all buckets — business funding excluded. */
  monthIncome: MoneyBucket[]
  /** Expenses paid in the selected month from spending/savings buckets — business expenses excluded. */
  monthSpending: MoneyBucket[]
  negativeWarnings: string[]
}

export interface Filters {
  bucketId: 'all' | string
  type: 'all' | TransactionType
  sourceId: 'all' | string
  categoryId: 'all' | string
  from: string
  to: string
}
