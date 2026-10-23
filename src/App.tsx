import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import type { Table } from 'dexie'
import { BehaviorSubject } from 'rxjs'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Cloud,
  CloudOff,
  Coins,
  Download,
  Dumbbell,
  Edit3,
  HandCoins,
  LineChart,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  PiggyBank,
  PlusCircle,
  Receipt,
  RefreshCcw,
  Repeat,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import type { DXCInputField, DXCUserInteraction } from 'dexie-cloud-addon'
import { db, getDexieCloudUrl, isCloudConfigured } from './db/database'
import {
  addBucket,
  addCategory,
  addSource,
  createCloudFamilySpace,
  createLocalFamilySpace,
  deleteBucket,
  deleteCategory,
  deleteSource,
  deleteTransaction,
  renameBucket,
  renameCategory,
  renameSource,
  restoreTransaction,
  saveAdjustment,
  saveExpense,
  saveFunding,
  saveIncome,
  saveTransfer,
  setBucketArchived,
  setCategoryArchived,
  setSourceArchived,
  updateDefaultCurrency,
  updateTransaction,
} from './db/actions'
import { backupFileName, exportBackup, mergeBackup, parseBackup } from './db/backup'
import { listDeletedTransactions, RECOVERY_KEEP_DAYS, restoreDeleted, type RecoveryEntry, updateRecoveryLog } from './db/recovery'
import { requestCloudSync } from './db/sync'
import { FitnessApp } from './fitness/FitnessApp'
import { FitnessBoundary } from './fitness/FitnessBoundary'
import { recentValues, searchTransactions } from './lib/activity'
import { activeCurrencies, computeLedger, monthFlowTotals, monthTrend, spendingByCategory } from './lib/ledger'
import type {
  AppSettings,
  Bucket,
  BucketKind,
  BucketOwner,
  Category,
  Filters,
  IncomeSource,
  LedgerSnapshot,
  MoneyBucket,
  Transaction,
  TransactionType,
} from './types'
import {
  currentMonthKey,
  formatMonth,
  formatMonthShort,
  formatShortDate,
  monthKeysEndingAt,
  nextMonthKey,
  previousMonthKey,
  todayInputDate,
} from './utils/date'
import { formatBuckets, formatMoney, parseAmount, roundMoney } from './utils/money'
import { NO_SEARCH_MATCH, SAVED_LINES } from './utils/financeCopy'
import { quip } from './utils/quip'

const ownerNames: Record<BucketOwner, string> = {
  moon: 'Moon',
  alena: 'Alena',
  shared: 'Shared',
}

const emptyFilters: Filters = {
  bucketIds: [],
  types: [],
  sourceIds: [],
  categoryIds: [],
  from: '',
  to: '',
  query: '',
}

const transactionLabels: Record<TransactionType, string> = {
  income: 'Income',
  funding: 'Business funding',
  expense: 'Expense',
  transfer: 'Transfer',
  adjustment: 'Balance fix',
}

const bucketGroups: Array<{ kind: BucketKind; title: string; hint?: string }> = [
  { kind: 'spending', title: 'Money to spend' },
  { kind: 'business', title: 'Business money', hint: 'Only for business expenses' },
  { kind: 'savings', title: 'Savings' },
]

const groupTones: Record<BucketKind, string> = {
  spending: 'blue',
  business: 'amber',
  savings: 'teal',
}

type Tab = 'home' | 'add' | 'activity' | 'setup'

const TABS: Array<{ id: Tab; label: string; Icon: typeof Wallet }> = [
  { id: 'home', label: 'Home', Icon: Wallet },
  { id: 'add', label: 'Add', Icon: PlusCircle },
  { id: 'activity', label: 'Activity', Icon: Receipt },
  { id: 'setup', label: 'Setup', Icon: Settings },
]

// Currencies Moon & Alena actually use, offered as a datalist while still allowing any free text.
const COMMON_CURRENCIES = ['RUB', 'USD', 'EUR', 'GBP', 'AED', 'TRY', 'GEL', 'KZT', 'INR']

// Who is looking at Home right now. Not a stored identity — a quick lens either person can flip.
// Kept in a module variable so switching tabs and back doesn't lose it, but a fresh load starts neutral.
type Section = 'finance' | 'fitness'
const SECTION_KEY = 'familyFinanceSection'
const INSIGHTS_KEY = 'familyFinanceInsightsOpen'

function readInsightsOpen() {
  try {
    return window.localStorage.getItem(INSIGHTS_KEY) === '1'
  } catch {
    return false
  }
}

function readSection(): Section {
  try {
    return window.localStorage.getItem(SECTION_KEY) === 'fitness' ? 'fitness' : 'finance'
  } catch {
    return 'finance'
  }
}

type ViewerId = 'all' | 'moon' | 'alena'
let sessionViewer: ViewerId = 'all'

const VIEWER_OPTIONS: Array<{ id: ViewerId; label: string }> = [
  { id: 'all', label: 'Everyone' },
  { id: 'moon', label: 'Moon' },
  { id: 'alena', label: 'Alena' },
]

/** 0 = mine (or neutral), 1 = shared, 2 = partner's — used to order buckets around the current viewer. */
function ownerRank(ownerId: BucketOwner, viewer: ViewerId) {
  if (viewer === 'all') return 0
  if (ownerId === viewer) return 0
  if (ownerId === 'shared') return 1
  return 2
}

type CloudUser = { isLoggedIn?: boolean; name?: string; email?: string }
type CloudSyncState = { status?: string; phase?: string; error?: Error }
type CloudInvite = { id: string; roles?: string[]; realm?: { name?: string }; accept: () => Promise<void>; reject: () => Promise<void> }

const offlineUser$ = new BehaviorSubject<CloudUser>({ isLoggedIn: false })
const offlineSync$ = new BehaviorSubject<CloudSyncState>({ status: 'Local only' })
const offlineInvites$ = new BehaviorSubject<CloudInvite[]>([])
const offlineInteraction$ = new BehaviorSubject<DXCUserInteraction | undefined>(undefined)

type StorageState = 'checking' | 'ready' | 'unavailable'

const UNDO_WINDOW_MS = 12_000
const SAVED_NOTICE_MS = 7_000

function App() {
  const [storageState, setStorageState] = useState<StorageState>(() => (canSeeIndexedDb() ? 'checking' : 'unavailable'))

  useEffect(() => {
    if (storageState !== 'checking') return
    let active = true

    verifyIndexedDbAccess().then((isAvailable) => {
      if (active) setStorageState(isAvailable ? 'ready' : 'unavailable')
    })

    return () => {
      active = false
    }
  }, [storageState])

  if (storageState === 'checking') {
    return (
      <main className="app-shell">
        <div className="loading">Checking local storage</div>
      </main>
    )
  }

  if (storageState === 'unavailable') {
    return (
      <main className="app-shell">
        <StorageUnavailablePanel />
      </main>
    )
  }

  return <FinanceApp />
}

