import type { Bucket, Category, IncomeSource, Transaction, TransactionType } from '../types'

export interface Names {
  buckets: Bucket[]
  sources: IncomeSource[]
  categories: Category[]
  typeLabels: Record<TransactionType, string>
}

/** Everything a person might type to find an entry, lowercased: note, buckets, source, category, type, date, amount. */
function haystack(transaction: Transaction, names: Names) {
  const bucket = (id?: string) => names.buckets.find((item) => item.id === id)?.name ?? ''
  return [
    transaction.note,
    bucket(transaction.bucketId),
    bucket(transaction.toBucketId),
    names.sources.find((item) => item.id === transaction.sourceId)?.name,
    names.categories.find((item) => item.id === transaction.categoryId)?.name,
    names.typeLabels[transaction.type],
    transaction.date,
    String(transaction.amount),
    transaction.amount.toFixed(2),
    transaction.currency,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Keeps entries that contain every word of the query (any order, any field). An empty query keeps everything. */
export function searchTransactions(transactions: Transaction[], query: string, names: Names) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return transactions
  return transactions.filter((transaction) => {
    const text = haystack(transaction, names)
    return words.every((word) => text.includes(word))
  })
}

/** Distinct values in the order they were last used, most recent first. Expects newest-first input. */
export function recentValues(transactions: Transaction[], pick: (transaction: Transaction) => string | undefined, limit: number) {
  const seen: string[] = []
  for (const transaction of transactions) {
    const value = pick(transaction)
    if (value && !seen.includes(value)) seen.push(value)
    if (seen.length >= limit) break
  }
  return seen
}
