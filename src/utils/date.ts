const MSK_TIME_ZONE = 'Europe/Moscow'

export function todayInputDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MSK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '2026'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

export function monthKeyFromDate(date: string) {
  return date.slice(0, 7)
}

export function currentMonthKey() {
  return monthKeyFromDate(todayInputDate())
}

export function endDateForMonth(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`
}

export function nextMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(monthKey: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: MSK_TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthKey}-01T12:00:00+03:00`))
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: MSK_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00+03:00`))
}
