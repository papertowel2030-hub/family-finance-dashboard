import { useMemo, useState } from 'react'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { addDays, exerciseHistory } from '../lib/fitness'
import type { OwnerId, Workout, WorkoutKind } from '../types'
import { formatShortDate } from '../utils/date'
import { formatNumber, Sparkline, type FitnessData } from './shared'

type Filter = 'all' | WorkoutKind

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'strength', label: 'Strength' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'sport', label: 'Sport' },
]

const PAGE_SIZE = 15
const MAX_PROGRESS_CARDS = 8

export function describeWorkout(workout: Workout) {
  if (workout.kind === 'strength') {
    const sets = workout.sets ?? []
    const grouped = sets.map((set) => `${set.reps}×${set.weight ? formatNumber(set.weight) : 'BW'}`).join(', ')
    return `${sets.length} set${sets.length === 1 ? '' : 's'} · ${grouped}${sets.some((set) => set.weight) ? ' kg' : ''}`
  }
  const parts = [workout.minutes ? `${formatNumber(workout.minutes)} min` : '']
  if (workout.distance) parts.push(`${formatNumber(workout.distance)} km`)
  if (workout.effort) parts.push(`effort ${workout.effort}/5`)
  return parts.filter(Boolean).join(' · ')
}

export function JournalTab({ data, person, onEdit }: { data: FitnessData; person: OwnerId; onEdit: (workout: Workout) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(PAGE_SIZE)

  const mine = useMemo(() => data.workouts.filter((workout) => workout.ownerId === person), [data.workouts, person])
  const visible = useMemo(
    () =>
      mine
        .filter((workout) => filter === 'all' || workout.kind === filter)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [mine, filter],
  )

  const exercises = useMemo(() => {
    if (filter !== 'all' && filter !== 'strength') return []
    const titles = new Map<string, string>()
    mine
      .filter((workout) => workout.kind === 'strength')
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((workout) => {
        const key = workout.title.trim().toLowerCase()
        if (!titles.has(key)) titles.set(key, workout.title.trim())
      })
    return [...titles.values()].slice(0, MAX_PROGRESS_CARDS).map((title) => ({ title, history: exerciseHistory(mine, person, title) }))
  }, [mine, person, filter])

  const weekFrom = addDays(data.today, -6)
  const weekMinutes = mine
    .filter((workout) => workout.kind !== 'strength' && workout.date >= weekFrom && workout.date <= data.today)
    .filter((workout) => filter === 'all' || workout.kind === filter)
    .reduce((sum, workout) => sum + (workout.minutes ?? 0), 0)

  return (
    <div className="fit-stack">
      <section className="panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>Progress &amp; history</h2>
          </div>
          <div className="segmented-control" role="group" aria-label="Filter journal">
            {FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={filter === id ? 'active' : ''}
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id)
                  setShown(PAGE_SIZE)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filter !== 'strength' ? (
          <p className="small-label fit-week-minutes">
            Cardio &amp; sport, last 7 days: <strong>{formatNumber(weekMinutes)} min</strong>
          </p>
        ) : null}

        {exercises.length ? (
          <div className="fit-progress-grid">
            {exercises.map(({ title, history }) => {
              const latest = history[history.length - 1]
              const first = history[0]
              const metric = (point: (typeof history)[number]) => point.oneRepMax ?? point.bestWeight
              const gain = latest && first && history.length > 1 ? metric(latest) - metric(first) : 0
              return (
                <article key={title} className="fit-progress-card">
                  <h3>{title}</h3>
                  <p className="small-label">
                    Best {latest ? `${formatNumber(latest.bestWeight)} kg × ${latest.bestReps}` : '—'}
                    {latest?.oneRepMax ? ` · est. 1RM ${formatNumber(latest.oneRepMax)} kg` : ''}
                  </p>
                  <Sparkline values={history.slice(-10).map(metric)} label={`${title} progress`} />
                  {gain ? (
                    <p className={`fit-gain${gain > 0 ? ' up' : ''}`}>
                      <TrendingUp size={14} /> {gain > 0 ? '+' : ''}
                      {formatNumber(gain)} kg since {formatShortDate(first.date)}
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-header compact">
          <h2>History</h2>
        </div>
        {visible.length ? (
          <>
            <ul className="fit-history">
              {visible.slice(0, shown).map((workout) => (
                <li key={workout.id}>
                  <button type="button" onClick={() => onEdit(workout)}>
                    <span className={`type-chip fit-kind ${workout.kind}`}>{workout.kind}</span>
                    <span className="fit-history-main">
                      <strong>
                        {workout.title}
                        {workout.niggle ? <AlertTriangle size={14} className="fit-niggle" aria-label="Something hurt" /> : null}
                      </strong>
                      <small>{describeWorkout(workout)}</small>
                      {workout.note ? <small className="fit-history-note">{workout.note}</small> : null}
                    </span>
                    <time dateTime={workout.date}>{formatShortDate(workout.date)}</time>
                  </button>
                </li>
              ))}
            </ul>
            {visible.length > shown ? (
              <button type="button" className="ghost-button show-more-button" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                Show more ({visible.length - shown} left)
              </button>
            ) : null}
          </>
        ) : (
          <p className="empty-state">Nothing here yet. Log your first workout from the Log tab.</p>
        )}
      </section>
    </div>
  )
}
