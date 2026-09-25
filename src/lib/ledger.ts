import type { Bucket, BucketBalance, BucketOwner, LedgerSnapshot, MoneyBucket, Transaction } from '../types'
import { monthKeyFromDate, monthKeysEndingAt } from '../utils/date'
import { formatMoney, roundMoney } from '../utils/money'

function addMoney(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, roundMoney((map.get(currency) ?? 0) + amount))
}

function mapToBuckets(map: Map<string, number>): MoneyBucket[] {
  return Array.from(map.entries())
    .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
    .filter((bucket) => Math.abs(bucket.amount) > 0.004)
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

interface BucketAccumulator {
  totals: Map<string, number>
  monthIn: Map<string, number>
  monthOut: Map<string, number>
}

/**
 * Signed effect of a transaction on a bucket: +in for the receiving bucket,
 * -out for the paying bucket. Transfers touch two buckets.
 */
function flows(transaction: Transaction): Array<{ bucketId: string; amount: number }> {
  switch (transaction.type) {
    case 'income':
    case 'funding':
      return [{ bucketId: transaction.bucketId, amount: transaction.amount }]
    case 'expense':
      return [{ bucketId: transaction.bucketId, amount: -transaction.amount }]
    case 'transfer':
      return [
        { bucketId: transaction.bucketId, amount: -transaction.amount },
        ...(transaction.toBucketId ? [{ bucketId: transaction.toBucketId, amount: transaction.amount }] : []),
      ]
    case 'adjustment':
      return [{ bucketId: transaction.bucketId, amount: transaction.amount }]
  }
}

export function computeLedger(buckets: Bucket[], transactions: Transaction[], monthKey?: string): LedgerSnapshot {
  const bucketKinds = new Map(buckets.map((bucket) => [bucket.id, bucket.kind]))
  const monthIncome = new Map<string, number>()
  const monthSpending = new Map<string, number>()
  const accumulators = new Map<string, BucketAccumulator>()
  const accumulatorFor = (bucketId: string) => {
    const existing = accumulators.get(bucketId)
    if (existing) return existing
    const created: BucketAccumulator = { totals: new Map(), monthIn: new Map(), monthOut: new Map() }
    accumulators.set(bucketId, created)
    return created
  }

  for (const transaction of transactions) {
    const inMonth = monthKey ? monthKeyFromDate(transaction.date) === monthKey : false
    if (inMonth && transaction.type === 'income') {
      addMoney(monthIncome, transaction.currency, transaction.amount)
    }
    if (inMonth && transaction.type === 'expense' && bucketKinds.get(transaction.bucketId) !== 'business') {
      addMoney(monthSpending, transaction.currency, transaction.amount)
    }
    for (const flow of flows(transaction)) {
      const accumulator = accumulatorFor(flow.bucketId)
      addMoney(accumulator.totals, transaction.currency, flow.amount)
      if (inMonth) {
        addMoney(flow.amount >= 0 ? accumulator.monthIn : accumulator.monthOut, transaction.currency, Math.abs(flow.amount))
      }
    }
  }

  const balances: BucketBalance[] = buckets
    .filter((bucket) => !bucket.archived)
    .map((bucket) => {
      const accumulator = accumulators.get(bucket.id)
      return {
        bucket,
        totals: mapToBuckets(accumulator?.totals ?? new Map()),
        monthIn: mapToBuckets(accumulator?.monthIn ?? new Map()),
        monthOut: mapToBuckets(accumulator?.monthOut ?? new Map()),
      }
    })

  const negativeWarnings = balances.flatMap((balance) =>
    balance.totals
      .filter((total) => total.amount < 0)
      .map((total) => `${balance.bucket.name} is below zero: ${formatMoney(total.amount, total.currency)}`),
  )

  return { balances, monthIncome: mapToBuckets(monthIncome), monthSpending: mapToBuckets(monthSpending), negativeWarnings }
}

/**
 * Month "money in" and "spent" totals, optionally narrowed to buckets owned by `owners`.
 * Same rules as the dashboard summary: income counts income-type transactions; spending
 * counts expense-type from non-business buckets. `owners = null` means every owner.
 */
export function monthFlowTotals(
  buckets: Bucket[],
  transactions: Transaction[],
  monthKey: string,
  owners: BucketOwner[] | null,
): { income: MoneyBucket[]; spending: MoneyBucket[] } {
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]))
  const income = new Map<string, number>()
  const spending = new Map<string, number>()
  const ownerAllowed = (bucketId: string) => {
    if (!owners) return true
    const owner = bucketById.get(bucketId)?.ownerId
    return owner ? owners.includes(owner) : false
  }

  for (const transaction of transactions) {
    if (monthKeyFromDate(transaction.date) !== monthKey) continue
    if (transaction.type === 'income' && ownerAllowed(transaction.bucketId)) {
      addMoney(income, transaction.currency, transaction.amount)
    }
    if (
      transaction.type === 'expense' &&
      bucketById.get(transaction.bucketId)?.kind !== 'business' &&
      ownerAllowed(transaction.bucketId)
    ) {
      addMoney(spending, transaction.currency, transaction.amount)
    }
  }

  return { income: mapToBuckets(income), spending: mapToBuckets(spending) }
}

