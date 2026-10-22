import type { FitnessGoal, FitnessProfile, Meal, OwnerId, Workout } from '../types'
import type { WeekDay } from '../lib/fitness'

export const PEOPLE: Array<{ id: OwnerId; name: string }> = [
  { id: 'moon', name: 'Moon' },
  { id: 'alena', name: 'Alena' },
]

export const otherPerson = (id: OwnerId): OwnerId => (id === 'moon' ? 'alena' : 'moon')
export const personName = (id: OwnerId) => PEOPLE.find((person) => person.id === id)?.name ?? id

export interface FitnessData {
  realmId?: string
  today: string
  workouts: Workout[]
  meals: Meal[]
  goals: FitnessGoal[]
  profiles: FitnessProfile[]
}

/** Lets a screen offer an Undo toast after a delete. */
export type OnDeleted = (label: string, undo: () => Promise<void>) => void

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

/** Parses a user-typed number; empty → undefined, invalid → NaN. */
export function parseNumber(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function Ring({
  ratio,
  label,
  value,
  target,
  unit,
  tone,
}: {
  ratio: number
  label: string
  value: number
  target: number
  unit: string
  tone: 'leaf' | 'amber' | 'blue'
}) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const done = ratio >= 1
  return (
    <div className={`fit-ring ${tone}${done ? ' done' : ''}`} role="img" aria-label={`${label}: ${formatNumber(value)} of ${formatNumber(target)} ${unit}`}>
      <svg viewBox="0 0 80 80" width="92" height="92" aria-hidden="true">
        <circle className="fit-ring-track" cx="40" cy="40" r={radius} />
        {ratio > 0 ? (
          <circle
            className="fit-ring-fill"
            cx="40"
            cy="40"
            r={radius}
            strokeDasharray={`${circumference * ratio} ${circumference}`}
            transform="rotate(-90 40 40)"
          />
        ) : null}
      </svg>
      <div className="fit-ring-text">
        <strong>{formatNumber(value)}</strong>
        <span>/ {formatNumber(target)}</span>
      </div>
      <p>
        {label} <small>{unit}</small>
      </p>
    </div>
  )
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="fit-spark-empty">Log it again to see progress</span>
  const width = 120
  const height = 36
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * (width - 6) + 3
    const y = height - 4 - ((value - min) / span) * (height - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = points[points.length - 1].split(',')
  return (
    <svg className="fit-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <polyline points={points.join(' ')} fill="none" />
      <circle cx={last[0]} cy={last[1]} r="3" />
    </svg>
  )
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function WeekDots({ days, compact = false }: { days: WeekDay[]; compact?: boolean }) {
  return (
    <div className={`fit-week${compact ? ' compact' : ''}`} role="img" aria-label={`${days.filter((day) => day.trained).length} training days this week`}>
      {days.map((day, index) => (
        <span key={day.date} className={`fit-dot${day.trained ? ' on' : ''}${day.isToday ? ' today' : ''}${day.isFuture ? ' future' : ''}`}>
          <i />
          <small>{WEEKDAY_LETTERS[index]}</small>
        </span>
      ))}
    </div>
  )
}

export function PersonSwitch({ person, onChange }: { person: OwnerId; onChange: (person: OwnerId) => void }) {
  return (
    <div className="segmented-control fit-person" role="group" aria-label="Whose fitness">
      {PEOPLE.map(({ id, name }) => (
        <button key={id} type="button" className={person === id ? 'active' : ''} aria-pressed={person === id} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  )
}
