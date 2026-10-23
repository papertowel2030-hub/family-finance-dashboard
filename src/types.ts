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
  /** Empty array means no filter (all buckets). */
  bucketIds: string[]
  /** Empty array means no filter (all types). */
  types: TransactionType[]
  /** Empty array means no filter (all sources). */
  sourceIds: string[]
  /** Empty array means no filter (all categories). */
  categoryIds: string[]
  from: string
  to: string
  /** Free-text search over note, bucket, source, category, type, date and amount. Empty means no search. */
  query: string
}

// ---------------------------------------------------------------------------
// Fitness (separate from the finance model — shares only the realm + OwnerId)
// ---------------------------------------------------------------------------

/** 'rest' is a deliberate recovery day: logged like a session but never counted as training. */
export type WorkoutKind = 'strength' | 'cardio' | 'sport' | 'rest'
export type TrainingKind = Exclude<WorkoutKind, 'rest'>

export interface StrengthSet {
  reps: number
  /** Weight in kg; 0 means bodyweight. */
  weight: number
}

/** One exercise or activity on one day, for one person. */
export interface Workout extends SyncRecord {
  id: string
  ownerId: OwnerId
  /** YYYY-MM-DD */
  date: string
  kind: WorkoutKind
  /** Exercise name (strength), cardio type, or sport/activity. */
  title: string
  sets?: StrengthSet[]
  minutes?: number
  /** Kilometres. */
  distance?: number
  /** Perceived effort 1 (easy) to 5 (max). */
  effort?: number
  /** True when something hurt — feeds the injury-watch nudge. */
  niggle?: boolean
  note?: string
  createdAt: string
  updatedAt: string
}

/**
 * One diet log entry (e.g. "+25 g protein"). Daily totals are the sum of entries,
 * never a single overwritten row, so two phones logging at once can't clobber each other.
 */
export interface Meal extends SyncRecord {
  id: string
  ownerId: OwnerId
  /** YYYY-MM-DD */
  date: string
  proteinG: number
  fiberG: number
  calories: number
  label?: string
  createdAt: string
  updatedAt: string
}

export type GoalArea = 'strength' | 'cardio' | 'consistency' | 'health' | 'other'

/** Free-form personal goal. Numeric target/current are optional and drive a progress bar. */
export interface FitnessGoal extends SyncRecord {
  id: string
  ownerId: OwnerId
  title: string
  area: GoalArea
  target?: number
  current?: number
  unit?: string
  /** YYYY-MM-DD */
  targetDate?: string
  done?: boolean
  archived?: boolean
  note?: string
  createdAt: string
  updatedAt: string
}

/** Daily targets and weekly rhythm for one person. Id is deterministic: `fprof_<ownerId>`. */
export interface FitnessProfile extends SyncRecord {
  id: string
  ownerId: OwnerId
  proteinTarget: number
  fiberTarget: number
  calorieTarget: number
  /** Training sessions per week the person is aiming for. */
  weeklySessions: number
  createdAt: string
  updatedAt: string
}
