import { useState } from 'react'
import { AlertTriangle, Check, Moon, Trash2 } from 'lucide-react'
import { deleteWorkout, QUICK_TITLES, restoreWorkout } from '../db/fitnessActions'
import { formatDuration, formatSeconds, holdLabel, intervalSummary, paceText, sessionLoad, type DayInfo, type WeekDay } from '../lib/fitness'
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

/** Whole minutes read as "30 min"; anything with seconds as "25:30". */
export function formatMinutes(minutes: number) {
  return Number.isInteger(Math.round(minutes * 60) / 60) ? `${formatNumber(minutes)} min` : formatDuration(minutes)
}

export function describeWorkout(workout: Workout) {
  const parts: string[] = []
  if (workout.kind === 'strength') {
    const sets = workout.sets ?? []
    if (sets.length) {
      const grouped = sets.map((set) => `${set.reps}×${set.weight ? formatNumber(set.weight) : 'BW'}`).join(', ')
      parts.push(`${sets.length} set${sets.length === 1 ? '' : 's'} · ${grouped}${sets.some((set) => set.weight) ? ' kg' : ''}`)
    }
    const holds = workout.holds ?? []
    if (holds.length) {
      const times = holds.map((hold) => `${holdLabel(hold.sec)}${hold.weight ? ` +${formatNumber(hold.weight)} kg` : ''}`).join(', ')
      parts.push(`${holds.length} hold${holds.length === 1 ? '' : 's'} · ${times}`)
    }
  }
  if (workout.segments?.length) {
    const summary = intervalSummary(workout.segments)
    parts.push(`${summary.rounds} × ${summary.workPartSec ? formatSeconds(summary.workPartSec) : '—'}${summary.topWorkSpeed ? ` @ ${formatNumber(summary.topWorkSpeed)} km/h` : ''}`)
  }
  // A moved plank keeps its time as session minutes; don't print 1:30 twice.
  const holdSec = (workout.holds ?? []).reduce((sum, hold) => sum + hold.sec, 0)
  const sameAsHolds = holdSec > 0 && workout.minutes !== undefined && Math.abs(workout.minutes * 60 - holdSec) < 1
  if (workout.minutes && !sameAsHolds) parts.push(workout.segments?.length ? `total ${formatDuration(workout.minutes)}` : formatMinutes(workout.minutes))
  if (workout.distance) parts.push(`${formatNumber(workout.distance)} km`)
  const pace = workout.kind === 'cardio' && !workout.segments?.length ? paceText(workout.title, workout.minutes, workout.distance) : null
  if (pace) parts.push(pace)
  return parts.join(' · ') || 'Session logged'
}

/** "RPE 7 · load 315", or null when the entry has no rating yet. */
export function describeIntensity(workout: Workout) {
  if (workout.rpe === undefined) return null
  const load = sessionLoad(workout)
  return `RPE ${workout.rpe}${load !== null ? ` · load ${formatNumber(load)}` : ' · add time for load'}`
}

/** The intensity line for any entry: rating and load, or an honest "unrated". */
export function intensityText(workout: Workout) {
  return describeIntensity(workout) ?? (workout.effort ? `effort ${workout.effort}/5 (old scale) · tap to rate 0–10` : 'Unrated · tap to rate')
}

/**
 * Kinds named the way WHO/ACSM group exercise: resistance (muscle-strengthening, incl. holds),
 * cardio (aerobic), and sport. Stored ids stay 'strength'/'cardio' so old data and phones keep working.
 */
const KIND_LABEL: Record<Workout['kind'], string> = { strength: 'Resistance', cardio: 'Cardio', sport: 'Sport', rest: 'Rest' }
export const kindLabel = (kind: Workout['kind']) => KIND_LABEL[kind]

export const KIND_HINT: Record<Exclude<Workout['kind'], 'rest'>, string> = {
  strength: 'Weights, bodyweight, holds',
  cardio: 'Run, cycle, swim, row',
  sport: 'Games, classes, yoga',
}

/** One-tap entries are stored as "Strength"/"Endurance"; show them under today's names. */
export const displayTitle = (workout: Workout) =>
  workout.kind !== 'rest' && workout.title === QUICK_TITLES[workout.kind] ? KIND_LABEL[workout.kind] : workout.title

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
                {displayTitle(workout)}
                {workout.niggle ? <AlertTriangle size={14} className="fit-niggle" aria-label="Something hurt" /> : null}
              </strong>
              <small>{describeWorkout(workout)}</small>
              <small className={`fit-intensity${workout.rpe === undefined ? ' unrated' : ''}`}>
                {intensityText(workout)}
              </small>
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

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000

/**
 * Progress line over real time (gaps stay gaps). Gold dots mark new personal bests; tap any dot
 * to read its value. Dependency-free SVG, scales to its container.
 */
export function LineChart({
  points,
  unit,
  records = [],
  label,
  formatDate,
}: {
  points: Array<{ date: string; value: number }>
  unit: string
  records?: number[]
  label: string
  formatDate: (date: string) => string
}) {
  const [picked, setPicked] = useState<number | null>(null)
  if (!points.length) return null
  const width = 320
  const height = 168
  const left = 38
  const right = 12
  const top = 14
  const bottom = 24
  const values = points.map((point) => point.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin) * 0.12 || Math.max(1, rawMax * 0.1)
  const min = Math.max(0, rawMin - pad)
  const max = rawMax + pad
  const firstDay = dayNumber(points[0].date)
  const lastDay = dayNumber(points[points.length - 1].date)
  const spanDays = lastDay - firstDay
  const x = (date: string) => (spanDays ? left + ((dayNumber(date) - firstDay) / spanDays) * (width - left - right) : (left + width - right) / 2)
  const y = (value: number) => top + (1 - (value - min) / (max - min)) * (height - top - bottom)
  const coords = points.map((point) => [x(point.date), y(point.value)] as const)
  const active = picked ?? points.length - 1
  const recordSet = new Set(records)
  const ticks = [min, (min + max) / 2, max]

  return (
    <figure className="fit-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="fit-chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text className="fit-chart-axis" x={left - 6} y={y(tick) + 3} textAnchor="end">
              {formatNumber(Math.round(tick * 10) / 10)}
            </text>
          </g>
        ))}
        <text className="fit-chart-axis" x={left} y={height - 6} textAnchor="start">
          {formatDate(points[0].date)}
        </text>
        {points.length > 1 ? (
          <text className="fit-chart-axis" x={width - right} y={height - 6} textAnchor="end">
            {formatDate(points[points.length - 1].date)}
          </text>
        ) : null}
        {coords.length > 1 ? <polyline className="fit-chart-line" points={coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')} /> : null}
        {coords.map(([px, py], index) => (
          <g key={points[index].date}>
            <circle className={`fit-chart-dot${recordSet.has(index) ? ' record' : ''}${index === active ? ' active' : ''}`} cx={px} cy={py} r={index === active ? 5.5 : recordSet.has(index) ? 4.5 : 3.5} />
            <circle
              className="fit-chart-hit"
              cx={px}
              cy={py}
              r={12}
              role="button"
              tabIndex={0}
              aria-label={`${formatDate(points[index].date)}: ${formatNumber(points[index].value)} ${unit}`}
              onClick={() => setPicked(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setPicked(index)
              }}
            />
          </g>
        ))}
      </svg>
      <figcaption>
        <strong>
          {formatNumber(points[active].value)} {unit}
        </strong>{' '}
        on {formatDate(points[active].date)}
        {recordSet.has(active) ? <span className="fit-chart-pb"> · new best</span> : null}
      </figcaption>
    </figure>
  )
}
