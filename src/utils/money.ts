import type { MoneyBucket } from '../types'

const RUB_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})

export function formatMoney(amount: number, currency = 'RUB') {
  if (currency === 'RUB') {
    return RUB_FORMAT.format(amount).replace('RUB', '₽')
  }

  return `${NUMBER_FORMAT.format(amount)} ${currency}`
}

export function formatBuckets(buckets: MoneyBucket[], empty = '0 ₽') {
  if (!buckets.length) return empty
  return buckets.map((bucket) => formatMoney(bucket.amount, bucket.currency)).join(' · ')
}

export function parseAmount(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
