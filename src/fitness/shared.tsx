import { AlertTriangle, Check, Moon, Trash2 } from 'lucide-react'
import { deleteWorkout, restoreWorkout } from '../db/fitnessActions'
import type { DayInfo, WeekDay } from '../lib/fitness'
import type { FitnessGoal, FitnessProfile, Meal, OwnerId, Workout } from '../types'
import { REST_ENTRY_NOTE } from './copy'

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

export function WeekDots({
  days,
  compact = false,
  selected,
  onSelect,
}: {
  days: WeekDay[]
  compact?: boolean
  selected?: string
  onSelect?: (date: string) => void
}) {
  const trained = days.filter((day) => day.trained).length
  const rested = days.filter((day) => day.rest).length
  return (
    <div className={`fit-week${compact ? ' compact' : ''}`} role={onSelect ? 'group' : 'img'} aria-label={`${trained} training days, ${rested} rest days this week`}>
      {days.map((day, index) => {
        const className = `fit-dot${day.trained ? ' on' : ''}${day.rest ? ' rest' : ''}${day.isToday ? ' today' : ''}${day.isFuture ? ' future' : ''}${selected === day.date ? ' selected' : ''}`
        const state = day.trained ? 'trained' : day.rest ? 'rest day' : day.isFuture ? 'upcoming' : 'not logged'
        const body = (
          <>
            <i>{day.trained ? <Check size={compact ? 12 : 18} strokeWidth={3} /> : day.rest ? <Moon size={compact ? 11 : 16} /> : null}</i>
            <small>{WEEKDAY_LETTERS[index]}</small>
          </>
        )
        return onSelect ? (
          <button key={day.date} type="button" className={className} aria-pressed={selected === day.date} aria-label={`${day.date}, ${state}`} onClick={() => onSelect(day.date)}>
            {body}
          </button>
        ) : (
          <span key={day.date} className={className}>
            {body}
          </span>
        )
      })}
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

export function describeWorkout(workout: Workout) {
  if (workout.kind === 'strength') {
    const sets = workout.sets ?? []
    if (!sets.length) return 'Session logged'
    const grouped = sets.map((set) => `${set.reps}×${set.weight ? formatNumber(set.weight) : 'BW'}`).join(', ')
    return `${sets.length} set${sets.length === 1 ? '' : 's'} · ${grouped}${sets.some((set) => set.weight) ? ' kg' : ''}`
  }
  const parts = [workout.minutes ? `${formatNumber(workout.minutes)} min` : '']
  if (workout.distance) parts.push(`${formatNumber(workout.distance)} km`)
  if (workout.effort) parts.push(`effort ${workout.effort}/5`)
  return parts.filter(Boolean).join(' · ') || 'Session logged'
}

const KIND_LABEL: Record<Workout['kind'], string> = { strength: 'Strength', cardio: 'Endurance', sport: 'Sport', rest: 'Rest' }
export const kindLabel = (kind: Workout['kind']) => KIND_LABEL[kind]

/** What happened on one day: every workout (tap to edit) or the rest marker (tap to remove). */
export function DayEntries({
  info,
  onEdit,
  onDeleted,
  empty,
}: {
  info: DayInfo | undefined
  onEdit: (workout: Workout) => void
  onDeleted: OnDeleted
  empty: string
}) {
  if (!info || (!info.workouts.length && !info.restEntries.length)) return <p className="empty-state">{empty}</p>
  return (
    <ul className="fit-day-entries">
      {info.workouts.map((workout) => (
        <li key={workout.id}>
          <button type="button" onClick={() => onEdit(workout)}>
            <span className={`type-chip fit-kind ${workout.kind}`}>{kindLabel(workout.kind)}</span>
            <span className="fit-history-main">
              <strong>
                {workout.title}
                {workout.niggle ? <AlertTriangle size={14} className="fit-niggle" aria-label="Something hurt" /> : null}
              </strong>
              <small>{describeWorkout(workout)}</small>
              {workout.note ? <small className="fit-history-note">{workout.note}</small> : null}
            </span>
          </button>
        </li>
      ))}
      {info.restEntries.map((rest) => (
        <li key={rest.id} className="rest">
          <div>
            <span className="type-chip fit-kind rest">
              <Moon size={13} /> Rest
            </span>
            <span className="fit-history-main">
              <strong>Rest day</strong>
              <small>{REST_ENTRY_NOTE}</small>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove rest day"
              onClick={async () => {
                await deleteWorkout(rest.id)
                onDeleted('Removed rest day', () => restoreWorkout(rest))
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
