import { describe, expect, it } from 'vitest'
import { computeLedger, monthFlowTotals } from './ledger'
import type { Bucket, Transaction, TransactionType } from '../types'

const now = '2026-07-01T00:00:00.000Z'

function bucket(id: string, name: string, kind: Bucket['kind'], ownerId: Bucket['ownerId'] = 'shared'): Bucket {
  return { id, name, ownerId, kind, createdAt: now, updatedAt: now }
}

let counter = 0
function txn(
  type: TransactionType,
  bucketId: string,
  amount: number,
  date: string,
  extra: Partial<Transaction> = {},
): Transaction {
  counter += 1
  return {
    id: `txn_${counter}`,
    date,
    type,
    amount,
    currency: 'RUB',
    bucketId,
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

const alena = bucket('b_alena', 'Alena', 'spending', 'alena')
const family = bucket('b_family', 'Family', 'spending', 'shared')
const business = bucket('b_biz', 'Business 1', 'business', 'shared')
const savings = bucket('b_save', 'Savings', 'savings', 'shared')

describe('computeLedger', () => {
  it('sums income and expenses per bucket', () => {
    const snapshot = computeLedger(
      [alena, family],
      [
        txn('income', alena.id, 50000, '2026-07-02'),
        txn('income', alena.id, 30000, '2026-07-05'),
        txn('expense', alena.id, 12000, '2026-07-06'),
        txn('expense', family.id, 4000, '2026-07-06'),
      ],
    )

    expect(snapshot.balances.find((b) => b.bucket.id === alena.id)?.totals).toEqual([{ currency: 'RUB', amount: 68000 }])
    expect(snapshot.balances.find((b) => b.bucket.id === family.id)?.totals).toEqual([{ currency: 'RUB', amount: -4000 }])
    expect(snapshot.negativeWarnings).toHaveLength(1)
    expect(snapshot.negativeWarnings[0]).toContain('Family')
  })

  it('keeps business funding separate and carries leftovers across months', () => {
    const snapshot = computeLedger(
      [business],
      [
        txn('funding', business.id, 20000, '2026-06-01'),
        txn('expense', business.id, 15000, '2026-06-20'),
        txn('expense', business.id, 3000, '2026-07-03'),
      ],
      '2026-07',
    )

    const balance = snapshot.balances[0]
    // 20000 funded in June, 18000 spent overall: 2000 remains in July.
    expect(balance.totals).toEqual([{ currency: 'RUB', amount: 2000 }])
    expect(balance.monthIn).toEqual([])
    expect(balance.monthOut).toEqual([{ currency: 'RUB', amount: 3000 }])
  })

  it('moves money between buckets on transfer', () => {
    const snapshot = computeLedger(
      [family, savings],
      [txn('income', family.id, 10000, '2026-07-01'), txn('transfer', family.id, 2500, '2026-07-02', { toBucketId: savings.id })],
    )

    expect(snapshot.balances.find((b) => b.bucket.id === family.id)?.totals).toEqual([{ currency: 'RUB', amount: 7500 }])
    expect(snapshot.balances.find((b) => b.bucket.id === savings.id)?.totals).toEqual([{ currency: 'RUB', amount: 2500 }])
  })

  it('applies signed adjustments', () => {
    const snapshot = computeLedger(
      [savings],
      [txn('adjustment', savings.id, 100000, '2026-07-01'), txn('adjustment', savings.id, -1500, '2026-07-10')],
    )

    expect(snapshot.balances[0].totals).toEqual([{ currency: 'RUB', amount: 98500 }])
  })

  it('tracks currencies separately inside one bucket', () => {
    const snapshot = computeLedger(
      [alena],
      [
        txn('income', alena.id, 50000, '2026-07-01'),
        txn('income', alena.id, 300, '2026-07-01', { currency: 'USD' }),
        txn('expense', alena.id, 100, '2026-07-02', { currency: 'USD' }),
      ],
    )

    expect(snapshot.balances[0].totals).toEqual([
      { currency: 'RUB', amount: 50000 },
      { currency: 'USD', amount: 200 },
    ])
  })

  it('reports month in/out for the requested month only', () => {
    const snapshot = computeLedger(
      [alena],
      [
        txn('income', alena.id, 40000, '2026-06-15'),
        txn('income', alena.id, 45000, '2026-07-15'),
        txn('expense', alena.id, 9000, '2026-07-16'),
      ],
      '2026-07',
    )

    const balance = snapshot.balances[0]
    expect(balance.totals).toEqual([{ currency: 'RUB', amount: 76000 }])
    expect(balance.monthIn).toEqual([{ currency: 'RUB', amount: 45000 }])
    expect(balance.monthOut).toEqual([{ currency: 'RUB', amount: 9000 }])
  })

  it('summarizes the month across buckets, leaving business money out', () => {
    const snapshot = computeLedger(
      [alena, family, business],
      [
        txn('income', alena.id, 80000, '2026-07-01'),
        txn('income', family.id, 500, '2026-07-02', { currency: 'USD' }),
        txn('funding', business.id, 20000, '2026-07-03'),
        txn('expense', family.id, 12000, '2026-07-04'),
        txn('expense', business.id, 5000, '2026-07-05'),
        txn('transfer', alena.id, 9000, '2026-07-06', { toBucketId: family.id }),
        txn('income', alena.id, 70000, '2026-06-15'),
      ],
      '2026-07',
    )

    // Funding and business expenses stay out; June income stays out; transfers are not income or spending.
    expect(snapshot.monthIncome).toEqual([
      { currency: 'RUB', amount: 80000 },
      { currency: 'USD', amount: 500 },
    ])
    expect(snapshot.monthSpending).toEqual([{ currency: 'RUB', amount: 12000 }])
  })

  it('hides archived buckets', () => {
    const archived = { ...bucket('b_old', 'Old', 'spending'), archived: true }
    const snapshot = computeLedger([alena, archived], [txn('income', archived.id, 1000, '2026-07-01')])

    expect(snapshot.balances.map((balance) => balance.bucket.id)).toEqual([alena.id])
  })
})

describe('monthFlowTotals', () => {
  const moon = bucket('b_moon', 'Moon', 'spending', 'moon')
  const all = [moon, alena, family, business]
  const transactions = [
    txn('income', moon.id, 100000, '2026-07-01'),
    txn('income', alena.id, 60000, '2026-07-02'),
    txn('income', family.id, 5000, '2026-07-02'),
    txn('funding', business.id, 20000, '2026-07-03'),
    txn('expense', moon.id, 8000, '2026-07-04'),
    txn('expense', family.id, 3000, '2026-07-04'),
    txn('expense', business.id, 5000, '2026-07-05'),
    txn('income', moon.id, 999, '2026-06-15'),
  ]

  it('totals everyone when no owners are given', () => {
    const totals = monthFlowTotals(all, transactions, '2026-07', null)
    // Moon + Alena + Family income; business funding excluded; June excluded.
    expect(totals.income).toEqual([{ currency: 'RUB', amount: 165000 }])
    // Moon + Family expenses; business expense excluded.
    expect(totals.spending).toEqual([{ currency: 'RUB', amount: 11000 }])
  })

  it('narrows to the viewer plus shared, leaving the partner out', () => {
    const totals = monthFlowTotals(all, transactions, '2026-07', ['moon', 'shared'])
    // Moon (100000) + Family (5000); Alena's 60000 excluded.
    expect(totals.income).toEqual([{ currency: 'RUB', amount: 105000 }])
    // Moon (8000) + Family (3000).
    expect(totals.spending).toEqual([{ currency: 'RUB', amount: 11000 }])
  })
})