function FinanceApp() {
  const settings = useLiveQuery(() => db.settings.toArray().then((rows) => rows[0] ?? null), [], null)
  const activeRealmId = settings?.realmId
  const buckets = useLiveQuery(
    () => rowsInRealm(db.buckets, activeRealmId).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name))),
    [activeRealmId],
    [],
  )
  const sources = useLiveQuery(
    () => rowsInRealm(db.incomeSources, activeRealmId).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name))),
    [activeRealmId],
    [],
  )
  const categories = useLiveQuery(
    () => rowsInRealm(db.categories, activeRealmId).then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name))),
    [activeRealmId],
    [],
  )
  const transactions = useLiveQuery(
    () => rowsInRealm(db.transactions, activeRealmId).then((rows) => rows.sort((a, b) => b.date.localeCompare(a.date))),
    [activeRealmId],
    [],
  )
  const currentUser = useObservable((isCloudConfigured ? db.cloud.currentUser : offlineUser$) as never) as CloudUser | undefined
  const syncState = useObservable((isCloudConfigured ? db.cloud.syncState : offlineSync$) as never) as CloudSyncState | undefined
  const invites = useObservable((isCloudConfigured ? db.cloud.invites : offlineInvites$) as never, []) as CloudInvite[] | undefined
  const userInteraction = useObservable(
    (isCloudConfigured ? db.cloud.userInteraction : offlineInteraction$) as never,
  ) as DXCUserInteraction | undefined

  const [tab, setTab] = useState<Tab>('home')
  const [section, setSectionState] = useState<Section>(readSection)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  // Every delete keeps its own Undo, so deleting several in a row never loses the earlier ones.
  const [recentDeletes, setRecentDeletes] = useState<Array<{ transaction: Transaction; deletedAt: number }>>([])
  const [prefill, setPrefill] = useState<{ transaction: Transaction; key: number } | null>(null)
  // The "Saved" toast after Fast add: names what was stored and offers Undo for a moment.
  const [savedNotice, setSavedNotice] = useState<{ transaction: Transaction; key: number } | null>(null)
  const recoveryQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (!recentDeletes.length) return
    const oldest = Math.min(...recentDeletes.map((item) => item.deletedAt))
    const timer = window.setTimeout(
      () => setRecentDeletes((items) => items.filter((item) => Date.now() - item.deletedAt < UNDO_WINDOW_MS)),
      Math.max(0, oldest + UNDO_WINDOW_MS - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [recentDeletes])

  useEffect(() => {
    if (!savedNotice) return
    const timer = window.setTimeout(() => setSavedNotice(null), SAVED_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [savedNotice])

  // Keep this device's recovery log in step with the data. Reads all tables in one
  // transaction so a half-loaded state never makes records look deleted.
  useEffect(() => {
    if (!settings) return
    const timer = window.setTimeout(() => {
      // Queued so an older update can never land after a newer one.
      recoveryQueue.current = recoveryQueue.current
        .then(() =>
          db.transaction('r', db.buckets, db.incomeSources, db.categories, db.transactions, async () => {
            const [liveBuckets, liveSources, liveCategories, liveTransactions] = await Promise.all([
              rowsInRealm(db.buckets, activeRealmId),
              rowsInRealm(db.incomeSources, activeRealmId),
              rowsInRealm(db.categories, activeRealmId),
              rowsInRealm(db.transactions, activeRealmId),
            ])
            return { buckets: liveBuckets, incomeSources: liveSources, categories: liveCategories, transactions: liveTransactions }
          }),
        )
        .then((live) => updateRecoveryLog(live, activeRealmId))
        .catch((error) => console.warn('Recovery log update failed', error))
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [settings, activeRealmId, buckets, sources, categories, transactions])

  const setSection = (next: Section) => {
    setSectionState(next)
    try {
      window.localStorage.setItem(SECTION_KEY, next)
    } catch {
      // Remembering the section is a convenience only.
    }
  }
  const showFinance = section === 'finance'

  const ledger = useMemo(() => computeLedger(buckets ?? [], transactions ?? [], monthKey), [buckets, transactions, monthKey])

  const filteredTransactions = useMemo(
    () =>
      searchTransactions(filterTransactions(transactions ?? [], filters), filters.query, {
        buckets: buckets ?? [],
        sources: sources ?? [],
        categories: categories ?? [],
        typeLabels: transactionLabels,
      }),
    [transactions, filters, buckets, sources, categories],
  )

  const activeBuckets = useMemo(() => (buckets ?? []).filter((bucket) => !bucket.archived), [buckets])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Moon &amp; Alena</p>
          <h1>{showFinance ? 'Family Finance' : 'Family Fitness'}</h1>
        </div>
        <div className="top-actions">
          {settings ? (
            <div className="section-switch" role="group" aria-label="Section">
              <button
                type="button"
                className={showFinance ? 'active' : ''}
                aria-pressed={showFinance}
                aria-label="Finance"
                title="Finance"
                onClick={() => setSection('finance')}
              >
                <Wallet size={18} />
              </button>
              <button
                type="button"
                className={!showFinance ? 'active' : ''}
                aria-pressed={!showFinance}
                aria-label="Fitness"
                title="Fitness"
                onClick={() => setSection('fitness')}
              >
                <Dumbbell size={18} />
              </button>
            </div>
          ) : null}
          <SyncBadge currentUser={currentUser} syncState={syncState} />
          <AuthButton currentUser={currentUser} />
        </div>
      </header>

      <UserInteractionDialog interaction={userInteraction} />

      {!settings ? (
        <SetupPanel currentUser={currentUser} invites={invites} />
      ) : (
        <>
          {invites && invites.length > 0 ? <InvitePanel invites={invites} /> : null}
          {!showFinance ? (
            <FitnessBoundary onBack={() => setSection('finance')}>
              <FitnessApp realmId={activeRealmId} />
            </FitnessBoundary>
          ) : null}
          {showFinance ? <TabBar tab={tab} setTab={setTab} /> : null}

          {showFinance && tab === 'home' ? (
            <Dashboard
              ledger={ledger}
              monthKey={monthKey}
              onMonthChange={setMonthKey}
              transactions={transactions ?? []}
              buckets={buckets ?? []}
              categories={categories ?? []}
              defaultCurrency={settings.defaultCurrency}
              onOpenBucket={(bucketId) => {
                setFilters({ ...emptyFilters, bucketIds: [bucketId] })
                setTab('activity')
              }}
              onOpenBackup={() => setTab('setup')}
            />
          ) : null}

          {showFinance && tab === 'add' ? (
            <RecordMoney
              settings={settings}
              buckets={activeBuckets}
              sources={sources ?? []}
              categories={categories ?? []}
              transactions={transactions ?? []}
              prefill={prefill}
              onSaved={(transaction) => setSavedNotice({ transaction, key: Date.now() })}
            />
          ) : null}

          {showFinance && tab === 'activity' ? (
            <div className="activity-stack">
              <FiltersPanel
                filters={filters}
                setFilters={setFilters}
                buckets={buckets ?? []}
                sources={sources ?? []}
                categories={categories ?? []}
              />
              <Charts
                transactions={filteredTransactions}
                buckets={buckets ?? []}
                sources={sources ?? []}
                categories={categories ?? []}
                filters={filters}
                setFilters={setFilters}
              />
              <History
                transactions={filteredTransactions}
                total={(transactions ?? []).length}
                buckets={buckets ?? []}
                sources={sources ?? []}
                categories={categories ?? []}
                onEdit={setEditing}
                onRepeat={(transaction) => {
                  setPrefill({ transaction, key: Date.now() })
                  setTab('add')
                }}
              />
            </div>
          ) : null}

          {showFinance && tab === 'setup' ? (
            <ManagementPanel
              settings={settings}
              buckets={buckets ?? []}
              sources={sources ?? []}
              categories={categories ?? []}
              ledger={ledger}
            />
          ) : null}

          {editing ? (
            <EditTransactionDialog
              transaction={editing}
              buckets={buckets ?? []}
              sources={sources ?? []}
              categories={categories ?? []}
              onClose={() => setEditing(null)}
              onDelete={async (transaction) => {
                await deleteTransaction(transaction.id)
                setEditing(null)
                setRecentDeletes((items) => [...items, { transaction, deletedAt: Date.now() }])
              }}
            />
          ) : null}
          {recentDeletes.length ? (
            <div className="undo-stack" role="status">
              {recentDeletes.slice(-3).map(({ transaction }) => (
                <div className="undo-toast" key={transaction.id}>
                  <span>
                    Deleted: {transactionLabels[transaction.type].toLowerCase()} {signedAmount(transaction)}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await restoreTransaction(transaction)
                      setRecentDeletes((items) => items.filter((item) => item.transaction.id !== transaction.id))
                    }}
                  >
                    Undo
                  </button>
                </div>
              ))}
              {recentDeletes.length > 3 ? (
                <span className="undo-more">+{recentDeletes.length - 3} more in Setup → Recently deleted</span>
              ) : null}
            </div>
          ) : null}
          {savedNotice ? (
            // At the top, so it never covers the Save button when several entries go in a row.
            <div className="saved-toast" role="status" key={savedNotice.key}>
              <span>
                Saved {transactionLabels[savedNotice.transaction.type].toLowerCase()} {signedAmount(savedNotice.transaction)}.{' '}
                {quip(SAVED_LINES, savedNotice.transaction.id)}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const { id } = savedNotice.transaction
                  setSavedNotice(null)
                  await deleteTransaction(id)
                }}
              >
                Undo
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={tab === id ? 'active' : ''}
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => setTab(id)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

function canSeeIndexedDb() {
  return getIndexedDbFactory() !== undefined
}

async function verifyIndexedDbAccess(timeoutMs = 2200) {
  if (!canSeeIndexedDb()) return Promise.resolve(false)

  const indexedDbAvailable = await verifyRawIndexedDbAccess(timeoutMs)
  if (!indexedDbAvailable) return false

  // With Dexie Cloud + requireAuth, table reads stay pending until the user logs in,
  // so querying the app's own tables here would misreport "not signed in yet" as
  // "storage unavailable". The raw IndexedDB probe above is enough in that case.
  if (isCloudConfigured) return true

  return withTimeout(
    db.settings
      .limit(1)
      .toArray()
      .then(() => true)
      .catch((error) => {
        markStorageProbeError(error)
        return false
      }),
    timeoutMs,
    false,
  )
}

function markStorageProbeError(error: unknown) {
  if (typeof document === 'undefined') return

  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)

  document.documentElement.dataset.financeStorageError = message || 'Unknown Dexie storage error'
}

function verifyRawIndexedDbAccess(timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const probeName = 'FamilyFinanceDashboardStorageProbe'
    let settled = false
    let request: IDBOpenDBRequest | undefined

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)

      try {
        request?.result?.close()
      } catch {
        // Some failed opens expose no result; the app only needs the availability signal.
      }

      if (result) {
        try {
          getIndexedDbFactory()?.deleteDatabase(probeName)
        } catch {
          // Leaving the tiny probe database behind is safer than blocking app startup.
        }
      }

      resolve(result)
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs)

    try {
      request = getIndexedDbFactory()?.open(probeName, 1)
      if (!request) {
        finish(false)
        return
      }
      request.onupgradeneeded = () => {
        request?.result.createObjectStore('probe')
      }
      request.onsuccess = () => finish(true)
      request.onerror = () => finish(false)
      request.onblocked = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

function getIndexedDbFactory() {
  return getGlobalHosts().every(hasCompleteIndexedDbSurface) ? getGlobalHosts()[0]?.indexedDB : undefined
}

function getGlobalHosts() {
  return [globalThis, typeof window !== 'undefined' ? window : undefined, typeof self !== 'undefined' ? self : undefined].filter(
    (host, index, hosts): host is typeof globalThis => Boolean(host) && hosts.indexOf(host) === index,
  )
}

function hasCompleteIndexedDbSurface(host: typeof globalThis) {
  return (
    'indexedDB' in host &&
    typeof host.indexedDB?.open === 'function' &&
    'IDBKeyRange' in host &&
    typeof host.IDBKeyRange?.bound === 'function' &&
    'IDBTransaction' in host &&
    typeof host.IDBTransaction === 'function'
  )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs)

    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => window.clearTimeout(timer))
  })
}

async function rowsInRealm<T extends { realmId?: string }>(table: Table<T, string>, realmId?: string) {
  const rows = await table.toArray()
  return rows.filter((row) => row.realmId === realmId)
}

function StorageUnavailablePanel() {
  return (
    <section className="setup-panel">
      <div className="setup-copy">
        <p className="eyebrow">Storage unavailable</p>
        <h2>IndexedDB is required</h2>
      </div>
      <div className="setup-actions">
        <p className="quiet-line">
          Use a regular browser window with IndexedDB enabled. Private browsing or blocked site storage can prevent the local-first
          database from opening.
        </p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          <RefreshCcw size={18} />
          Retry
        </button>
      </div>
    </section>
  )
}

export function SyncBadge({
  currentUser,
  syncState,
}: {
  currentUser?: { isLoggedIn?: boolean; name?: string; email?: string }
  syncState?: CloudSyncState
}) {
  const loggedIn = Boolean(currentUser?.isLoggedIn)
  const [requestError, setRequestError] = useState<string>()
  const [isDelayed, setIsDelayed] = useState(false)
  const activePhase = syncState?.phase === 'pulling' || syncState?.phase === 'pushing'

  useEffect(() => {
    setRequestError(undefined)
  }, [loggedIn])

  useEffect(() => {
    setIsDelayed(false)
    if (!activePhase) return

    const timer = window.setTimeout(() => setIsDelayed(true), 20_000)
    return () => window.clearTimeout(timer)
  }, [activePhase, syncState?.phase])

  const syncNow = async () => {
    if (!isCloudConfigured || !loggedIn) return
    setRequestError(undefined)
    try {
      const { requestedAt } = await requestCloudSync(db.cloud)
      localStorage.setItem('familyFinanceLastSyncRequest', requestedAt)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!isCloudConfigured) {
    return (
      <span className="sync-badge muted">
        <CloudOff size={16} />
        Local only
      </span>
    )
  }

  const cloudError = requestError || syncState?.error?.message
  const isRunning = activePhase && !isDelayed
  const isError = Boolean(requestError) || syncState?.status === 'error' || syncState?.phase === 'error'
  const isOffline = syncState?.status === 'offline' || syncState?.status === 'disconnected' || syncState?.phase === 'offline'
  const label = !loggedIn
    ? 'Sign in'
    : isError
      ? 'Sync failed'
      : isDelayed
        ? 'Sync delayed'
        : isRunning
          ? 'Syncing…'
          : isOffline
            ? 'Offline'
            : syncState?.phase === 'in-sync'
              ? 'Synced'
              : 'Not synced'

  return (
    <button
      type="button"
      className={`sync-badge ${isError || isDelayed ? 'error' : isOffline ? 'muted' : ''}`}
      disabled={!loggedIn}
      onClick={() => void syncNow()}
      title={
        cloudError ||
        (isDelayed
          ? 'Sync is taking longer than expected. Your changes are saved locally; click to retry.'
          : loggedIn
            ? 'Sync now'
            : 'Sign in to sync')
      }
      aria-live="polite"
    >
      <Cloud size={16} />
      {label}
    </button>
  )
}

function AuthButton({ currentUser }: { currentUser?: { isLoggedIn?: boolean; email?: string; name?: string } }) {
  const [email, setEmail] = useState('')

  if (!isCloudConfigured) return null

  if (currentUser?.isLoggedIn) {
    return (
      <button className="icon-text-button" type="button" onClick={() => db.cloud.logout()}>
        <LogOut size={18} />
        {currentUser.name || currentUser.email || 'Logout'}
      </button>
    )
  }

  return (
    <form
      className="login-form"
      onSubmit={(event) => {
        event.preventDefault()
        db.cloud.login(email ? { email, grant_type: 'otp' } : { grant_type: 'otp' })
      }}
    >
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email" type="email" />
      <button className="icon-button" type="submit" aria-label="Login">
        <LogIn size={18} />
      </button>
    </form>
  )
}

function SetupPanel({
  currentUser,
  invites,
}: {
  currentUser?: { isLoggedIn?: boolean }
  invites?: CloudInvite[]
}) {
  const [spouseEmail, setSpouseEmail] = useState('')
  const [spouseName, setSpouseName] = useState('Alena')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <section className="setup-panel">
      <div className="setup-copy">
        <p className="eyebrow">Finance space</p>
        <h2>No buckets yet</h2>
      </div>

      {!isCloudConfigured ? (
        <div className="setup-actions">
          <p className="quiet-line">
            Starts with three buckets: Moon, Alena and Family. Everything stays on this device until shared sync is switched on.
          </p>
          <button type="button" className="primary-button" onClick={() => createLocalFamilySpace()}>
            <Plus size={18} />
            Create local space
          </button>
        </div>
      ) : currentUser?.isLoggedIn ? (
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            try {
              await Promise.race([
                createCloudFamilySpace(spouseEmail, spouseName),
                new Promise((_, reject) => window.setTimeout(() => reject(new Error('Taking too long — check your connection and try again.')), 15000)),
              ])
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            Spouse email
            <input value={spouseEmail} onChange={(event) => setSpouseEmail(event.target.value)} type="email" />
          </label>
          <label>
            Invite name
            <input value={spouseName} onChange={(event) => setSpouseName(event.target.value)} />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="primary-button" disabled={busy}>
            <ShieldCheck size={18} />
            {busy ? 'Creating…' : 'Create shared space'}
          </button>
        </form>
      ) : (
        <p className="quiet-line">Sign in to create or join the shared family space.</p>
      )}

      {invites && invites.length > 0 ? <InvitePanel invites={invites} /> : null}
      {import.meta.env.DEV ? <p className="quiet-line">Dexie Cloud URL: {getDexieCloudUrl() ?? 'not configured'}</p> : null}
    </section>
  )
}

function InvitePanel({ invites }: { invites: CloudInvite[] }) {
  return (
    <section className="notice-panel">
      <h2>Invites</h2>
      {invites.map((invite) => (
        <div className="invite-row" key={invite.id}>
          <span>{invite.realm?.name ?? 'Shared finance space'}</span>
          <div className="row-actions">
            <button type="button" onClick={() => invite.accept()}>
              Accept
            </button>
            <button type="button" className="ghost-button" onClick={() => invite.reject()}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}

function Dashboard({
  ledger,
  monthKey,
  onMonthChange,
  transactions,
  buckets,
  categories,
  defaultCurrency,
  onOpenBucket,
  onOpenBackup,
}: {
  ledger: LedgerSnapshot
  monthKey: string
  onMonthChange: (monthKey: string) => void
  transactions: Transaction[]
  buckets: Bucket[]
  categories: Category[]
  defaultCurrency: string
  onOpenBucket: (bucketId: string) => void
  onOpenBackup: () => void
}) {
  const [viewer, setViewer] = useState<ViewerId>(sessionViewer)
  const changeViewer = (next: ViewerId) => {
    sessionViewer = next
    setViewer(next)
  }
  const [backupDue, setBackupDue] = useState(() => {
    const age = daysSince(readLastBackupAt())
    return (age === null || age >= BACKUP_REMIND_DAYS) && !isBackupReminderSnoozed()
  })

  const owners = useMemo<BucketOwner[] | null>(
    () => (viewer === 'moon' ? ['moon', 'shared'] : viewer === 'alena' ? ['alena', 'shared'] : null),
    [viewer],
  )
  const monthTotals = useMemo(() => monthFlowTotals(buckets, transactions, monthKey, owners), [buckets, transactions, monthKey, owners])
  const saved = savedPerCurrency(monthTotals.income, monthTotals.spending)

  const allLeft = saved.length > 0 && saved.every((item) => item.amount >= 0)
  const allOver = saved.length > 0 && saved.every((item) => item.amount < 0)
  const heroLabel = allLeft ? 'Left over' : allOver ? 'Overspent' : 'Net'
  const scopeNote = viewer === 'all' ? 'Business money not counted' : `${ownerNames[viewer]} + shared · business not counted`

  return (
    <section className="dashboard-wrap">
      <div className="home-toolbar">
        <div className="month-stepper">
          <button type="button" className="icon-button" aria-label="Previous month" onClick={() => onMonthChange(previousMonthKey(monthKey))}>
            <ChevronLeft size={18} />
          </button>
          <label className="month-picker">
            <span className="visually-hidden">Month</span>
            <input type="month" value={monthKey} onChange={(event) => onMonthChange(event.target.value || currentMonthKey())} />
          </label>
          <button type="button" className="icon-button" aria-label="Next month" onClick={() => onMonthChange(nextMonthKey(monthKey))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="segmented-control" role="group" aria-label="Viewing as">
          {VIEWER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={viewer === option.id ? 'active' : ''}
              aria-pressed={viewer === option.id}
              onClick={() => changeViewer(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="month-hero">
        <div className="hero-main">
          <span className="hero-label">
            <PiggyBank size={16} />
            {heroLabel}
          </span>
          {saved.length ? (
            <strong className={`hero-value ${allOver ? 'over' : ''}`}>
              {saved
                .map((item) => (allLeft || allOver ? formatMoney(Math.abs(item.amount), item.currency) : `${item.amount < 0 ? '−' : '+'}${formatMoney(Math.abs(item.amount), item.currency)}`))
                .join(' · ')}
            </strong>
          ) : (
            <strong className="hero-value quiet">Nothing recorded yet. Blank canvas.</strong>
          )}
        </div>
        <div className="hero-flows">
          <span className="summary-item in" title="Money in">
            <ArrowDownToLine size={16} />
            +{formatBuckets(monthTotals.income, '0')}
          </span>
          <span className="summary-item out" title="Spent">
            <ArrowUpFromLine size={16} />
            −{formatBuckets(monthTotals.spending, '0')}
          </span>
        </div>
        <span className="hero-note">{scopeNote}</span>
      </div>

      {backupDue && transactions.length ? (
        <div className="reminder-strip">
          <Download size={16} />
          <span>No backup in {BACKUP_REMIND_DAYS}+ days</span>
          <button type="button" className="primary-button" onClick={onOpenBackup}>
            Back up
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Remind me in a week"
            title="Remind me in a week"
            onClick={() => {
              snoozeBackupReminder(7)
              setBackupDue(false)
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="bucket-groups">
        {bucketGroups.map((group) => {
          const balances = ledger.balances.filter((balance) => balance.bucket.kind === group.kind)
          if (!balances.length && group.kind !== 'spending') return null
          return <BucketGroupView key={group.kind} group={group} balances={balances} viewer={viewer} onOpenBucket={onOpenBucket} />
        })}
      </div>

      {ledger.negativeWarnings.length ? (
        <div className="warning-strip">
          <CircleAlert size={18} />
          {ledger.negativeWarnings.join(' · ')}
        </div>
      ) : null}

      <MonthInsights
        buckets={buckets}
        transactions={transactions}
        categories={categories}
        monthKey={monthKey}
        owners={owners}
        defaultCurrency={defaultCurrency}
        onMonthChange={onMonthChange}
      />
    </section>
  )
}

/** Money in minus spent, per currency, for currencies that had any flow. */
function savedPerCurrency(income: MoneyBucket[], spending: MoneyBucket[]) {
  const currencies = [...new Set([...income, ...spending].map((item) => item.currency))].sort()
  return currencies.map((currency) => ({
    currency,
    amount: roundMoney(
      (income.find((item) => item.currency === currency)?.amount ?? 0) - (spending.find((item) => item.currency === currency)?.amount ?? 0),
    ),
  }))
}

const TREND_MONTHS = 6
const TOP_CATEGORIES = 5

function MonthInsights({
  buckets,
  transactions,
  categories,
  monthKey,
  owners,
  defaultCurrency,
  onMonthChange,
}: {
  buckets: Bucket[]
  transactions: Transaction[]
  categories: Category[]
  monthKey: string
  owners: BucketOwner[] | null
  defaultCurrency: string
  onMonthChange: (monthKey: string) => void
}) {
  const monthKeys = useMemo(() => monthKeysEndingAt(monthKey, TREND_MONTHS), [monthKey])
  const currencies = useMemo(() => {
    const used = activeCurrencies(transactions, monthKeys)
    return used.includes(defaultCurrency) || !used.length ? [defaultCurrency, ...used.filter((item) => item !== defaultCurrency)] : used
  }, [transactions, monthKeys, defaultCurrency])
  const [pickedCurrency, setPickedCurrency] = useState('')
  const currency = currencies.includes(pickedCurrency) ? pickedCurrency : currencies[0]

  const trend = useMemo(
    () => monthTrend(buckets, transactions, monthKey, TREND_MONTHS, owners, currency),
    [buckets, transactions, monthKey, owners, currency],
  )
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [open, setOpenState] = useState(readInsightsOpen)
  const toggleOpen = () => {
    setOpenState((value) => {
      try {
        window.localStorage.setItem(INSIGHTS_KEY, value ? '0' : '1')
      } catch {
        // Remembering this is a convenience only.
      }
      return !value
    })
  }
  const categoryRows = useMemo(() => {
    const current = spendingByCategory(buckets, transactions, monthKey, owners, currency)
    const previous = spendingByCategory(buckets, transactions, previousMonthKey(monthKey), owners, currency)
    const total = [...current.values()].reduce((sum, amount) => sum + amount, 0)
    const rows = [...current.entries()]
      .map(([categoryId, amount]) => ({
        key: categoryId,
        label: nameForCategory(categoryId || undefined, categories),
        amount,
        previous: previous.get(categoryId) ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount)
    const top = rows.slice(0, TOP_CATEGORIES)
    const rest = rows.slice(TOP_CATEGORIES)
    if (rest.length) {
      top.push({
        key: 'other',
        label: `Other (${rest.length}) ▸`,
        amount: roundMoney(rest.reduce((sum, row) => sum + row.amount, 0)),
        previous: roundMoney(rest.reduce((sum, row) => sum + row.previous, 0)),
      })
    }
    return { rows: showAllCategories ? rows : top, canCollapse: rest.length > 0, total: roundMoney(total) }
  }, [buckets, transactions, categories, monthKey, owners, currency, showAllCategories])

  const trendMax = Math.max(...trend.map((row) => Math.max(row.income, row.spending)), 0)
  const categoryMax = Math.max(...categoryRows.rows.map((row) => row.amount), 0)
  const hasTrend = trend.some((row) => row.income || row.spending)

  return (
    <section className="panel insights-panel">
      <div className="section-header compact">
        <button type="button" className="insights-toggle" aria-expanded={open} onClick={toggleOpen}>
          <LineChart size={18} />
          <h2>Month insights</h2>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {open && currencies.length > 1 ? (
          <div className="segmented-control" aria-label="Currency">
            {currencies.map((item) => (
              <button key={item} type="button" className={item === currency ? 'active' : ''} onClick={() => setPickedCurrency(item)}>
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {open ? (
        <>
      <div className="insight-block">
        <div className="inline-header">
          <h3>Last {TREND_MONTHS} months</h3>
          <span className="trend-legend">
            <span className="legend-dot in" /> In <span className="legend-dot out" /> Spent
          </span>
        </div>
        {hasTrend ? (
          <div className="trend-chart" role="list">
            {trend.map((row) => {
              const net = roundMoney(row.income - row.spending)
              return (
                <button
                  key={row.monthKey}
                  type="button"
                  role="listitem"
                  className={`trend-month ${row.monthKey === monthKey ? 'active' : ''}`}
                  onClick={() => onMonthChange(row.monthKey)}
                  title={`${formatMonth(row.monthKey)}: in ${formatMoney(row.income, currency)}, spent ${formatMoney(row.spending, currency)}`}
                  aria-label={`${formatMonth(row.monthKey)}: in ${formatMoney(row.income, currency)}, spent ${formatMoney(row.spending, currency)}`}
                >
                  <span className="trend-bars">
                    <span className="trend-bar in" style={{ height: `${trendMax ? (row.income / trendMax) * 100 : 0}%` }} />
                    <span className="trend-bar out" style={{ height: `${trendMax ? (row.spending / trendMax) * 100 : 0}%` }} />
                  </span>
                  <span className="trend-label">{formatMonthShort(row.monthKey)}</span>
                  <span className={`trend-net ${net < 0 ? 'negative' : ''}`}>{formatCompact(net)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="empty-state">No income or spending in {currency} yet. Peaceful.</p>
        )}
      </div>

      <div className="insight-block">
        <div className="inline-header">
          <h3>Where it went · {formatMonth(monthKey)}</h3>
          <span className="small-label">vs {formatMonth(previousMonthKey(monthKey))}</span>
        </div>
        {categoryRows.rows.length ? (
          categoryRows.rows.map((row, index) => {
            const share = categoryRows.total ? Math.round((row.amount / categoryRows.total) * 100) : 0
            const change = row.previous ? Math.round(((row.amount - row.previous) / row.previous) * 100) : null
            const content = (
              <>
                <span>{row.label}</span>
                <span className="bar-track">
                  <span
                    className={`bar-fill ${row.key === 'other' ? 'tone-other' : `tone-${index % 4}`}`}
                    style={{ width: `${categoryMax ? Math.max(4, (row.amount / categoryMax) * 100) : 0}%` }}
                  />
                </span>
                <span className="insight-values">
                  <strong>{formatMoney(row.amount, currency)}</strong>
                  <span className="small-label">{share}%</span>
                  <span className={`change-chip ${change === null ? 'new' : change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
                    {change === null ? 'new' : change > 0 ? `↑${change}%` : change < 0 ? `↓${Math.abs(change)}%` : '='}
                  </span>
                </span>
              </>
            )
            return row.key === 'other' ? (
              <button
                type="button"
                className="bar-row insight-row bar-row-button"
                key={row.key}
                title="Show the rest"
                onClick={() => setShowAllCategories(true)}
              >
                {content}
              </button>
            ) : (
              <div className="bar-row insight-row bar-row-static" key={row.key}>
                {content}
              </div>
            )
          })
        ) : (
          <p className="empty-state">No spending in {currency} this month. Suspiciously frugal.</p>
        )}
        {showAllCategories && categoryRows.canCollapse ? (
          <button type="button" className="ghost-button show-less" onClick={() => setShowAllCategories(false)}>
            Show less
          </button>
        ) : null}
      </div>
        </>
      ) : null}
    </section>
  )
}

/** Short signed number for tight spots: 12 400 → +12.4k. */
function formatCompact(amount: number) {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
  const abs = Math.abs(amount)
  const text = abs >= 1_000_000 ? `${roundMoney(abs / 1_000_000)}M` : abs >= 1000 ? `${Math.round(abs / 100) / 10}k` : `${Math.round(abs)}`
  return `${sign}${text}`
}

function BucketGroupView({
  group,
  balances,
  viewer,
  onOpenBucket,
}: {
  group: { kind: BucketKind; title: string; hint?: string }
  balances: LedgerSnapshot['balances']
  viewer: ViewerId
  onOpenBucket: (bucketId: string) => void
}) {
  const [showPartner, setShowPartner] = useState(false)
  const partner: BucketOwner | null = viewer === 'moon' ? 'alena' : viewer === 'alena' ? 'moon' : null

  const ordered = [...balances].sort(
    (a, b) =>
      ownerRank(a.bucket.ownerId, viewer) - ownerRank(b.bucket.ownerId, viewer) || a.bucket.name.localeCompare(b.bucket.name),
  )
  const primary = partner ? ordered.filter((balance) => balance.bucket.ownerId !== partner) : ordered
  const secondary = partner ? ordered.filter((balance) => balance.bucket.ownerId === partner) : []

  const renderRow = (balance: LedgerSnapshot['balances'][number]) => {
    const isMine = viewer !== 'all' && balance.bucket.ownerId === viewer
    const negative = balance.totals.some((total) => total.amount < 0)
    const hadFlow = [...balance.monthIn, ...balance.monthOut].some((item) => item.amount !== 0)
    return (
      <button
        type="button"
        className={`bucket-row ${isMine ? 'mine' : ''} ${negative ? 'warning' : ''}`}
        key={balance.bucket.id}
        title={`Show ${balance.bucket.name} history`}
        onClick={() => onOpenBucket(balance.bucket.id)}
      >
        <span className="bucket-name">
          <span className="bucket-title">
            {balance.bucket.name}
            {!isMine && balance.bucket.name.trim().toLowerCase() === ownerNames[balance.bucket.ownerId].toLowerCase() ? null : (
              <span className="owner-tag">{isMine ? 'You' : ownerNames[balance.bucket.ownerId]}</span>
            )}
          </span>
          {hadFlow ? (
            <span className="bucket-flow">
              +{formatBuckets(balance.monthIn, '0')} · −{formatBuckets(balance.monthOut, '0')}
            </span>
          ) : null}
        </span>
        <strong className="bucket-balance">{formatBuckets(balance.totals)}</strong>
      </button>
    )
  }

  return (
    <section className={`panel bucket-group ${groupTones[group.kind]}`}>
      <div className="bucket-group-header">
        <h3>{group.title}</h3>
        {group.hint ? <span className="small-label">{group.hint}</span> : null}
      </div>
      {primary.length ? (
        <div className="bucket-list">{primary.map(renderRow)}</div>
      ) : secondary.length ? null : (
        <p className="empty-state">No buckets yet. Your money is house-hunting.</p>
      )}
      {secondary.length && partner ? (
        <div className="partner-block">
          <button type="button" className="ghost-button show-more-button" onClick={() => setShowPartner((value) => !value)}>
            {showPartner ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {ownerNames[partner]}’s ({secondary.length})
          </button>
          {showPartner ? <div className="bucket-list muted-group">{secondary.map(renderRow)}</div> : null}
        </div>
      ) : null}
    </section>
  )
}

type RecordMode = 'in' | 'expense' | 'transfer'

// A phone keeps its keyboard shut until you tap a field (and our tab bar hides while one is focused);
// a mouse-and-keyboard device can start typing the amount straight away.
const FINE_POINTER =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches

/** What the Add forms start with, taken from how the family last used them. */
interface AddDefaults {
  inBucket: string
  expenseBucket: string
  transferFrom: string
  transferTo: string
  sourceChips: string[]
  categoryChips: string[]
}

function RecordMoney({
  settings,
  buckets,
  sources,
  categories,
  transactions,
  prefill,
  onSaved,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  /** Newest first. */
  transactions: Transaction[]
  prefill: { transaction: Transaction; key: number } | null
  onSaved: (transaction: Transaction) => void
}) {
  // Spending is what gets recorded most often, so it opens first.
  const [mode, setMode] = useState<RecordMode>('expense')

  useEffect(() => {
    if (!prefill) return
    const { type } = prefill.transaction
    setMode(type === 'expense' ? 'expense' : type === 'transfer' ? 'transfer' : 'in')
  }, [prefill])

  const defaults = useMemo<AddDefaults>(() => {
    const usable = (id?: string) => (id && buckets.some((bucket) => bucket.id === id) ? id : '')
    const namesOf = (ids: string[], list: Array<{ id: string; name: string; archived?: boolean }>) =>
      ids.flatMap((id) => {
        const item = list.find((entry) => entry.id === id)
        return item && !item.archived ? [item.name] : []
      })
    const moneyIn = transactions.filter((item) => item.type === 'income' || item.type === 'funding')
    const expenses = transactions.filter((item) => item.type === 'expense')
    const transfers = transactions.filter((item) => item.type === 'transfer')
    return {
      inBucket: usable(recentValues(moneyIn, (item) => item.bucketId, 1)[0]),
      expenseBucket: usable(recentValues(expenses, (item) => item.bucketId, 1)[0]),
      transferFrom: usable(recentValues(transfers, (item) => item.bucketId, 1)[0]),
      transferTo: usable(recentValues(transfers, (item) => item.toBucketId, 1)[0]),
      sourceChips: namesOf(recentValues(transactions.filter((item) => item.type === 'income'), (item) => item.sourceId, 5), sources),
      categoryChips: namesOf(recentValues(expenses, (item) => item.categoryId, 5), categories),
    }
  }, [transactions, buckets, sources, categories])

  const repeated = prefill?.transaction
  const moneyInInitial =
    repeated && (repeated.type === 'income' || repeated.type === 'funding')
      ? {
          amount: String(repeated.amount),
          currency: repeated.currency,
          bucketId: repeated.bucketId,
          sourceName: nameForSource(repeated.sourceId, sources, ''),
          note: repeated.note ?? '',
        }
      : undefined
  const expenseInitial =
    repeated && repeated.type === 'expense'
      ? {
          amount: String(repeated.amount),
          currency: repeated.currency,
          bucketId: repeated.bucketId,
          categoryName: nameForCategory(repeated.categoryId, categories, ''),
          note: repeated.note ?? '',
        }
      : undefined
  const transferInitial =
    repeated && repeated.type === 'transfer'
      ? {
          amount: String(repeated.amount),
          currency: repeated.currency,
          fromBucketId: repeated.bucketId,
          toBucketId: repeated.toBucketId ?? '',
          note: repeated.note ?? '',
        }
      : undefined

  return (
    <section className="fast-add">
      <div className="section-header">
        <div>
          <p className="eyebrow">Fast add</p>
          <h2>Record money</h2>
        </div>
        <div className="segmented-control">
          <button className={mode === 'in' ? 'active' : ''} type="button" onClick={() => setMode('in')}>
            <ArrowDownToLine size={16} />
            Money in
          </button>
          <button className={mode === 'expense' ? 'active' : ''} type="button" onClick={() => setMode('expense')}>
            <ArrowUpFromLine size={16} />
            Expense
          </button>
          <button className={mode === 'transfer' ? 'active' : ''} type="button" onClick={() => setMode('transfer')}>
            <ArrowLeftRight size={16} />
            Transfer
          </button>
        </div>
      </div>
      {mode === 'in' ? (
        <MoneyInForm
          key={prefill?.key}
          settings={settings}
          buckets={buckets}
          sources={sources}
          initial={moneyInInitial}
          defaults={defaults}
          onSaved={onSaved}
        />
      ) : null}
      {mode === 'expense' ? (
        <ExpenseForm
          key={prefill?.key}
          settings={settings}
          buckets={buckets}
          categories={categories}
          initial={expenseInitial}
          defaults={defaults}
          onSaved={onSaved}
        />
      ) : null}
      {mode === 'transfer' ? (
        <TransferForm key={prefill?.key} settings={settings} buckets={buckets} initial={transferInitial} defaults={defaults} onSaved={onSaved} />
      ) : null}
    </section>
  )
}

function BucketSelect({
  label,
  buckets,
  value,
  onChange,
}: {
  label: string
  buckets: Bucket[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose bucket</option>
        {bucketGroups.map((group) => {
          const groupBuckets = buckets.filter((bucket) => bucket.kind === group.kind)
          if (!groupBuckets.length) return null
          return (
            <optgroup label={group.title} key={group.kind}>
              {groupBuckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.name}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}

function MoneyInForm({
  settings,
  buckets,
  sources,
  initial,
  defaults,
  onSaved,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  initial?: { amount: string; currency: string; bucketId: string; sourceName: string; note: string }
  defaults: AddDefaults
  onSaved: (transaction: Transaction) => void
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [bucketId, setBucketId] = useState(initial?.bucketId ?? defaults.inBucket)
  const [sourceName, setSourceName] = useState(initial?.sourceName ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  // Frozen for this visit, so the chips don't shuffle under your thumb after every save.
  const [sourceChips] = useState(defaults.sourceChips)

  const selectedBucket = buckets.find((bucket) => bucket.id === bucketId)
  const isFunding = selectedBucket?.kind === 'business'

  return (
    <form
      className="entry-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        const parsed = parseAmount(amount)
        if (!bucketId) return setError('Choose which bucket the money goes into.')
        if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter a positive amount.')
        const input = { date, amount: parsed, currency, bucketId, sourceName, note, realmId: settings.realmId }
        try {
          const saved = await (isFunding ? saveFunding(input) : saveIncome(input))
          setAmount('')
          setNote('')
          onSaved(saved)
          if (FINE_POINTER) amountRef.current?.focus()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} inputRef={amountRef} />
      <div className="form-grid">
        <BucketSelect label="Into bucket" buckets={buckets} value={bucketId} onChange={setBucketId} />
        {!isFunding ? (
          <SuggestField
            label="Source"
            listId="income-sources"
            value={sourceName}
            onChange={setSourceName}
            names={sources.filter((source) => !source.archived).map((source) => source.name)}
            placeholder="e.g. Teaching, Salary"
            chips={sourceChips}
          />
        ) : null}
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {isFunding ? (
        <p className="quiet-line">This is business funding — earmarked for business expenses and kept out of income reports.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" className="primary-button">
        <ArrowDownToLine size={18} />
        {isFunding ? 'Save funding' : 'Save income'}
      </button>
    </form>
  )
}

function ExpenseForm({
  settings,
  buckets,
  categories,
  initial,
  defaults,
  onSaved,
}: {
  settings: AppSettings
  buckets: Bucket[]
  categories: Category[]
  initial?: { amount: string; currency: string; bucketId: string; categoryName: string; note: string }
  defaults: AddDefaults
  onSaved: (transaction: Transaction) => void
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [bucketId, setBucketId] = useState(initial?.bucketId ?? defaults.expenseBucket)
  const [categoryName, setCategoryName] = useState(initial?.categoryName ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  // Frozen for this visit, so the chips don't shuffle under your thumb after every save.
  const [categoryChips] = useState(defaults.categoryChips)

  return (
    <form
      className="entry-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        const parsed = parseAmount(amount)
        if (!bucketId) return setError('Choose which bucket pays for this.')
        if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter a positive amount.')
        try {
          const saved = await saveExpense({ date, amount: parsed, currency, bucketId, categoryName, note, realmId: settings.realmId })
          setAmount('')
          setNote('')
          onSaved(saved)
          if (FINE_POINTER) amountRef.current?.focus()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} inputRef={amountRef} />
      <div className="form-grid">
        <BucketSelect label="Paid from" buckets={buckets} value={bucketId} onChange={setBucketId} />
        <SuggestField
          label="Category"
          listId="expense-categories"
          value={categoryName}
          onChange={setCategoryName}
          names={categories.filter((category) => !category.archived).map((category) => category.name)}
          placeholder="e.g. Groceries"
          chips={categoryChips}
        />
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" className="primary-button">
        <HandCoins size={18} />
        Save expense
      </button>
    </form>
  )
}

function TransferForm({
  settings,
  buckets,
  initial,
  defaults,
  onSaved,
}: {
  settings: AppSettings
  buckets: Bucket[]
  initial?: { amount: string; currency: string; fromBucketId: string; toBucketId: string; note: string }
  defaults: AddDefaults
  onSaved: (transaction: Transaction) => void
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [fromBucketId, setFromBucketId] = useState(initial?.fromBucketId ?? defaults.transferFrom)
  const [toBucketId, setToBucketId] = useState(initial?.toBucketId ?? defaults.transferTo)
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)

  return (
    <form
      className="entry-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        const parsed = parseAmount(amount)
        if (!fromBucketId || !toBucketId) return setError('Choose both buckets.')
        if (fromBucketId === toBucketId) return setError('Choose two different buckets.')
        if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter a positive amount.')
        try {
          const saved = await saveTransfer({ date, amount: parsed, currency, fromBucketId, toBucketId, note, realmId: settings.realmId })
          setAmount('')
          setNote('')
          onSaved(saved)
          if (FINE_POINTER) amountRef.current?.focus()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} inputRef={amountRef} />
      <div className="form-grid">
        <BucketSelect label="From" buckets={buckets} value={fromBucketId} onChange={setFromBucketId} />
        <BucketSelect label="To" buckets={buckets} value={toBucketId} onChange={setToBucketId} />
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" className="primary-button">
        <ArrowLeftRight size={18} />
        Save transfer
      </button>
    </form>
  )
}

function AmountCurrencyRow({
  amount,
  setAmount,
  currency,
  setCurrency,
  inputRef,
}: {
  amount: string
  setAmount: (value: string) => void
  currency: string
  setCurrency: (value: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="amount-row">
      <label className="amount-field">
        Amount
        <input
          ref={inputRef}
          autoFocus={FINE_POINTER}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0"
        />
      </label>
      <label className="currency-field">
        Currency
        <input
          list="common-currencies"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
        <datalist id="common-currencies">
          {COMMON_CURRENCIES.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
      </label>
    </div>
  )
}

function SuggestField({
  label,
  listId,
  value,
  onChange,
  names,
  placeholder,
  chips,
}: {
  label: string
  listId: string
  value: string
  onChange: (value: string) => void
  names: string[]
  placeholder?: string
  /** Recently used names, offered as one-tap choices under the field. */
  chips?: string[]
}) {
  const field = (
    <label>
      {label}
      <input list={listId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <datalist id={listId}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </label>
  )
  if (!chips?.length) return field
  return (
    <div className="suggest-field">
      {field}
      <div className="choice-chips" role="group" aria-label={`Recent ${label.toLowerCase()} choices`}>
        {chips.map((name) => {
          const picked = name.trim().toLowerCase() === value.trim().toLowerCase()
          return (
            <button key={name} type="button" className={picked ? 'active' : ''} aria-pressed={picked} onClick={() => onChange(name)}>
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ManagementPanel({
  settings,
  buckets,
  sources,
  categories,
  ledger,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  ledger: LedgerSnapshot
}) {
  return (
    <div className="setup-stack">
      <div className="section-header compact">
        <h2>Setup</h2>
        <Settings size={20} />
      </div>
      <BackupPanel settings={settings} />
      <BucketManager settings={settings} buckets={buckets} ledger={ledger} />
      <SourceManager settings={settings} sources={sources} />
      <CategoryManager settings={settings} categories={categories} />
      <CurrencySettings settings={settings} />
      <RecoveryPanel settings={settings} buckets={buckets} sources={sources} categories={categories} />
    </div>
  )
}

/** One Setup card that folds away, so a long list never pushes the other cards off the screen. */
function SetupSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className="panel setup-section" open={defaultOpen}>
      <summary>
        <span className="setup-section-title">
          <h3>{title}</h3>
          {summary ? <span className="small-label">{summary}</span> : null}
        </span>
        <ChevronDown size={20} className="setup-chevron" />
      </summary>
      <div className="setup-section-body">{children}</div>
    </details>
  )
}

/** In-app replacement for window.confirm: same look as the other dialogs, Esc or a tap outside cancels. */
function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string
  detail?: string
  confirmLabel: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Portalled so no card's blur or transform can trap the fixed backdrop inside it.
  return createPortal(
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {detail ? <p className="quiet-line">{detail}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'danger-button' : 'primary-button'}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const RECOVERY_PAGE_SIZE = 10

function RecoveryPanel({
  settings,
  buckets,
  sources,
  categories,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
}) {
  const deleted = useLiveQuery(() => listDeletedTransactions(settings.realmId), [settings.realmId], [] as RecoveryEntry[])
  const [visibleCount, setVisibleCount] = useState(RECOVERY_PAGE_SIZE)
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')

  const restore = async (entry: RecoveryEntry) => {
    setBusyKey(entry.key)
    setMessage('')
    try {
      await restoreDeleted(entry)
      setMessage(`Restored ${signedAmount(entry.data as Transaction)}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyKey('')
    }
  }

  return (
    <SetupSection title="Recently deleted" summary={deleted?.length ? `${deleted.length} can be restored` : 'Nothing deleted'}>
      <div className="manager-block">
        <p className="small-label">
          This device keeps a copy of every entry it has seen. Deleted entries, whether deleted here or on the other device, stay here for{' '}
          {RECOVERY_KEEP_DAYS} days.
        </p>
        {deleted?.length ? (
          <div className="transaction-list">
            {deleted.slice(0, visibleCount).map((entry) => {
              const transaction = entry.data as Transaction
              return (
                <article className="transaction-row" key={entry.key}>
                  <div className="transaction-main">
                    <span className={`type-chip ${transaction.type}`}>{transactionLabels[transaction.type]}</span>
                    <strong>{signedAmount(transaction)}</strong>
                    <span>{formatShortDate(transaction.date)}</span>
                  </div>
                  <div className="transaction-meta">
                    <span>{bucketLine(transaction, buckets)}</span>
                    {transaction.type === 'income' ? <span>{nameForSource(transaction.sourceId, sources)}</span> : null}
                    {transaction.type === 'expense' ? <span>{nameForCategory(transaction.categoryId, categories)}</span> : null}
                    {transaction.note ? <span>{transaction.note}</span> : null}
                    <span>· deleted ~{formatShortDate(isoToMoscowDate(entry.missingSince ?? ''))}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="ghost-button" onClick={() => restore(entry)} disabled={busyKey === entry.key}>
                      <RotateCcw size={16} />
                      Restore
                    </button>
                  </div>
                </article>
              )
            })}
            {visibleCount < deleted.length ? (
              <button type="button" className="ghost-button show-more-button" onClick={() => setVisibleCount((count) => count + RECOVERY_PAGE_SIZE)}>
                Show {Math.min(RECOVERY_PAGE_SIZE, deleted.length - visibleCount)} more
              </button>
            ) : null}
          </div>
        ) : (
          <p className="empty-state">Nothing deleted. Squeaky clean.</p>
        )}
        {message ? <p className="small-label">{message}</p> : null}
      </div>
    </SetupSection>
  )
}

function BackupPanel({ settings }: { settings: AppSettings }) {
  const [message, setMessage] = useState('')
  const [lastBackupAt, setLastBackupAt] = useState(readLastBackupAt)
  const [pendingMerge, setPendingMerge] = useState<{ backup: ReturnType<typeof parseBackup>; summary: string } | null>(null)
  const age = daysSince(lastBackupAt)
  const due = age === null || age >= BACKUP_REMIND_DAYS

  return (
    <SetupSection
      title="Backup"
      defaultOpen
      summary={age === null ? 'No backup downloaded yet' : age === 0 ? 'Last backup: today' : `Last backup: ${age} day${age === 1 ? '' : 's'} ago`}
    >
      <div className="manager-block">
        <p className={`small-label ${due ? 'backup-due' : ''}`}>
          {lastBackupAt
            ? `Last downloaded on this device: ${formatShortDate(isoToMoscowDate(lastBackupAt))} (${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}).`
            : 'No backup downloaded on this device yet.'}{' '}
          Keep a file somewhere outside the app (e.g. email it to yourself) about once a month.
        </p>
        <div className="row-actions backup-actions">
          <button
            type="button"
            onClick={async () => {
              setMessage('')
              const backup = await exportBackup(settings.realmId)
              const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = backupFileName()
              link.click()
              URL.revokeObjectURL(url)
              setLastBackupAt(markBackupDownloaded())
              setMessage(`Saved ${backup.transactions.length} transactions to ${link.download}.`)
            }}
          >
            Download backup
          </button>
          <label className="file-button">
            Merge backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setMessage('')
                try {
                  const backup = parseBackup(await file.text())
                  const summary = `${backup.transactions.length} transactions, ${backup.buckets.length} buckets (saved ${formatShortDate(backup.exportedAt.slice(0, 10))})`
                  setPendingMerge({ backup, summary })
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : String(error))
                }
              }}
            />
          </label>
        </div>
        {message ? <p className="small-label">{message}</p> : null}
        <p className="small-label">
          The backup contains this family space. Merging is additive: it never clears the app and never overwrites an existing ID.
        </p>
      </div>
      {pendingMerge ? (
        <ConfirmDialog
          title="Add the missing records?"
          detail={`${pendingMerge.summary}. Existing records will not be changed or deleted.`}
          confirmLabel="Merge"
          tone="primary"
          onCancel={() => setPendingMerge(null)}
          onConfirm={async () => {
            const { backup } = pendingMerge
            setPendingMerge(null)
            try {
              const result = await mergeBackup(backup, settings.realmId)
              const totalAdded = Object.values(result.added).reduce((sum, count) => sum + count, 0)
              setMessage(
                `Merged ${totalAdded} missing records (${result.added.transactions} transactions); kept ${result.skippedExisting} existing records unchanged.`,
              )
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </SetupSection>
  )
}

function CurrencySettings({ settings }: { settings: AppSettings }) {
  const [currency, setCurrency] = useState(settings.defaultCurrency)
  const [saved, setSaved] = useState(false)

  return (
    <SetupSection title="Currency" summary={`Default: ${settings.defaultCurrency}`}>
      <form
        className="mini-form"
        onSubmit={async (event) => {
          event.preventDefault()
          await updateDefaultCurrency(settings, currency)
          setSaved(true)
        }}
      >
        <label>
          Default currency
          <input
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value.toUpperCase())
              setSaved(false)
            }}
          />
        </label>
        <button type="submit">Save</button>
        {saved ? <span className="small-label">Saved.</span> : null}
      </form>
    </SetupSection>
  )
}

function BucketManager({ settings, buckets, ledger }: { settings: AppSettings; buckets: Bucket[]; ledger: LedgerSnapshot }) {
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState<BucketOwner>('shared')
  const [kind, setKind] = useState<BucketKind>('spending')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Bucket | null>(null)
  const [message, setMessage] = useState('')

  const archivedCount = buckets.filter((bucket) => bucket.archived).length

  return (
    <SetupSection title="Buckets" summary={`${buckets.length - archivedCount} active${archivedCount ? `, ${archivedCount} archived` : ''}`}>
      <div className="manager-block">
        <form
          className="mini-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!name.trim()) return
            await addBucket(name, ownerId, kind, settings.realmId)
            setName('')
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New bucket name" aria-label="New bucket name" />
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value as BucketOwner)} aria-label="Owner">
            <option value="shared">Shared</option>
            <option value="moon">Moon</option>
            <option value="alena">Alena</option>
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as BucketKind)} aria-label="Kind">
            <option value="spending">Spending</option>
            <option value="business">Business</option>
            <option value="savings">Savings</option>
          </select>
          <button type="submit">Add</button>
        </form>
        <ul className="compact-list bucket-manage-list">
          {buckets.map((bucket) => (
            <BucketRow
              key={bucket.id}
              bucket={bucket}
              totals={ledger.balances.find((balance) => balance.bucket.id === bucket.id)?.totals ?? []}
              open={openId === bucket.id}
              onToggle={() => {
                setMessage('')
                setOpenId(openId === bucket.id ? null : bucket.id)
              }}
              onDelete={() => setPendingDelete(bucket)}
            />
          ))}
        </ul>
        {message ? <p className="form-error">{message}</p> : null}
        <FixBalanceForm settings={settings} buckets={buckets.filter((bucket) => !bucket.archived)} ledger={ledger} />
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          detail="Only an unused bucket can be deleted. If it has any history, archive it instead."
          confirmLabel="Delete bucket"
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const target = pendingDelete
            setPendingDelete(null)
            try {
              await deleteBucket(target.id)
              setOpenId(null)
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </SetupSection>
  )
}

function BucketRow({
  bucket,
  totals,
  open,
  onToggle,
  onDelete,
}: {
  bucket: Bucket
  totals: MoneyBucket[]
  open: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(bucket.name)
  const [error, setError] = useState('')

  return (
    <li className={`bucket-manage ${bucket.archived ? 'is-archived' : ''}`}>
      <button type="button" className="bucket-manage-main" aria-expanded={open} onClick={onToggle}>
        <span className="bucket-manage-name">
          <strong>{bucket.name}</strong>
          <span className="small-label">
            {ownerNames[bucket.ownerId]} · {bucket.kind}
            {bucket.archived ? ' · archived' : ''}
          </span>
        </span>
        <span className="bucket-manage-balance">{formatBuckets(totals)}</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open ? (
        <form
          className="manage-editor"
          onSubmit={async (event) => {
            event.preventDefault()
            setError('')
            try {
              await renameBucket(bucket.id, draft)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }}
        >
          <label>
            Rename
            <input value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <div className="manage-editor-actions">
            <button type="submit" className="primary-button" disabled={!draft.trim() || draft.trim() === bucket.name}>
              <Pencil size={16} />
              Save name
            </button>
            <button type="button" className="ghost-button" onClick={() => setBucketArchived(bucket.id, !bucket.archived)}>
              {bucket.archived ? 'Restore' : 'Archive'}
            </button>
            <button type="button" className="ghost-button delete-link" onClick={onDelete}>
              <Trash2 size={16} />
              Delete…
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </form>
      ) : null}
    </li>
  )
}

function FixBalanceForm({ settings, buckets, ledger }: { settings: AppSettings; buckets: Bucket[]; ledger: LedgerSnapshot }) {
  const [bucketId, setBucketId] = useState('')
  const [currency, setCurrency] = useState(settings.defaultCurrency)
  const [balance, setBalance] = useState('')
  const [message, setMessage] = useState('')

  const current =
    ledger.balances.find((item) => item.bucket.id === bucketId)?.totals.find((total) => total.currency === currency.trim().toUpperCase())
      ?.amount ?? 0

  return (
    <form
      className="mini-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setMessage('')
        const parsed = parseAmount(balance)
        if (!bucketId) return
        if (!balance.trim() || !Number.isFinite(parsed)) return setMessage('Enter the real balance first.')
        const delta = roundMoney(parsed - current)
        if (delta === 0) return setMessage('Balance already matches.')
        await saveAdjustment({
          date: todayInputDate(),
          delta,
          currency,
          bucketId,
          note: 'Balance correction',
          realmId: settings.realmId,
        })
        setBalance('')
        setMessage('Balance corrected.')
      }}
    >
      <select value={bucketId} onChange={(event) => setBucketId(event.target.value)}>
        <option value="">Fix balance…</option>
        {buckets.map((bucket) => (
          <option key={bucket.id} value={bucket.id}>
            {bucket.name}
          </option>
        ))}
      </select>
      <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
      <input inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="Real balance" />
      <button type="submit">Correct</button>
      {message ? <span className="small-label">{message}</span> : null}
    </form>
  )
}

function SourceManager({ settings, sources }: { settings: AppSettings; sources: IncomeSource[] }) {
  return (
    <ManagedNameList
      title="Income sources"
      hint="Tap a name to rename, archive or delete it. New sources are also created automatically when you type them on the income form."
      items={sources}
      onAdd={(name) => addSource(name, settings.realmId)}
      onRename={(id, name) => renameSource(id, name)}
      onToggle={(id, archived) => setSourceArchived(id, archived)}
      onDelete={(id) => deleteSource(id)}
    />
  )
}

function CategoryManager({ settings, categories }: { settings: AppSettings; categories: Category[] }) {
  return (
    <ManagedNameList
      title="Expense categories"
      hint="Tap a name to rename, archive or delete it. New categories are also created automatically when you type them on the expense form."
      items={categories}
      onAdd={(name) => addCategory(name, settings.realmId)}
      onRename={(id, name) => renameCategory(id, name)}
      onToggle={(id, archived) => setCategoryArchived(id, archived)}
      onDelete={(id) => deleteCategory(id)}
    />
  )
}

function ManagedNameList({
  title,
  hint,
  items,
  onAdd,
  onRename,
  onToggle,
  onDelete,
}: {
  title: string
  hint: string
  items: Array<{ id: string; name: string; archived?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onRename: (id: string, name: string) => Promise<unknown>
  onToggle: (id: string, archived: boolean) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)

  const matches = (item: { name: string }) => item.name.toLowerCase().includes(query.trim().toLowerCase())
  const active = items.filter((item) => !item.archived && matches(item))
  const archived = items.filter((item) => item.archived && matches(item))
  const archivedTotal = items.filter((item) => item.archived).length
  const editing = items.find((item) => item.id === editingId)

  const pick = (item: { id: string; name: string }) => {
    setEditError('')
    setDraft(item.name)
    setEditingId(editingId === item.id ? null : item.id)
  }

  const pill = (item: { id: string; name: string; archived?: boolean }) => (
    <span key={item.id} className={`pill-item ${item.archived ? 'is-archived' : ''} ${editingId === item.id ? 'is-editing' : ''}`}>
      <button type="button" className="pill-name" aria-pressed={editingId === item.id} onClick={() => pick(item)}>
        {item.name}
      </button>
    </span>
  )

  const editor = editing ? (
    <form
      className="manage-editor"
      onSubmit={async (event) => {
        event.preventDefault()
        setEditError('')
        try {
          await onRename(editing.id, draft)
          setEditingId(null)
        } catch (error) {
          setEditError(error instanceof Error ? error.message : String(error))
        }
      }}
    >
      <label>
        Rename
        <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
      </label>
      <div className="manage-editor-actions">
        <button type="submit" className="primary-button" disabled={!draft.trim() || draft.trim() === editing.name}>
          <Pencil size={16} />
          Save name
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={async () => {
            await onToggle(editing.id, !editing.archived)
            setEditingId(null)
          }}
        >
          {editing.archived ? 'Restore' : 'Archive'}
        </button>
        <button type="button" className="ghost-button delete-link" onClick={() => setPendingDelete(editing)}>
          <Trash2 size={16} />
          Delete…
        </button>
        <button type="button" className="ghost-button" onClick={() => setEditingId(null)}>
          Close
        </button>
      </div>
      {editError ? <p className="form-error">{editError}</p> : null}
    </form>
  ) : null

  return (
    <SetupSection title={title} summary={`${items.length - archivedTotal} active${archivedTotal ? `, ${archivedTotal} archived` : ''}`}>
      <div className="manager-block">
        <form
          className="mini-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!name.trim()) return
            await onAdd(name)
            setName('')
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New name" aria-label={`New ${title.toLowerCase()} name`} />
          <button type="submit">Add</button>
        </form>
        {items.length > 6 ? (
          <div className="search-field">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} />
          </div>
        ) : null}
        {active.length ? (
          <div className="pill-list">{active.map(pill)}</div>
        ) : (
          <p className="empty-state">{query ? 'No matches. Even the search is confused.' : 'Empty. Nothing to see here.'}</p>
        )}
        {editing && !editing.archived ? editor : null}
        {archivedTotal ? (
          <>
            <button type="button" className="ghost-button show-more-button" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archivedTotal})
            </button>
            {showArchived ? archived.length ? <div className="pill-list">{archived.map(pill)}</div> : <p className="empty-state">No matches.</p> : null}
            {editing?.archived ? editor : null}
          </>
        ) : null}
        <p className="small-label">{hint}</p>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          detail="Only an unused name can be deleted. If it has history, archive it instead."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const target = pendingDelete
            setPendingDelete(null)
            try {
              await onDelete(target.id)
              setEditingId(null)
            } catch (error) {
              setEditError(error instanceof Error ? error.message : String(error))
            }
          }}
        />
      ) : null}
    </SetupSection>
  )
}

function FiltersPanel({
  filters,
  setFilters,
  buckets,
  sources,
  categories,
}: {
  filters: Filters
  setFilters: (filters: Filters) => void
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
}) {
  const [open, setOpen] = useState(() => readFlag('financeFiltersOpen', false))
  const activeCount = countActiveFilters(filters)
  const chips = activeFilterChips(filters, buckets, sources, categories)
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    writeFlag('financeFiltersOpen', next)
  }

  return (
    <section className="panel filters-panel">
      <div className="search-field search-main">
        <Search size={16} />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          aria-label="Search entries"
          placeholder="Search notes, buckets, amounts…"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
        />
        {filters.query ? (
          <button type="button" className="icon-button subtle" aria-label="Clear search" onClick={() => setFilters({ ...filters, query: '' })}>
            <X size={16} />
          </button>
        ) : null}
      </div>
      {chips.length ? (
        <div className="filter-chips" role="group" aria-label="Active filters">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="filter-chip" aria-label={`Remove filter ${chip.label}`} onClick={() => setFilters(chip.without)}>
              {chip.label}
              <X size={13} />
            </button>
          ))}
          {chips.length > 1 || filters.query ? (
            <button type="button" className="filter-chip clear-all" onClick={() => setFilters(emptyFilters)}>
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="section-header compact history-toggle filters-toggle" aria-expanded={open} onClick={toggleOpen}>
        <h2>
          Filters {activeCount ? <span className="small-label">({activeCount} active)</span> : null}
        </h2>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open ? (
      <div className="filter-grid">
        <MultiSelectFilter
          label="Bucket"
          options={buckets.map((bucket) => ({ value: bucket.id, label: bucket.name }))}
          selected={filters.bucketIds}
          onChange={(bucketIds) => setFilters({ ...filters, bucketIds })}
        />
        <MultiSelectFilter
          label="Type"
          options={Object.entries(transactionLabels).map(([value, label]) => ({ value, label }))}
          selected={filters.types}
          onChange={(types) => setFilters({ ...filters, types: types as TransactionType[] })}
        />
        <MultiSelectFilter
          label="Source"
          options={sources.map((source) => ({ value: source.id, label: source.name }))}
          selected={filters.sourceIds}
          onChange={(sourceIds) => setFilters({ ...filters, sourceIds })}
        />
        <MultiSelectFilter
          label="Category"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
          selected={filters.categoryIds}
          onChange={(categoryIds) => setFilters({ ...filters, categoryIds })}
        />
        <label>
          From
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <button type="button" onClick={() => setFilters(emptyFilters)}>
          Reset
        </button>
      </div>
      ) : null}
    </section>
  )
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? 'All')
        : `${selected.length} selected`

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  return (
    <div className="multi-select" ref={containerRef}>
      <span className="multi-select-label">{label}</span>
      <button type="button" className="multi-select-trigger" onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? (
        <div className="multi-select-menu">
          <label className="multi-select-option">
            <span className="multi-select-checkbox" data-checked={selected.length === 0}>
              {selected.length === 0 ? <Check size={14} /> : null}
            </span>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            All
          </label>
          {options.map((option) => {
            const checked = selected.includes(option.value)
            return (
              <label className="multi-select-option" key={option.value}>
                <span className="multi-select-checkbox" data-checked={checked}>
                  {checked ? <Check size={14} /> : null}
                </span>
                <input type="checkbox" checked={checked} onChange={() => toggleValue(option.value)} />
                {option.label}
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function countActiveFilters(filters: Filters) {
  let count = 0
  if (filters.bucketIds.length) count += 1
  if (filters.types.length) count += 1
  if (filters.sourceIds.length) count += 1
  if (filters.categoryIds.length) count += 1
  if (filters.from) count += 1
  if (filters.to) count += 1
  return count
}

/** One removable chip per active filter, so a filter set from Home (or anywhere) is always visible and one tap to drop. */
function activeFilterChips(filters: Filters, buckets: Bucket[], sources: IncomeSource[], categories: Category[]) {
  const chips: Array<{ key: string; label: string; without: Filters }> = []
  for (const id of filters.bucketIds) {
    chips.push({ key: `bucket-${id}`, label: nameForBucket(id, buckets), without: { ...filters, bucketIds: filters.bucketIds.filter((item) => item !== id) } })
  }
  for (const type of filters.types) {
    chips.push({ key: `type-${type}`, label: transactionLabels[type], without: { ...filters, types: filters.types.filter((item) => item !== type) } })
  }
  for (const id of filters.sourceIds) {
    chips.push({ key: `source-${id}`, label: nameForSource(id, sources, 'Unknown source'), without: { ...filters, sourceIds: filters.sourceIds.filter((item) => item !== id) } })
  }
  for (const id of filters.categoryIds) {
    chips.push({ key: `category-${id}`, label: nameForCategory(id, categories, 'Unknown category'), without: { ...filters, categoryIds: filters.categoryIds.filter((item) => item !== id) } })
  }
  if (filters.from) chips.push({ key: 'from', label: `From ${formatShortDate(filters.from)}`, without: { ...filters, from: '' } })
  if (filters.to) chips.push({ key: 'to', label: `Until ${formatShortDate(filters.to)}`, without: { ...filters, to: '' } })
  return chips
}

/** A remembered open/closed switch. Storage can be blocked, so it only ever fills in a default. */
function readFlag(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Remembering it is a convenience only.
  }
}

function Charts({
  transactions,
  buckets,
  sources,
  categories,
  filters,
  setFilters,
}: {
  transactions: Transaction[]
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  filters: Filters
  setFilters: (filters: Filters) => void
}) {
  // Closed by default: the list is what people come for, and the charts used to sit at the bottom of it.
  const [open, setOpen] = useState(() => readFlag('financeChartsOpen', false))
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    writeFlag('financeChartsOpen', next)
  }
  const incomes = transactions.filter((transaction) => transaction.type === 'income')
  const expenses = transactions.filter((transaction) => transaction.type === 'expense')
  const incomeRows = sumRows(incomes, (transaction) => transaction.sourceId ?? '', (id) => nameForSource(id || undefined, sources))
  const categoryRows = sumRows(expenses, (transaction) => transaction.categoryId ?? '', (id) => nameForCategory(id || undefined, categories))
  const bucketRows = sumRows(expenses, (transaction) => transaction.bucketId, (id) => nameForBucket(id, buckets))

  // Tapping a row narrows History to it; tapping the only selected row again clears it.
  const toggle = (field: 'sourceIds' | 'categoryIds' | 'bucketIds') => (id: string) =>
    setFilters({ ...filters, [field]: filters[field].length === 1 && filters[field][0] === id ? [] : [id] })

  return (
    <section className="panel charts-panel">
      <button type="button" className="section-header compact history-toggle" aria-expanded={open} onClick={toggleOpen}>
        <h2>
          <LineChart size={18} />
          Breakdowns
        </h2>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open ? (
        <>
          <p className="small-label">Of the entries listed below · tap a row to filter</p>
          <ChartBlock title="Income by source" rows={incomeRows} selected={filters.sourceIds} onPick={toggle('sourceIds')} />
          <ChartBlock title="Spending by category" rows={categoryRows} selected={filters.categoryIds} onPick={toggle('categoryIds')} />
          <ChartBlock title="Spending by bucket" rows={bucketRows} selected={filters.bucketIds} onPick={toggle('bucketIds')} />
        </>
      ) : null}
    </section>
  )
}

const CHART_TOP_ROWS = 6

type ChartRow = { id: string; label: string; amount: number; currency: string }

function ChartBlock({
  title,
  rows,
  selected,
  onPick,
}: {
  title: string
  rows: ChartRow[]
  selected: string[]
  onPick: (id: string) => void
}) {
  const currencies = [...new Set(rows.map((row) => row.currency))]
  const [showAll, setShowAll] = useState(false)
  return (
    <div className="chart-block">
      <h3>{title}</h3>
      {rows.length ? (
        currencies.map((currency) => {
          const inCurrency = rows.filter((row) => row.currency === currency)
          const total = roundMoney(inCurrency.reduce((sum, row) => sum + row.amount, 0))
          const rest = inCurrency.slice(CHART_TOP_ROWS)
          const restTotal = roundMoney(rest.reduce((sum, row) => sum + row.amount, 0))
          const visible = showAll ? inCurrency : inCurrency.slice(0, CHART_TOP_ROWS)
          const max = Math.max(...visible.map((row) => row.amount), showAll ? 0 : restTotal, 0)
          const share = (amount: number) => (total ? `${Math.round((amount / total) * 100)}%` : '')
          return (
            <div className="chart-currency" key={currency}>
              {currencies.length > 1 ? (
                <p className="small-label">
                  {currency} · total {formatMoney(total, currency)}
                </p>
              ) : null}
              {visible.map((row, index) => {
                const content = (
                  <>
                    <span>{row.label}</span>
                    <span className="bar-track">
                      <span className={`bar-fill tone-${index % 4}`} style={{ width: `${max ? Math.max(6, (row.amount / max) * 100) : 0}%` }} />
                    </span>
                    <span className="insight-values">
                      <strong>{formatMoney(row.amount, row.currency)}</strong>
                      <span className="small-label">{share(row.amount)}</span>
                    </span>
                  </>
                )
                // "No source" / "Uncategorized" have no id to filter by.
                return row.id ? (
                  <button
                    type="button"
                    className={`bar-row bar-row-button ${selected.includes(row.id) ? 'selected' : ''}`}
                    key={`${row.id}-${row.currency}`}
                    onClick={() => onPick(row.id)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="bar-row bar-row-static" key={`none-${row.currency}`}>
                    {content}
                  </div>
                )
              })}
              {rest.length && !showAll ? (
                <button type="button" className="bar-row bar-row-button" title="Show the rest" onClick={() => setShowAll(true)}>
                  <span>Other ({rest.length}) ▸</span>
                  <span className="bar-track">
                    <span className="bar-fill tone-other" style={{ width: `${max ? Math.max(6, (restTotal / max) * 100) : 0}%` }} />
                  </span>
                  <span className="insight-values">
                    <strong>{formatMoney(restTotal, currency)}</strong>
                    <span className="small-label">{share(restTotal)}</span>
                  </span>
                </button>
              ) : null}
              {rest.length && showAll ? (
                <button type="button" className="ghost-button show-less" onClick={() => setShowAll(false)}>
                  Show less
                </button>
              ) : null}
              {currencies.length === 1 ? <p className="small-label">Total {formatMoney(total, currency)}</p> : null}
            </div>
          )
        })
      ) : (
        <p className="empty-state">No data.</p>
      )}
    </div>
  )
}

const HISTORY_PAGE_SIZE = 15

function History({
  transactions,
  total,
  buckets,
  sources,
  categories,
  onEdit,
  onRepeat,
}: {
  transactions: Transaction[]
  /** Entries before any filter or search, so the count can read "12 of 481". */
  total: number
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  onEdit: (transaction: Transaction) => void
  onRepeat: (transaction: Transaction) => void
}) {
  const [open, setOpen] = useState(() => readFlag('financeHistoryOpen', true))
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [transactions])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    writeFlag('financeHistoryOpen', next)
  }

  return (
    <section className="history panel">
      <button type="button" className="section-header compact history-toggle" onClick={toggleOpen}>
        <h2>
          History <span className="small-label">({transactions.length === total ? total : `${transactions.length} of ${total}`})</span>
        </h2>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open && transactions.length ? (
        <div className="transaction-list">
          {transactions.slice(0, visibleCount).map((transaction, index, visible) => (
            <Fragment key={transaction.id}>
            {index === 0 || visible[index - 1].date !== transaction.date ? (
              <h3 className="day-header">{formatDayHeader(transaction.date)}</h3>
            ) : null}
            <article
              className="transaction-row"
              onClick={(event) => {
                // Tapping anywhere on the row opens it; the buttons keep their own jobs.
                if (!(event.target as HTMLElement).closest('button')) onEdit(transaction)
              }}
            >
              <div className="transaction-main">
                <span className={`type-chip ${transaction.type}`}>{transactionLabels[transaction.type]}</span>
                <strong className={`amount-${amountDirection(transaction)}`}>{signedAmount(transaction)}</strong>
              </div>
              <div className="transaction-meta">
                <span>{bucketLine(transaction, buckets)}</span>
                {transaction.type === 'income' ? <span>{nameForSource(transaction.sourceId, sources)}</span> : null}
                {transaction.type === 'expense' ? <span>{nameForCategory(transaction.categoryId, categories)}</span> : null}
                {transaction.note ? <span>{transaction.note}</span> : null}
              </div>
              <div className="row-actions">
                {transaction.type !== 'adjustment' ? (
                  <button
                    type="button"
                    className="icon-button subtle"
                    aria-label="Repeat transaction"
                    title="Fill the form with this again, dated today"
                    onClick={() => onRepeat(transaction)}
                  >
                    <Repeat size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label="Edit transaction"
                  title="Edit or delete"
                  onClick={() => onEdit(transaction)}
                >
                  <Edit3 size={16} />
                </button>
              </div>
            </article>
            </Fragment>
          ))}
          {visibleCount < transactions.length ? (
            <button type="button" className="ghost-button show-more-button" onClick={() => setVisibleCount((count) => count + HISTORY_PAGE_SIZE)}>
              Show {Math.min(HISTORY_PAGE_SIZE, transactions.length - visibleCount)} more
            </button>
          ) : null}
        </div>
      ) : open ? (
        <p className="empty-state">{total ? quip(NO_SEARCH_MATCH, String(total)) : 'No transactions. The wallet is on holiday.'}</p>
      ) : null}
    </section>
  )
}

function fillMessageParams(message: string, params: Record<string, string>) {
  return message.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match)
}

/** Renders whatever Dexie Cloud is asking for right now (email, OTP code, logout confirmation…). */
function UserInteractionDialog({ interaction }: { interaction?: DXCUserInteraction }) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    setValues({})
  }, [interaction])

  if (!interaction) return null

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          interaction.onSubmit(values)
        }}
      >
        <h2>{interaction.title}</h2>
        {interaction.alerts.map((alert, index) => (
          <p className="form-error" key={index}>
            {fillMessageParams(alert.message, alert.messageParams)}
          </p>
        ))}
        <div className="form-grid">
          {(Object.entries(interaction.fields) as Array<[string, DXCInputField]>).map(([name, field]) => (
            <label key={name}>
              {field.label ?? name}
              <input
                type={field.type === 'otp' ? 'text' : field.type}
                inputMode={field.type === 'otp' ? 'numeric' : undefined}
                placeholder={'placeholder' in field ? field.placeholder : undefined}
                value={values[name] ?? ''}
                onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
                autoFocus
              />
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          {interaction.cancelLabel ? (
            <button type="button" className="ghost-button" onClick={() => interaction.onCancel()}>
              {interaction.cancelLabel}
            </button>
          ) : null}
          <button type="submit" className="primary-button">
            {interaction.submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function EditTransactionDialog({
  transaction,
  buckets,
  sources,
  categories,
  onClose,
  onDelete,
}: {
  transaction: Transaction
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  onClose: () => void
  onDelete: (transaction: Transaction) => Promise<void>
}) {
  const [date, setDate] = useState(transaction.date)
  const [amount, setAmount] = useState(String(transaction.amount))
  const [currency, setCurrency] = useState(transaction.currency)
  const [bucketId, setBucketId] = useState(transaction.bucketId)
  const [toBucketId, setToBucketId] = useState(transaction.toBucketId ?? '')
  const [sourceName, setSourceName] = useState(nameForSource(transaction.sourceId, sources, ''))
  const [categoryName, setCategoryName] = useState(nameForCategory(transaction.categoryId, categories, ''))
  const [note, setNote] = useState(transaction.note ?? '')
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const editableBuckets = buckets.filter((bucket) => !bucket.archived || bucket.id === transaction.bucketId)

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        onSubmit={async (event) => {
          event.preventDefault()
          setError('')
          const parsed = parseAmount(amount)
          if (!Number.isFinite(parsed)) return setError('Enter a valid amount.')
          if (transaction.type === 'transfer' && (!toBucketId || toBucketId === bucketId)) {
            return setError('Choose two different buckets.')
          }
          await updateTransaction({
            id: transaction.id,
            date,
            amount: parsed,
            currency,
            bucketId,
            toBucketId: toBucketId || undefined,
            sourceName,
            categoryName,
            note,
            realmId: transaction.realmId,
          })
          onClose()
        }}
      >
        <h2>Edit {transactionLabels[transaction.type].toLowerCase()}</h2>
        <div className="form-grid">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Amount
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label>
            Currency
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
          <BucketSelect
            label={transaction.type === 'transfer' ? 'From' : 'Bucket'}
            buckets={editableBuckets}
            value={bucketId}
            onChange={setBucketId}
          />
          {transaction.type === 'transfer' ? (
            <BucketSelect label="To" buckets={editableBuckets} value={toBucketId} onChange={setToBucketId} />
          ) : null}
          {transaction.type === 'income' ? (
            <SuggestField
              label="Source"
              listId="edit-income-sources"
              value={sourceName}
              onChange={setSourceName}
              names={sources.filter((source) => !source.archived).map((source) => source.name)}
            />
          ) : null}
          {transaction.type === 'expense' ? (
            <SuggestField
              label="Category"
              listId="edit-expense-categories"
              value={categoryName}
              onChange={setCategoryName}
              names={categories.filter((category) => !category.archived).map((category) => category.name)}
            />
          ) : null}
          <label>
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {confirmingDelete ? (
          <div className="delete-confirm" role="alertdialog" aria-label="Confirm delete">
            <p>
              Delete this {transactionLabels[transaction.type].toLowerCase()}?
              <strong>
                {signedAmount(transaction)} · {formatShortDate(transaction.date)} · {bucketLine(transaction, buckets)}
              </strong>
              {transaction.note ? <span>{transaction.note}</span> : null}
            </p>
            <div className="dialog-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Keep it
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await onDelete(transaction)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                    setDeleting(false)
                  }
                }}
              >
                <Trash2 size={16} />
                Yes, delete
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            <button type="button" className="ghost-button delete-link" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={16} />
              Delete…
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save edits
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

const LAST_BACKUP_KEY = 'familyFinanceLastBackupDownload'
const BACKUP_SNOOZE_KEY = 'familyFinanceBackupReminderSnoozedUntil'
const BACKUP_REMIND_DAYS = 30

function readLastBackupAt(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

function markBackupDownloaded() {
  const now = new Date().toISOString()
  try {
    localStorage.setItem(LAST_BACKUP_KEY, now)
  } catch {
    // Reminder only; the download itself already happened.
  }
  return now
}

function isBackupReminderSnoozed() {
  try {
    const until = localStorage.getItem(BACKUP_SNOOZE_KEY)
    return Boolean(until && until > new Date().toISOString())
  } catch {
    return false
  }
}

function snoozeBackupReminder(days: number) {
  try {
    localStorage.setItem(BACKUP_SNOOZE_KEY, new Date(Date.now() + days * 86_400_000).toISOString())
  } catch {
    // Without storage the reminder simply shows again next time.
  }
}

/** Whole days since an ISO timestamp, or null when there is none. */
function daysSince(iso: string | null) {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000))
}

/** YYYY-MM-DD of an ISO timestamp in Moscow time, matching how entry dates are shown. */
function isoToMoscowDate(iso: string) {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return todayInputDate()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(parsed),
  )
}

function filterTransactions(transactions: Transaction[], filters: Filters) {
  return transactions.filter((transaction) => {
    if (filters.from && transaction.date < filters.from) return false
    if (filters.to && transaction.date > filters.to) return false
    if (filters.types.length && !filters.types.includes(transaction.type)) return false
    if (
      filters.bucketIds.length &&
      !filters.bucketIds.includes(transaction.bucketId) &&
      !(transaction.toBucketId && filters.bucketIds.includes(transaction.toBucketId))
    ) {
      return false
    }
    if (filters.sourceIds.length && (!transaction.sourceId || !filters.sourceIds.includes(transaction.sourceId))) return false
    if (filters.categoryIds.length && (!transaction.categoryId || !filters.categoryIds.includes(transaction.categoryId))) return false
    return true
  })
}

function sumRows(transactions: Transaction[], idFor: (transaction: Transaction) => string, labelFor: (id: string) => string): ChartRow[] {
  const rows = new Map<string, ChartRow>()
  for (const transaction of transactions) {
    const id = idFor(transaction)
    const key = `${id}-${transaction.currency}`
    const existing = rows.get(key) ?? { id, label: labelFor(id), currency: transaction.currency, amount: 0 }
    existing.amount = roundMoney(existing.amount + Math.abs(transaction.amount))
    rows.set(key, existing)
  }
  return Array.from(rows.values()).sort((a, b) => b.amount - a.amount)
}

function amountDirection(transaction: Transaction): 'in' | 'out' | 'move' {
  if (transaction.type === 'expense') return 'out'
  if (transaction.type === 'income' || transaction.type === 'funding') return 'in'
  if (transaction.type === 'adjustment') return transaction.amount < 0 ? 'out' : 'in'
  return 'move'
}

/** "Today", "Yesterday", or e.g. "Thu, Aug 28, 2026" (Moscow time, like every other date here). */
function formatDayHeader(date: string) {
  const today = todayInputDate()
  if (date === today) return 'Today'
  const yesterday = new Date(Date.parse(`${today}T12:00:00+03:00`) - 86_400_000)
  if (date === isoToMoscowDate(yesterday.toISOString())) return 'Yesterday'
  return new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(`${date}T12:00:00+03:00`),
  )
}

function signedAmount(transaction: Transaction) {
  const formatted = formatMoney(Math.abs(transaction.amount), transaction.currency)
  if (transaction.type === 'expense') return `−${formatted}`
  if (transaction.type === 'income' || transaction.type === 'funding') return `+${formatted}`
  if (transaction.type === 'adjustment') return transaction.amount < 0 ? `−${formatted}` : `+${formatted}`
  return formatted
}

function bucketLine(transaction: Transaction, buckets: Bucket[]) {
  const from = nameForBucket(transaction.bucketId, buckets)
  if (transaction.type === 'transfer') return `${from} → ${nameForBucket(transaction.toBucketId, buckets)}`
  return from
}

function nameForBucket(id: string | undefined, buckets: Bucket[]) {
  if (!id) return 'Unknown bucket'
  return buckets.find((bucket) => bucket.id === id)?.name ?? 'Unknown bucket'
}

function nameForSource(id: string | undefined, sources: IncomeSource[], fallback = 'No source') {
  if (!id) return fallback
  return sources.find((source) => source.id === id)?.name ?? fallback
}

function nameForCategory(id: string | undefined, categories: Category[], fallback = 'Uncategorized') {
  if (!id) return fallback
  return categories.find((category) => category.id === id)?.name ?? fallback
}

export default App
