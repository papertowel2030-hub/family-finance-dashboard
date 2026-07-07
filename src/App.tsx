import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import { BehaviorSubject } from 'rxjs'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CircleAlert,
  Cloud,
  CloudOff,
  Coins,
  Edit3,
  HandCoins,
  LineChart,
  LogIn,
  LogOut,
  Plus,
  RefreshCcw,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
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
import { backupFileName, exportBackup, parseBackup, restoreBackup } from './db/backup'
import { computeLedger } from './lib/ledger'
import type {
  AppSettings,
  Bucket,
  BucketKind,
  BucketOwner,
  Category,
  Filters,
  IncomeSource,
  LedgerSnapshot,
  Transaction,
  TransactionType,
} from './types'
import { currentMonthKey, formatMonth, formatShortDate, todayInputDate } from './utils/date'
import { formatBuckets, formatMoney, parseAmount, roundMoney } from './utils/money'
import { isUsingFallbackIndexedDb } from './storageBootstrap'

const ownerNames: Record<BucketOwner, string> = {
  moon: 'Moon',
  alena: 'Alena',
  shared: 'Shared',
}

const emptyFilters: Filters = {
  bucketId: 'all',
  type: 'all',
  sourceId: 'all',
  categoryId: 'all',
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

type CloudUser = { isLoggedIn?: boolean; name?: string; email?: string }
type CloudSyncState = { status?: string }
type CloudInvite = { id: string; roles?: string[]; realm?: { name?: string }; accept: () => Promise<void>; reject: () => Promise<void> }

const offlineUser$ = new BehaviorSubject<CloudUser>({ isLoggedIn: false })
const offlineSync$ = new BehaviorSubject<CloudSyncState>({ status: 'Local only' })
const offlineInvites$ = new BehaviorSubject<CloudInvite[]>([])
const offlineInteraction$ = new BehaviorSubject<DXCUserInteraction | undefined>(undefined)

type StorageState = 'checking' | 'ready' | 'unavailable'

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
  const buckets = useLiveQuery(() => db.buckets.orderBy('name').toArray(), [], [])
  const sources = useLiveQuery(() => db.incomeSources.orderBy('name').toArray(), [], [])
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [], [])
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [], [])
  const currentUser = useObservable((isCloudConfigured ? db.cloud.currentUser : offlineUser$) as never) as CloudUser | undefined
  const syncState = useObservable((isCloudConfigured ? db.cloud.syncState : offlineSync$) as never) as CloudSyncState | undefined
  const invites = useObservable((isCloudConfigured ? db.cloud.invites : offlineInvites$) as never, []) as CloudInvite[] | undefined
  const userInteraction = useObservable(
    (isCloudConfigured ? db.cloud.userInteraction : offlineInteraction$) as never,
  ) as DXCUserInteraction | undefined

  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const [justDeleted, setJustDeleted] = useState<Transaction | null>(null)
  const [prefill, setPrefill] = useState<{ transaction: Transaction; key: number } | null>(null)
  const recordRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!justDeleted) return
    const timer = window.setTimeout(() => setJustDeleted(null), 8000)
    return () => window.clearTimeout(timer)
  }, [justDeleted])

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

      {isUsingFallbackIndexedDb() ? <PreviewStorageNotice /> : null}
      <UserInteractionDialog interaction={userInteraction} />

      {!settings ? (
        <SetupPanel currentUser={currentUser} invites={invites} />
      ) : (
        <>
          {invites && invites.length > 0 ? <InvitePanel invites={invites} /> : null}
          <Dashboard ledger={ledger} monthKey={monthKey} onMonthChange={setMonthKey} />
          <RecordMoney
            settings={settings}
            buckets={activeBuckets}
            sources={sources ?? []}
            categories={categories ?? []}
            prefill={prefill}
            scrollRef={recordRef}
          />
          <section className="analytics-band">
            <FiltersPanel filters={filters} setFilters={setFilters} buckets={buckets ?? []} sources={sources ?? []} categories={categories ?? []} />
            <Charts transactions={filteredTransactions} buckets={buckets ?? []} sources={sources ?? []} categories={categories ?? []} />
          </section>
          <History
            transactions={filteredTransactions}
            buckets={buckets ?? []}
            sources={sources ?? []}
            categories={categories ?? []}
            onEdit={setEditing}
            onDelete={async (transaction) => {
              await deleteTransaction(transaction.id)
              setJustDeleted(transaction)
            }}
            onRepeat={(transaction) => {
              setPrefill({ transaction, key: Date.now() })
              recordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
          <ManagementPanel
            settings={settings}
            buckets={buckets ?? []}
            sources={sources ?? []}
            categories={categories ?? []}
            ledger={ledger}
          />
          {editing ? (
            <EditTransactionDialog
              transaction={editing}
              buckets={buckets ?? []}
              sources={sources ?? []}
              categories={categories ?? []}
              onClose={() => setEditing(null)}
            />
          ) : null}
          {justDeleted ? (
            <div className="undo-toast" role="status">
              <span>
                Deleted: {transactionLabels[justDeleted.type].toLowerCase()} {signedAmount(justDeleted)}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await restoreTransaction(justDeleted)
                  setJustDeleted(null)
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

function PreviewStorageNotice() {
  return (
    <section className="notice-panel preview-storage">
      <div>
        <p className="eyebrow">Preview storage</p>
        <h2>Running without browser IndexedDB</h2>
      </div>
      <p className="quiet-line">
        This browser does not expose persistent IndexedDB, so this session uses temporary in-memory storage. Use Chrome, Safari,
        Arc, Firefox, or another regular browser window for real offline persistence.
      </p>
    </section>
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

function SyncBadge({
  currentUser,
  syncState,
}: {
  currentUser?: { isLoggedIn?: boolean; name?: string; email?: string }
  syncState?: { status?: string }
}) {
  if (!isCloudConfigured) {
    return (
      <span className="sync-badge muted">
        <CloudOff size={16} />
        Local only
      </span>
    )
  }
  return (
    <span className="sync-badge">
      <Cloud size={16} />
      {currentUser?.isLoggedIn ? syncState?.status ?? 'Synced' : 'Sign in'}
    </span>
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
            setBusy(true)
            try {
              await createCloudFamilySpace(spouseEmail, spouseName)
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
          <button type="submit" className="primary-button" disabled={busy}>
            <ShieldCheck size={18} />
            Create shared space
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
}: {
  ledger: LedgerSnapshot
  monthKey: string
  onMonthChange: (monthKey: string) => void
}) {
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

      <div className="month-summary">
        <span className="summary-item in">
          <ArrowDownToLine size={16} />
          Money in: +{formatBuckets(ledger.monthIncome, '0')}
        </span>
        <span className="summary-item out">
          <ArrowUpFromLine size={16} />
          Spent: −{formatBuckets(ledger.monthSpending, '0')}
        </span>
        <span className="small-label">{formatMonth(monthKey)} · business money not counted</span>
      </div>

      {bucketGroups.map((group) => {
        const balances = ledger.balances.filter((balance) => balance.bucket.kind === group.kind)
        if (!balances.length && group.kind !== 'spending') return null
        return (
          <div className="bucket-group" key={group.kind}>
            <div className="bucket-group-header">
              <h3>{group.title}</h3>
              {group.hint ? <span className="small-label">{group.hint}</span> : null}
            </div>
            {balances.length ? (
              <div className="dashboard">
                {balances.map((balance) => (
                  <article
                    className={`money-card ${groupTones[group.kind]} ${balance.totals.some((total) => total.amount < 0) ? 'warning' : ''}`}
                    key={balance.bucket.id}
                  >
                    <div className="card-label">
                      {balance.bucket.name}
                      <span className="type-chip">{ownerNames[balance.bucket.ownerId]}</span>
                    </div>
                    <strong>{formatBuckets(balance.totals)}</strong>
                    <p className="month-flow">
                      {formatMonth(monthKey)}: +{formatBuckets(balance.monthIn, '0')} · −{formatBuckets(balance.monthOut, '0')}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No buckets here yet.</p>
            )}
          </div>
        )
      })}

      {ledger.negativeWarnings.length ? (
        <div className="warning-strip">
          <CircleAlert size={18} />
          {ledger.negativeWarnings.join(' · ')}
        </div>
      ) : null}
    </section>
  )
}

type RecordMode = 'in' | 'expense' | 'transfer'

function RecordMoney({
  settings,
  buckets,
  sources,
  categories,
  prefill,
  scrollRef,
}: {
  settings: AppSettings
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  prefill: { transaction: Transaction; key: number } | null
  scrollRef: React.RefObject<HTMLElement | null>
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
    <section className="fast-add" ref={scrollRef}>
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
      <div className="form-grid">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </label>
        <BucketSelect label="Into bucket" buckets={buckets} value={bucketId} onChange={setBucketId} />
        {!isFunding ? <SuggestField label="Source" listId="income-sources" value={sourceName} onChange={setSourceName} names={sources.filter((source) => !source.archived).map((source) => source.name)} placeholder="e.g. Teaching, Salary" /> : null}
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
      <div className="form-grid">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </label>
        <BucketSelect label="Paid from" buckets={buckets} value={bucketId} onChange={setBucketId} />
        <SuggestField label="Category" listId="expense-categories" value={categoryName} onChange={setCategoryName} names={categories.filter((category) => !category.archived).map((category) => category.name)} placeholder="e.g. Groceries" />
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
      <div className="form-grid">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </label>
        <BucketSelect label="From" buckets={buckets} value={fromBucketId} onChange={setFromBucketId} />
        <BucketSelect label="To" buckets={buckets} value={toBucketId} onChange={setToBucketId} />
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
    <section className="panel setup-block">
      <div className="section-header compact">
        <h2>Setup</h2>
        <Settings size={20} />
      </div>
      <CurrencySettings settings={settings} />
      <BucketManager settings={settings} buckets={buckets} ledger={ledger} />
      <SourceManager sources={sources} />
      <CategoryManager categories={categories} />
      <BackupPanel />
    </section>
  )
}

function BackupPanel() {
  const [message, setMessage] = useState('')

  return (
    <div className="manager-block">
      <h3>Backup</h3>
      <div className="row-actions backup-actions">
        <button
          type="button"
          onClick={async () => {
            setMessage('')
            const backup = await exportBackup()
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = backupFileName()
            link.click()
            URL.revokeObjectURL(url)
            setMessage(`Saved ${backup.transactions.length} transactions to ${link.download}.`)
          }}
        >
          Download backup
        </button>
        <label className="file-button">
          Restore from file
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
                if (!window.confirm(`Replace everything in the app with this backup?\n${summary}`)) return
                await restoreBackup(backup)
                setMessage(`Restored ${summary}.`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error))
              }
            }}
          />
        </label>
      </div>
      {message ? <p className="small-label">{message}</p> : null}
      <p className="small-label">
        The backup is a single file with all buckets, sources, categories and transactions. Keep one somewhere safe — browser
        storage can be wiped by clearing site data.
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
        if (!bucketId || !Number.isFinite(parsed)) return
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

function SourceManager({ sources }: { sources: IncomeSource[] }) {
  return (
    <ManagedNameList
      title="Income sources"
      hint="New sources are also created automatically when you type them on the income form."
      items={sources}
      onAdd={(name) => addSource(name)}
      onToggle={(id, archived) => setSourceArchived(id, archived)}
    />
  )
}

function CategoryManager({ categories }: { categories: Category[] }) {
  return (
    <ManagedNameList
      title="Expense categories"
      hint="New categories are also created automatically when you type them on the expense form."
      items={categories}
      onAdd={(name) => addCategory(name)}
      onToggle={(id, archived) => setCategoryArchived(id, archived)}
    />
  )
}

function ManagedNameList({
  title,
  hint,
  items,
  onAdd,
  onToggle,
}: {
  title: string
  hint: string
  items: Array<{ id: string; name: string; archived?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onToggle: (id: string, archived: boolean) => Promise<unknown>
}) {
  const [name, setName] = useState('')

  return (
    <div className="manager-block">
      <h3>{title}</h3>
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
      {items.length ? (
        <div className="pill-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.archived ? 'archived' : ''}
              title={item.archived ? 'Tap to restore' : 'Tap to archive'}
              onClick={() => onToggle(item.id, !item.archived)}
            >
              {item.name}
              {item.archived ? ' ·restore' : ''}
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-state">Empty</p>
      )}
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
  return (
    <section className="panel filters-panel">
      <div className="section-header compact">
        <h2>Filters</h2>
        <Search size={20} />
      </div>
      <div className="filter-grid">
        <label>
          Bucket
          <select value={filters.bucketId} onChange={(event) => setFilters({ ...filters, bucketId: event.target.value })}>
            <option value="all">All</option>
            {buckets.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as Filters['type'] })}>
            <option value="all">All</option>
            {Object.entries(transactionLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select value={filters.sourceId} onChange={(event) => setFilters({ ...filters, sourceId: event.target.value })}>
            <option value="all">All</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={filters.categoryId} onChange={(event) => setFilters({ ...filters, categoryId: event.target.value })}>
            <option value="all">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
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
    </section>
  )
}

function Charts({
  transactions,
  buckets,
  sources,
  categories,
}: {
  transactions: Transaction[]
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
}) {
  const incomeRows = sumRows(
    transactions.filter((transaction) => transaction.type === 'income'),
    (transaction) => nameForSource(transaction.sourceId, sources),
  )
  const categoryRows = sumRows(
    transactions.filter((transaction) => transaction.type === 'expense'),
    (transaction) => nameForCategory(transaction.categoryId, categories),
  )
  const bucketRows = sumRows(
    transactions.filter((transaction) => transaction.type === 'expense'),
    (transaction) => nameForBucket(transaction.bucketId, buckets),
  )

  return (
    <section className="panel charts-panel">
      <div className="section-header compact">
        <h2>Breakdowns</h2>
        <LineChart size={20} />
      </div>
      <ChartBlock title="Income by source" rows={incomeRows} />
      <ChartBlock title="Spending by category" rows={categoryRows} />
      <ChartBlock title="Spending by bucket" rows={bucketRows} />
    </section>
  )
}

function ChartBlock({ title, rows }: { title: string; rows: Array<{ label: string; amount: number; currency: string }> }) {
  const max = Math.max(...rows.map((row) => row.amount), 0)
  return (
    <div className="chart-block">
      <h3>{title}</h3>
      {rows.length ? (
        rows.slice(0, 6).map((row, index) => (
          <div className="bar-row" key={`${row.label}-${row.currency}`}>
            <span>{row.label}</span>
            <div className="bar-track">
              <div className={`bar-fill tone-${index % 4}`} style={{ width: `${max ? Math.max(6, (row.amount / max) * 100) : 0}%` }} />
            </div>
            <strong>{formatMoney(row.amount, row.currency)}</strong>
          </div>
        ))
      ) : (
        <p className="empty-state">No data.</p>
      )}
    </div>
  )
}

function History({
  transactions,
  buckets,
  sources,
  categories,
  onEdit,
  onDelete,
  onRepeat,
}: {
  transactions: Transaction[]
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  onEdit: (transaction: Transaction) => void
  onDelete: (transaction: Transaction) => void
  onRepeat: (transaction: Transaction) => void
}) {
  return (
    <section className="history panel">
      <div className="section-header compact">
        <h2>History</h2>
        <Coins size={20} />
      </div>
      {transactions.length ? (
        <div className="transaction-list">
          {transactions.map((transaction) => (
            <article className="transaction-row" key={transaction.id}>
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
                <button type="button" className="icon-button subtle" aria-label="Edit transaction" onClick={() => onEdit(transaction)}>
                  <Edit3 size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label="Delete transaction"
                  onClick={() => onDelete(transaction)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">No transactions.</p>
      )}
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
}: {
  transaction: Transaction
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  onClose: () => void
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
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save edits
          </button>
        </div>
      </form>
    </div>
  )
}

function filterTransactions(transactions: Transaction[], filters: Filters) {
  return transactions.filter((transaction) => {
    if (filters.from && transaction.date < filters.from) return false
    if (filters.to && transaction.date > filters.to) return false
    if (filters.type !== 'all' && transaction.type !== filters.type) return false
    if (filters.bucketId !== 'all' && transaction.bucketId !== filters.bucketId && transaction.toBucketId !== filters.bucketId) {
      return false
    }
    if (filters.sourceId !== 'all' && transaction.sourceId !== filters.sourceId) return false
    if (filters.categoryId !== 'all' && transaction.categoryId !== filters.categoryId) return false
    return true
  })
}

function sumRows(transactions: Transaction[], labelFor: (transaction: Transaction) => string) {
  const rows = new Map<string, { label: string; amount: number; currency: string }>()
  for (const transaction of transactions) {
    const label = labelFor(transaction)
    const key = `${label}-${transaction.currency}`
    const existing = rows.get(key) ?? { label, currency: transaction.currency, amount: 0 }
    existing.amount = roundMoney(existing.amount + Math.abs(transaction.amount))
    rows.set(key, existing)
  }
  return Array.from(rows.values()).sort((a, b) => b.amount - a.amount)
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
