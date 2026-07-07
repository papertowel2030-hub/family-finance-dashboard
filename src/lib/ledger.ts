import type { Bucket, BucketBalance, LedgerSnapshot, MoneyBucket, Transaction } from '../types'
import { monthKeyFromDate } from '../utils/date'
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

  return { balances, negativeWarnings }
}

export function balanceForBucket(snapshot: LedgerSnapshot, bucketId: string): MoneyBucket[] {
  return snapshot.balances.find((balance) => balance.bucket.id === bucketId)?.totals ?? []
}
