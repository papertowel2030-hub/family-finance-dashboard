import { describe, expect, it } from 'vitest'
import type { Bucket, Category, IncomeSource, Transaction } from '../types'
import { recentValues, searchTransactions, type Names } from './activity'

const stamp = '2026-10-01T00:00:00.000Z'
const bucket = (id: string, name: string): Bucket => ({ id, name, ownerId: 'moon', kind: 'spending', createdAt: stamp, updatedAt: stamp })
const names: Names = {
  buckets: [bucket('b1', 'Cash - M'), bucket('b2', 'Salon')],
  sources: [{ id: 's1', name: 'Teaching', createdAt: stamp, updatedAt: stamp } as IncomeSource],
  categories: [{ id: 'c1', name: 'Groceries', createdAt: stamp, updatedAt: stamp } as Category],
  typeLabels: { income: 'Income', funding: 'Business funding', expense: 'Expense', transfer: 'Transfer', adjustment: 'Balance fix' },
}
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  date: '2026-10-20',
  type: 'expense',
  amount: 100,
  currency: 'RUB',
  bucketId: 'b1',
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
})

describe('searchTransactions', () => {
  const list = [
    txn({ id: 'a', note: 'Kamil 21 October', bucketId: 'b2', amount: 6550 }),
    txn({ id: 'b', categoryId: 'c1', amount: 42.5 }),
    txn({ id: 'c', type: 'income', sourceId: 's1', date: '2026-09-03' }),
    txn({ id: 'd', type: 'transfer', bucketId: 'b2', toBucketId: 'b1' }),
  ]
  const ids = (query: string) => searchTransactions(list, query, names).map((item) => item.id)

  it('keeps everything for an empty or blank query', () => {
    expect(ids('')).toEqual(['a', 'b', 'c', 'd'])
    expect(ids('   ')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('finds by note, case-insensitively', () => expect(ids('kamil')).toEqual(['a']))
  it('finds by category, source and type label', () => {
    expect(ids('grocer')).toEqual(['b'])
    expect(ids('teach')).toEqual(['c'])
    expect(ids('transfer')).toEqual(['d'])
  })
  it('finds by either bucket of a transfer', () => expect(ids('cash')).toEqual(['b', 'c', 'd']))
  it('finds by amount and by date', () => {
    expect(ids('6550')).toEqual(['a'])
    expect(ids('42.50')).toEqual(['b'])
    expect(ids('2026-09')).toEqual(['c'])
  })
  it('needs every word to match, in any order', () => {
    expect(ids('october salon')).toEqual(['a'])
    expect(ids('kamil teaching')).toEqual([])
  })
})

describe('recentValues', () => {
  it('lists distinct values, newest first, up to the limit', () => {
    const list = [txn({ categoryId: 'x' }), txn({ categoryId: 'y' }), txn({ categoryId: 'x' }), txn({}), txn({ categoryId: 'z' })]
    expect(recentValues(list, (item) => item.categoryId, 5)).toEqual(['x', 'y', 'z'])
    expect(recentValues(list, (item) => item.categoryId, 2)).toEqual(['x', 'y'])
  })
})
