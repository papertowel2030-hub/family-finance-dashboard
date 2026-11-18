import { useMemo, useState } from 'react'
import { Search, Trophy, Zap } from 'lucide-react'
import { QUICK_TITLES } from '../db/fitnessActions'
import {
  exerciseList,
  METRICS,
  metricsFor,
  progressSeries,
  rangeStart,
  summarizeSeries,
  weekStart,
  weeklyLoadSeries,
  type ProgressMetric,
  type ProgressRange,
} from '../lib/fitness'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { describeWorkout, intensityText, formatNumber, kindLabel, LineChart, type FitnessData } from './shared'

const RANGES: ProgressRange[] = ['1M', '3M', '1Y', 'All']
const LOAD_KEY = 'load'
const MAX_CHIPS = 12
const RECENT_SHOWN = 5

const keyOf = (kind: TrainingKind, title: string) => `${kind}|${title.toLowerCase()}`

/** "Nov 3", plus the year when it isn't this year: "Nov 3 ’25". */
function chartDate(date: string, thisYear: string) {
  const text = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  return date.slice(0, 4) === thisYear ? text : `${text} ’${date.slice(2, 4)}`
}

/** Weeks between `from` (inclusive) and today's week, at least 1. */
function weeksSince(from: string, today: string) {
  const days = (Date.parse(`${weekStart(today)}T00:00:00Z`) - Date.parse(`${weekStart(from)}T00:00:00Z`)) / 86_400_000
  return Math.max(1, Math.round(days / 7) + 1)
}

/**
 * Every exercise over time: pick one, pick what to measure, pick a range. Higher is better on every
 * metric here, so the change line reads the same way everywhere.
 */