export function balanceForBucket(snapshot: LedgerSnapshot, bucketId: string): MoneyBucket[] {
  return snapshot.balances.find((balance) => balance.bucket.id === bucketId)?.totals ?? []
}

/**
 * Money in vs spent per month for one currency, oldest month first. Same rules as
 * `monthFlowTotals`: income-type counts as money in; expenses from non-business
 * buckets count as spent; `owners = null` means every owner.
 */
export function monthTrend(
  buckets: Bucket[],
  transactions: Transaction[],
  endMonthKey: string,
  count: number,
  owners: BucketOwner[] | null,
  currency: string,
): Array<{ monthKey: string; income: number; spending: number }> {
  const rows = monthKeysEndingAt(endMonthKey, count).map((monthKey) => ({ monthKey, income: 0, spending: 0 }))
  const rowByMonth = new Map(rows.map((row) => [row.monthKey, row]))
  const inScope = scopeFilter(buckets, owners)

  for (const transaction of transactions) {
    if (transaction.currency !== currency) continue
    const row = rowByMonth.get(monthKeyFromDate(transaction.date))
    if (!row) continue
    if (isScopedIncome(transaction, inScope)) row.income = roundMoney(row.income + transaction.amount)
    if (isScopedSpending(transaction, inScope)) row.spending = roundMoney(row.spending + transaction.amount)
  }
  return rows
}

/** Spending of one month and currency per category id ('' = uncategorized), same rules as the month "Spent" total. */
export function spendingByCategory(
  buckets: Bucket[],
  transactions: Transaction[],
  monthKey: string,
  owners: BucketOwner[] | null,
  currency: string,
): Map<string, number> {
  const inScope = scopeFilter(buckets, owners)
  const totals = new Map<string, number>()
  for (const transaction of transactions) {
    if (transaction.currency !== currency || monthKeyFromDate(transaction.date) !== monthKey) continue
    if (!isScopedSpending(transaction, inScope)) continue
    const key = transaction.categoryId ?? ''
    totals.set(key, roundMoney((totals.get(key) ?? 0) + transaction.amount))
  }
  return totals
}

/** Currencies that have any income or spending in the given months, most used first. */
export function activeCurrencies(transactions: Transaction[], monthKeys: string[]): string[] {
  const months = new Set(monthKeys)
  const counts = new Map<string, number>()
  for (const transaction of transactions) {
    if (transaction.type !== 'income' && transaction.type !== 'expense') continue
    if (!months.has(monthKeyFromDate(transaction.date))) continue
    counts.set(transaction.currency, (counts.get(transaction.currency) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([currency]) => currency)
}

type ScopeFilter = { bucketById: Map<string, Bucket>; ownerAllowed: (bucketId: string) => boolean }

function scopeFilter(buckets: Bucket[], owners: BucketOwner[] | null): ScopeFilter {
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]))
  return {
    bucketById,
    ownerAllowed: (bucketId) => {
      if (!owners) return true
      const owner = bucketById.get(bucketId)?.ownerId
      return owner ? owners.includes(owner) : false
    },
  }
}

function isScopedIncome(transaction: Transaction, scope: ScopeFilter) {
  return transaction.type === 'income' && scope.ownerAllowed(transaction.bucketId)
}

function isScopedSpending(transaction: Transaction, scope: ScopeFilter) {
  return (
    transaction.type === 'expense' &&
    scope.bucketById.get(transaction.bucketId)?.kind !== 'business' &&
    scope.ownerAllowed(transaction.bucketId)
  )
}
