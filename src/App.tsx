import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import type { Table } from 'dexie'
import { BehaviorSubject } from 'rxjs'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Cloud,
  CloudOff,
  Coins,
  Download,
  Edit3,
  HandCoins,
  LineChart,
  LogIn,
  LogOut,
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
  previousMonthKey,
  todayInputDate,
} from './utils/date'
import { formatBuckets, formatMoney, parseAmount, roundMoney } from './utils/money'

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
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  // Every delete keeps its own Undo, so deleting several in a row never loses the earlier ones.
  const [recentDeletes, setRecentDeletes] = useState<Array<{ transaction: Transaction; deletedAt: number }>>([])
  const [prefill, setPrefill] = useState<{ transaction: Transaction; key: number } | null>(null)
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

  const ledger = useMemo(() => computeLedger(buckets ?? [], transactions ?? [], monthKey), [buckets, transactions, monthKey])

  const filteredTransactions = useMemo(() => filterTransactions(transactions ?? [], filters), [transactions, filters])

  const activeBuckets = useMemo(() => (buckets ?? []).filter((bucket) => !bucket.archived), [buckets])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Moon &amp; Alena</p>
          <h1>Family Finance</h1>
        </div>
        <div className="top-actions">
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
          <TabBar tab={tab} setTab={setTab} />

          {tab === 'home' ? (
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

          {tab === 'add' ? (
            <RecordMoney
              settings={settings}
              buckets={activeBuckets}
              sources={sources ?? []}
              categories={categories ?? []}
              prefill={prefill}
            />
          ) : null}

          {tab === 'activity' ? (
            <div className="activity-stack">
              <FiltersPanel filters={filters} setFilters={setFilters} buckets={buckets ?? []} sources={sources ?? []} categories={categories ?? []} />
              <History
                transactions={filteredTransactions}
                buckets={buckets ?? []}
                sources={sources ?? []}
                categories={categories ?? []}
                onEdit={setEditing}
                onRepeat={(transaction) => {
                  setPrefill({ transaction, key: Date.now() })
                  setTab('add')
                }}
              />
              <Charts
                transactions={filteredTransactions}
                buckets={buckets ?? []}
                sources={sources ?? []}
                categories={categories ?? []}
                filters={filters}
                setFilters={setFilters}
              />
            </div>
          ) : null}

          {tab === 'setup' ? (
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
            Starts with three buckets: Moon, Alena and Family. Set `VITE_DEXIE_CLOUD_URL` to enable shared sync — current mode
            stores data in this browser.
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
      <p className="quiet-line">Dexie Cloud URL: {getDexieCloudUrl() ?? 'not configured'}</p>
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

  const scopeNote =
    viewer === 'all' ? 'business money not counted' : `${ownerNames[viewer]} + shared · business not counted`

  return (
    <section className="dashboard-wrap">
      <div className="section-header">
        <div>
          <p className="eyebrow">What is left in each bucket</p>
          <h2>Balances</h2>
        </div>
        <label className="month-picker">
          Month
          <input type="month" value={monthKey} onChange={(event) => onMonthChange(event.target.value || currentMonthKey())} />
        </label>
      </div>

      <div className="viewer-switch">
        <span className="small-label">Viewing as</span>
        <div className="segmented-control">
          {VIEWER_OPTIONS.map((option) => (
            <button key={option.id} type="button" className={viewer === option.id ? 'active' : ''} onClick={() => changeViewer(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="month-summary">
        <span className="summary-item in">
          <ArrowDownToLine size={16} />
          Money in: +{formatBuckets(monthTotals.income, '0')}
        </span>
        <span className="summary-item out">
          <ArrowUpFromLine size={16} />
          Spent: −{formatBuckets(monthTotals.spending, '0')}
        </span>
        {saved.length ? (
          <span className={`summary-item ${saved.some((item) => item.amount < 0) ? 'over' : 'saved'}`}>
            <PiggyBank size={16} />
            {saved.map((item) => `${item.amount < 0 ? 'Overspent' : 'Left over'}: ${formatMoney(Math.abs(item.amount), item.currency)}`).join(' · ')}
          </span>
        ) : null}
        <span className="small-label">
          {formatMonth(monthKey)} · {scopeNote}
        </span>
      </div>

      {backupDue && transactions.length ? (
        <div className="reminder-strip">
          <Download size={18} />
          <span>No backup file downloaded on this device for {BACKUP_REMIND_DAYS}+ days.</span>
          <button type="button" className="primary-button" onClick={onOpenBackup}>
            Back up now
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              snoozeBackupReminder(7)
              setBackupDue(false)
            }}
          >
            Later
          </button>
        </div>
      ) : null}

      {bucketGroups.map((group) => {
        const balances = ledger.balances.filter((balance) => balance.bucket.kind === group.kind)
        if (!balances.length && group.kind !== 'spending') return null
        return (
          <BucketGroupView
            key={group.kind}
            group={group}
            balances={balances}
            viewer={viewer}
            monthKey={monthKey}
            onOpenBucket={onOpenBucket}
          />
        )
      })}

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
        <div>
          <p className="eyebrow">Business money not counted</p>
          <h2>Month insights</h2>
        </div>
        {currencies.length > 1 ? (
          <div className="segmented-control" aria-label="Currency">
            {currencies.map((item) => (
              <button key={item} type="button" className={item === currency ? 'active' : ''} onClick={() => setPickedCurrency(item)}>
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

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
          <p className="empty-state">No income or spending in {currency} yet.</p>
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
          <p className="empty-state">No spending in {currency} this month.</p>
        )}
        {showAllCategories && categoryRows.canCollapse ? (
          <button type="button" className="ghost-button show-less" onClick={() => setShowAllCategories(false)}>
            Show less
          </button>
        ) : null}
      </div>
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
  monthKey,
  onOpenBucket,
}: {
  group: { kind: BucketKind; title: string; hint?: string }
  balances: LedgerSnapshot['balances']
  viewer: ViewerId
  monthKey: string
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

  const renderCard = (balance: LedgerSnapshot['balances'][number]) => {
    const isMine = viewer !== 'all' && balance.bucket.ownerId === viewer
    return (
      <article
        className={`money-card clickable ${groupTones[group.kind]} ${isMine ? 'mine' : ''} ${balance.totals.some((total) => total.amount < 0) ? 'warning' : ''}`}
        key={balance.bucket.id}
        role="button"
        tabIndex={0}
        title={`Show ${balance.bucket.name} history`}
        onClick={() => onOpenBucket(balance.bucket.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenBucket(balance.bucket.id)
          }
        }}
      >
        <div className="card-label">
          {balance.bucket.name}
          <span className="type-chip">{isMine ? 'You' : ownerNames[balance.bucket.ownerId]}</span>
        </div>
        <strong>{formatBuckets(balance.totals)}</strong>
        <p className="month-flow">
          {formatMonth(monthKey)}: +{formatBuckets(balance.monthIn, '0')} · −{formatBuckets(balance.monthOut, '0')}
        </p>
      </article>
    )
  }

  return (
    <div className="bucket-group">
      <div className="bucket-group-header">
        <h3>{group.title}</h3>
        {group.hint ? <span className="small-label">{group.hint}</span> : null}
      </div>
      {primary.length ? (
        <div className="dashboard">{primary.map(renderCard)}</div>
      ) : secondary.length ? null : (
        <p className="empty-state">No buckets here yet.</p>
      )}
      {secondary.length && partner ? (
        <div className="partner-block">
          <button type="button" className="ghost-button show-more-button" onClick={() => setShowPartner((value) => !value)}>
            {showPartner ? 'Hide' : 'Show'} {ownerNames[partner]}’s money ({secondary.length})
          </button>
          {showPartner ? <div className="dashboard muted-group">{secondary.map(renderCard)}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

type RecordMode = 'in' | 'expense' | 'transfer'

function RecordMoney({
  settings,
  buckets,
  sources,
  categories,
  prefill,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  prefill: { transaction: Transaction; key: number } | null
}) {
  const [mode, setMode] = useState<RecordMode>('in')

  useEffect(() => {
    if (!prefill) return
    const { type } = prefill.transaction
    setMode(type === 'expense' ? 'expense' : type === 'transfer' ? 'transfer' : 'in')
  }, [prefill])

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
        <MoneyInForm key={prefill?.key} settings={settings} buckets={buckets} sources={sources} initial={moneyInInitial} />
      ) : null}
      {mode === 'expense' ? (
        <ExpenseForm key={prefill?.key} settings={settings} buckets={buckets} categories={categories} initial={expenseInitial} />
      ) : null}
      {mode === 'transfer' ? (
        <TransferForm key={prefill?.key} settings={settings} buckets={buckets} initial={transferInitial} />
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
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  initial?: { amount: string; currency: string; bucketId: string; sourceName: string; note: string }
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [bucketId, setBucketId] = useState(initial?.bucketId ?? '')
  const [sourceName, setSourceName] = useState(initial?.sourceName ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

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
        await (isFunding ? saveFunding(input) : saveIncome(input))
        setAmount('')
        setNote('')
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} />
      <div className="form-grid">
        <BucketSelect label="Into bucket" buckets={buckets} value={bucketId} onChange={setBucketId} />
        {!isFunding ? <SuggestField label="Source" listId="income-sources" value={sourceName} onChange={setSourceName} names={sources.filter((source) => !source.archived).map((source) => source.name)} placeholder="e.g. Teaching, Salary" /> : null}
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
}: {
  settings: AppSettings
  buckets: Bucket[]
  categories: Category[]
  initial?: { amount: string; currency: string; bucketId: string; categoryName: string; note: string }
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [bucketId, setBucketId] = useState(initial?.bucketId ?? '')
  const [categoryName, setCategoryName] = useState(initial?.categoryName ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  return (
    <form
      className="entry-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        const parsed = parseAmount(amount)
        if (!bucketId) return setError('Choose which bucket pays for this.')
        if (!Number.isFinite(parsed) || parsed <= 0) return setError('Enter a positive amount.')
        await saveExpense({ date, amount: parsed, currency, bucketId, categoryName, note, realmId: settings.realmId })
        setAmount('')
        setNote('')
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} />
      <div className="form-grid">
        <BucketSelect label="Paid from" buckets={buckets} value={bucketId} onChange={setBucketId} />
        <SuggestField label="Category" listId="expense-categories" value={categoryName} onChange={setCategoryName} names={categories.filter((category) => !category.archived).map((category) => category.name)} placeholder="e.g. Groceries" />
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
}: {
  settings: AppSettings
  buckets: Bucket[]
  initial?: { amount: string; currency: string; fromBucketId: string; toBucketId: string; note: string }
}) {
  const [date, setDate] = useState(todayInputDate())
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? settings.defaultCurrency)
  const [fromBucketId, setFromBucketId] = useState(initial?.fromBucketId ?? '')
  const [toBucketId, setToBucketId] = useState(initial?.toBucketId ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

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
        await saveTransfer({ date, amount: parsed, currency, fromBucketId, toBucketId, note, realmId: settings.realmId })
        setAmount('')
        setNote('')
      }}
    >
      <AmountCurrencyRow amount={amount} setAmount={setAmount} currency={currency} setCurrency={setCurrency} />
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
}: {
  amount: string
  setAmount: (value: string) => void
  currency: string
  setCurrency: (value: string) => void
}) {
  return (
    <div className="amount-row">
      <label className="amount-field">
        Amount
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
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
}: {
  label: string
  listId: string
  value: string
  onChange: (value: string) => void
  names: string[]
  placeholder?: string
}) {
  return (
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
      <section className="panel">
        <div className="manager-block">
          <h3>Currency</h3>
          <CurrencySettings settings={settings} />
        </div>
      </section>
      <section className="panel">
        <BucketManager settings={settings} buckets={buckets} ledger={ledger} />
      </section>
      <section className="panel">
        <SourceManager settings={settings} sources={sources} />
      </section>
      <section className="panel">
        <CategoryManager settings={settings} categories={categories} />
      </section>
      <section className="panel">
        <RecoveryPanel settings={settings} buckets={buckets} sources={sources} categories={categories} />
      </section>
      <section className="panel">
        <BackupPanel settings={settings} />
      </section>
    </div>
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
    <div className="manager-block">
      <h3>
        Recently deleted <span className="small-label">({deleted?.length ?? 0})</span>
      </h3>
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
        <p className="empty-state">Nothing deleted recently.</p>
      )}
      {message ? <p className="small-label">{message}</p> : null}
    </div>
  )
}

function BackupPanel({ settings }: { settings: AppSettings }) {
  const [message, setMessage] = useState('')
  const [lastBackupAt, setLastBackupAt] = useState(readLastBackupAt)
  const age = daysSince(lastBackupAt)

  return (
    <div className="manager-block">
      <h3>Backup</h3>
      <p className={`small-label ${age === null || age >= BACKUP_REMIND_DAYS ? 'backup-due' : ''}`}>
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
                if (!window.confirm(`Add records missing from the current family space?\n${summary}\nExisting records will not be changed or deleted.`)) return
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
        </label>
      </div>
      {message ? <p className="small-label">{message}</p> : null}
      <p className="small-label">
        The backup contains this family space. Merging is additive: it never clears the app and never overwrites an existing ID.
      </p>
    </div>
  )
}

function CurrencySettings({ settings }: { settings: AppSettings }) {
  const [currency, setCurrency] = useState(settings.defaultCurrency)

  return (
    <form
      className="mini-form"
      onSubmit={async (event) => {
        event.preventDefault()
        await updateDefaultCurrency(settings, currency)
      }}
    >
      <label>
        Default currency
        <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
      </label>
      <button type="submit">Save</button>
    </form>
  )
}

function BucketManager({ settings, buckets, ledger }: { settings: AppSettings; buckets: Bucket[]; ledger: LedgerSnapshot }) {
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState<BucketOwner>('shared')
  const [kind, setKind] = useState<BucketKind>('spending')

  return (
    <div className="manager-block">
      <h3>Buckets</h3>
      <form
        className="mini-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return
          await addBucket(name, ownerId, kind, settings.realmId)
          setName('')
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <select value={ownerId} onChange={(event) => setOwnerId(event.target.value as BucketOwner)}>
          <option value="shared">Shared</option>
          <option value="moon">Moon</option>
          <option value="alena">Alena</option>
        </select>
        <select value={kind} onChange={(event) => setKind(event.target.value as BucketKind)}>
          <option value="spending">Spending</option>
          <option value="business">Business</option>
          <option value="savings">Savings</option>
        </select>
        <button type="submit">Add</button>
      </form>
      <ul className="compact-list">
        {buckets.map((bucket) => (
          <li key={bucket.id}>
            <span>
              {bucket.name} · {ownerNames[bucket.ownerId]} · {bucket.kind}
              {bucket.archived ? ' · archived' : ''}
            </span>
            <span className="row-actions">
              <strong>{formatBuckets(ledger.balances.find((balance) => balance.bucket.id === bucket.id)?.totals ?? [])}</strong>
              <button type="button" className="ghost-button" onClick={() => setBucketArchived(bucket.id, !bucket.archived)}>
                {bucket.archived ? 'Restore' : 'Archive'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={async () => {
                  if (!window.confirm(`Delete bucket "${bucket.name}"?`)) return
                  try {
                    await deleteBucket(bucket.id)
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <FixBalanceForm settings={settings} buckets={buckets.filter((bucket) => !bucket.archived)} ledger={ledger} />
    </div>
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
      hint="New sources are also created automatically when you type them on the income form."
      items={sources}
      onAdd={(name) => addSource(name, settings.realmId)}
      onToggle={(id, archived) => setSourceArchived(id, archived)}
      onDelete={(id) => deleteSource(id)}
    />
  )
}

function CategoryManager({ settings, categories }: { settings: AppSettings; categories: Category[] }) {
  return (
    <ManagedNameList
      title="Expense categories"
      hint="New categories are also created automatically when you type them on the expense form."
      items={categories}
      onAdd={(name) => addCategory(name, settings.realmId)}
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
  onToggle,
  onDelete,
}: {
  title: string
  hint: string
  items: Array<{ id: string; name: string; archived?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onToggle: (id: string, archived: boolean) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const matches = (item: { name: string }) => item.name.toLowerCase().includes(query.trim().toLowerCase())
  const active = items.filter((item) => !item.archived && matches(item))
  const archived = items.filter((item) => item.archived && matches(item))
  const archivedTotal = items.filter((item) => item.archived).length

  const remove = async (item: { id: string; name: string }) => {
    if (!window.confirm(`Delete "${item.name}" permanently?`)) return
    try {
      await onDelete(item.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="manager-block">
      <div className="inline-header">
        <h3>
          {title} <span className="small-label">({items.length - archivedTotal} active{archivedTotal ? `, ${archivedTotal} archived` : ''})</span>
        </h3>
      </div>
      <form
        className="mini-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return
          await onAdd(name)
          setName('')
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <button type="submit">Add</button>
      </form>
      {items.length > 6 ? (
        <div className="search-field">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} />
        </div>
      ) : null}
      {active.length ? (
        <div className="pill-list">
          {active.map((item) => (
            <span key={item.id} className="pill-item">
              <button type="button" className="pill-name" title="Tap to archive" onClick={() => onToggle(item.id, true)}>
                {item.name}
              </button>
              <button type="button" className="pill-delete" aria-label={`Delete ${item.name}`} title="Delete" onClick={() => remove(item)}>
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="empty-state">{query ? 'No matches.' : 'Empty'}</p>
      )}
      {archivedTotal ? (
        <>
          <button type="button" className="ghost-button show-more-button" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archivedTotal})
          </button>
          {showArchived ? (
            archived.length ? (
              <div className="pill-list">
                {archived.map((item) => (
                  <span key={item.id} className="pill-item is-archived">
                    <button type="button" className="pill-name" title="Tap to restore" onClick={() => onToggle(item.id, false)}>
                      {item.name}
                    </button>
                    <button type="button" className="pill-delete" aria-label={`Delete ${item.name}`} title="Delete" onClick={() => remove(item)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="empty-state">No matches.</p>
            )
          ) : null}
        </>
      ) : null}
      <p className="small-label">{hint}</p>
    </div>
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
  const [open, setOpen] = useState(() => localStorage.getItem('financeFiltersOpen') === '1')
  const activeCount = countActiveFilters(filters)
  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem('financeFiltersOpen', next ? '1' : '0')
  }

  return (
    <section className="panel filters-panel">
      <button type="button" className="section-header compact history-toggle" onClick={toggleOpen}>
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
      <div className="section-header compact">
        <div>
          <h2>Breakdowns</h2>
          <p className="small-label">Of the entries shown above · tap a row to filter</p>
        </div>
        <LineChart size={20} />
      </div>
      <ChartBlock title="Income by source" rows={incomeRows} selected={filters.sourceIds} onPick={toggle('sourceIds')} />
      <ChartBlock title="Spending by category" rows={categoryRows} selected={filters.categoryIds} onPick={toggle('categoryIds')} />
      <ChartBlock title="Spending by bucket" rows={bucketRows} selected={filters.bucketIds} onPick={toggle('bucketIds')} />
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
  buckets,
  sources,
  categories,
  onEdit,
  onRepeat,
}: {
  transactions: Transaction[]
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  onEdit: (transaction: Transaction) => void
  onRepeat: (transaction: Transaction) => void
}) {
  const [open, setOpen] = useState(() => localStorage.getItem('financeHistoryOpen') !== '0')
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [transactions])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem('financeHistoryOpen', next ? '1' : '0')
  }

  return (
    <section className="history panel">
      <button type="button" className="section-header compact history-toggle" onClick={toggleOpen}>
        <h2>
          History <span className="small-label">({transactions.length})</span>
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
            <article className="transaction-row">
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
        <p className="empty-state">No transactions.</p>
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