export function ProgressTab({ data, person, onEdit }: { data: FitnessData; person: OwnerId; onEdit: (workout: Workout) => void }) {
  const { workouts, today } = data
  const thisYear = today.slice(0, 4)
  const exercises = useMemo(() => exerciseList(workouts, person, Object.values(QUICK_TITLES)), [workouts, person])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [metricChoice, setMetricChoice] = useState<ProgressMetric | null>(null)
  const [range, setRange] = useState<ProgressRange>('3M')
  const [search, setSearch] = useState('')

  const selected = selectedKey === LOAD_KEY ? null : (exercises.find((entry) => keyOf(entry.kind, entry.title) === selectedKey) ?? exercises[0] ?? null)
  const showLoad = selectedKey === LOAD_KEY || !selected

  const rows = useMemo(
    () =>
      selected
        ? workouts
            .filter((workout) => workout.ownerId === person && workout.kind === selected.kind && workout.title.trim().toLowerCase() === selected.title.toLowerCase())
            .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
        : [],
    [workouts, person, selected],
  )
  const metrics = selected ? metricsFor(selected.kind, rows) : (['load'] as ProgressMetric[])
  // Open on the first metric that actually has data (an unrated sport shouldn't open on an empty Load chart).
  const firstWithData = useMemo(
    () => (selected ? (metrics.find((option) => progressSeries(rows, person, selected.kind, selected.title, option).length) ?? metrics[0]) : metrics[0]),
    [rows, person, selected?.kind, selected?.title],
  )
  const metric = metricChoice && metrics.includes(metricChoice) ? metricChoice : firstWithData

  const from = rangeStart(range, today)
  const allPoints = useMemo(() => {
    if (showLoad) {
      const earliest = workouts.filter((workout) => workout.ownerId === person).reduce((min, workout) => (workout.date < min ? workout.date : min), today)
      return weeklyLoadSeries(workouts, person, today, Math.min(weeksSince(earliest, today), 520))
    }
    return selected ? progressSeries(workouts, person, selected.kind, selected.title, metric) : []
  }, [showLoad, workouts, person, today, selected, metric])
  const points = from ? allPoints.filter((point) => point.date >= from) : allPoints
  const summary = summarizeSeries(points)
  const unit = METRICS[metric].unit

  const query = search.trim().toLowerCase()
  const chips = (query ? exercises.filter((entry) => entry.title.toLowerCase().includes(query)) : exercises).slice(0, query ? undefined : MAX_CHIPS)
  const hidden = query ? 0 : Math.max(0, exercises.length - MAX_CHIPS)

  const pick = (key: string) => {
    setSelectedKey(key)
    setMetricChoice(null)
  }

  if (!exercises.length) {
    return (
      <div className="fit-stack">
        <section className="panel">
          <h2>Progress</h2>
          <p className="empty-state">Log an exercise with some detail (sets, time, distance or a 0–10) and its line starts here. Ticks alone don’t draw much.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="fit-stack">
      <section className="panel fit-progress-pick">
        <div className="section-header compact">
          <h2>Progress</h2>
          <span className="small-label">{exercises.length} exercises & activities</span>
        </div>
        {exercises.length > 6 ? (
          <label className="fit-search">
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an exercise" aria-label="Find an exercise" />
          </label>
        ) : null}
        <div className="fit-title-chips" role="group" aria-label="Pick what to chart">
          <button type="button" className={`fit-chip pick load${showLoad ? ' on' : ''}`} aria-pressed={showLoad} onClick={() => pick(LOAD_KEY)}>
            <Zap size={14} /> Weekly load
          </button>
          {chips.map((entry) => {
            const key = keyOf(entry.kind, entry.title)
            const on = !showLoad && selected && keyOf(selected.kind, selected.title) === key
            return (
              <button key={key} type="button" className={`fit-chip pick kind-${entry.kind}${on ? ' on' : ''}`} aria-pressed={Boolean(on)} onClick={() => pick(key)}>
                {entry.title}
              </button>
            )
          })}
          {hidden ? <span className="small-label fit-more">+{hidden} more, search to find</span> : null}
        </div>
      </section>

      <section className="panel fit-progress-view">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">{showLoad ? 'All training' : kindLabel(selected!.kind)}</p>
            <h2>{showLoad ? 'Weekly load' : selected!.title}</h2>
          </div>
          <div className="segmented-control fit-range" role="group" aria-label="Time range">
            {RANGES.map((option) => (
              <button key={option} type="button" className={range === option ? 'active' : ''} aria-pressed={range === option} onClick={() => setRange(option)}>
                {option}
              </button>
            ))}
          </div>
        </div>

        {metrics.length > 1 ? (
          <div className="segmented-control fit-metrics" role="group" aria-label="What to measure">
            {metrics.map((option) => (
              <button key={option} type="button" className={metric === option ? 'active' : ''} aria-pressed={metric === option} onClick={() => setMetricChoice(option)}>
                {METRICS[option].label}
              </button>
            ))}
          </div>
        ) : null}

        {summary ? (
          <>
            <div className="fit-progress-stats">
              <div>
                <small>Latest</small>
                <strong>
                  {formatNumber(summary.latest.value)} <span>{unit}</span>
                </strong>
              </div>
              <div>
                <small>Best</small>
                <strong>
                  {formatNumber(summary.best.value)} <span>{unit}</span>
                </strong>
              </div>
              <div>
                <small>Change</small>
                <strong className={summary.change > 0 ? 'up' : summary.change < 0 ? 'down' : ''}>
                  {points.length > 1 ? `${summary.change > 0 ? '+' : ''}${formatNumber(summary.change)}` : '—'} <span>{points.length > 1 ? unit : ''}</span>
                </strong>
              </div>
            </div>
            <LineChart
              points={points}
              unit={unit}
              records={summary.records}
              label={`${showLoad ? 'Weekly load' : selected!.title}, ${METRICS[metric].label}`}
              formatDate={(date) => chartDate(date, thisYear)}
            />
            <p className="small-label">
              {points.length === 1 ? 'One point so far. Do it again and a line appears.' : `Since ${chartDate(summary.first.date, thisYear)}`}
              {summary.records.length ? (
                <>
                  {' · '}
                  <Trophy size={12} /> {summary.records.length} new best{summary.records.length === 1 ? '' : 's'}
                </>
              ) : null}
              {showLoad ? ' · Load = how hard (0–10) × minutes, per week.' : null}
              {metric === 'oneRepMax' ? ' · Est. 1RM uses the Epley formula.' : null}
            </p>
          </>
        ) : (
          <p className="empty-state">
            {allPoints.length
              ? 'Nothing in this range. Try a longer one.'
              : metric === 'load' || metric === 'rpe'
                ? 'No rated sessions yet. Give an entry a 0–10 and a time.'
                : `No ${METRICS[metric].label.toLowerCase()} logged for this one yet.`}
          </p>
        )}

        {!showLoad && rows.length ? (
          <>
            <h3 className="fit-subhead">Recent</h3>
            <ul className="fit-day-entries">
              {rows.slice(0, RECENT_SHOWN).map((workout) => (
                <li key={workout.id}>
                  <button type="button" onClick={() => onEdit(workout)}>
                    <span className="fit-progress-date">{chartDate(workout.date, thisYear)}</span>
                    <span className="fit-history-main">
                      <small>{describeWorkout(workout)}</small>
                      <small className={`fit-intensity${workout.rpe === undefined ? ' unrated' : ''}`}>{intensityText(workout)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  )
}
