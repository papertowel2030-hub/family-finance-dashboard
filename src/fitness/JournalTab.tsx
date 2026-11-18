import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Moon, Pencil, TrendingUp } from 'lucide-react'
import { addDays, dailyLoads, dayMap, dayTotals, exerciseHistory, LOAD_BASELINE_WEEKS, loadBand, weekDates, weekStart, weeklyCounts, weeklyLoads } from '../lib/fitness'
import { profileOrDefault } from '../db/fitnessActions'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { endDateForMonth, formatMonth, formatShortDate, formatWeekdayDate, monthKeyFromDate, nextMonthKey, previousMonthKey } from '../utils/date'
import { quip } from '../utils/quip'
import { EMPTY_DAY, EMPTY_MONTH, FUTURE_DAY, PROGRESS_HINT } from './copy'
import { DayEntries, formatNumber, Sparkline, type FitnessData, type OnDeleted } from './shared'

const MAX_PROGRESS_CARDS = 8
const WEEKS_SHOWN = 8
const KIND_LETTER: Record<TrainingKind, string> = { strength: 'S', cardio: 'E', sport: 'P' }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * The visual page: a month calendar where every day reads at a glance (what you did, or rest),
 * the last weeks against your target, then the selected day's detail and strength progress.
 */
export function JournalTab({
  data,
  person,
  onEdit,
  onDeleted,
  onLogDay,
  onOpenProgress,
}: {
  data: FitnessData
  person: OwnerId
  onEdit: (workout: Workout) => void
  onDeleted: OnDeleted
  onLogDay: (date: string) => void
  onOpenProgress: () => void
}) {
  const { today, workouts, meals, profiles } = data
  const [month, setMonth] = useState(monthKeyFromDate(today))
  const [selected, setSelected] = useState(today)

  const profile = profileOrDefault(profiles.find((row) => row.ownerId === person), person)
  const days = useMemo(() => dayMap(workouts, person), [workouts, person])
  const mine = useMemo(() => workouts.filter((workout) => workout.ownerId === person), [workouts, person])

  const monthStart = `${month}-01`
  const monthEnd = endDateForMonth(month)
  const gridStart = weekStart(monthStart)
  const gridEnd = weekDates(monthEnd)[6]
  const gridDates: string[] = []
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) gridDates.push(cursor)

  const monthDates = gridDates.filter((date) => date >= monthStart && date <= monthEnd)
  const trainedCount = monthDates.filter((date) => days.get(date)?.workouts.length).length
  const restCount = monthDates.filter((date) => days.get(date)?.rest).length

  const weeks = useMemo(() => weeklyCounts(workouts, person, today, WEEKS_SHOWN), [workouts, person, today])
  const loads = useMemo(() => weeklyLoads(workouts, person, today, WEEKS_SHOWN), [workouts, person, today])
  const daily = useMemo(() => dailyLoads(workouts, person), [workouts, person])
  const dailyValues = useMemo(() => [...daily.values()], [daily])
  const [weekView, setWeekView] = useState<'sessions' | 'load'>('sessions')

  const exercises = useMemo(() => {
    const titles = new Map<string, string>()
    mine
      .filter((workout) => workout.kind === 'strength')
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((workout) => {
        const key = workout.title.trim().toLowerCase()
        if (!titles.has(key)) titles.set(key, workout.title.trim())
      })
    return [...titles.values()]
      .map((title) => ({ title, history: exerciseHistory(mine, person, title) }))
      .filter(({ history }) => history.some((point) => point.bestReps > 0))
      .slice(0, MAX_PROGRESS_CARDS)
  }, [mine, person])

  const selectedInfo = days.get(selected)
  const totals = dayTotals(meals, person, selected)
  const hasTotals = totals.proteinG || totals.fiberG || totals.calories

  const pick = (date: string) => {
    setSelected(date)
    setMonth(monthKeyFromDate(date))
  }

  return (
    <div className="fit-stack">
      <section className="panel fit-cal">
        <div className="fit-cal-head">
          <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth(previousMonthKey(month))}>
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2>{formatMonth(month)}</h2>
            <p className="small-label">{trainedCount + restCount ? `${trainedCount} trained · ${restCount} rest` : quip(EMPTY_MONTH, month)}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Next month" disabled={month >= monthKeyFromDate(today)} onClick={() => setMonth(nextMonthKey(month))}>
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="fit-cal-grid" role="grid" aria-label={`${formatMonth(month)} training calendar`}>
          {WEEKDAYS.map((name) => (
            <span key={name} className="fit-cal-weekday" role="columnheader">
              {name}
            </span>
          ))}
          {gridDates.map((date) => {
            if (date < monthStart || date > monthEnd) return <span key={date} className="fit-cal-day blank" aria-hidden="true" />
            const info = days.get(date)
            const trained = Boolean(info?.workouts.length)
            const future = date > today
            const label = trained
              ? `trained: ${info?.kinds.map((kind) => KIND_LETTER[kind]).join(' ')}${daily.get(date) ? `, load ${daily.get(date)}` : ''}`
              : info?.rest
                ? 'rest day'
                : future
                  ? 'upcoming'
                  : 'not logged'
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                className={`fit-cal-day${trained ? ' trained' : ''}${info?.rest ? ' rest' : ''}${future ? ' future' : ''}${date === today ? ' today' : ''}${date === selected ? ' selected' : ''}`}
                aria-label={`${formatWeekdayDate(date)}, ${label}`}
                aria-pressed={date === selected}
                onClick={() => pick(date)}
              >
                <span className="fit-cal-num">{Number(date.slice(8))}</span>
                {trained && daily.get(date) ? (
                  <span className={`fit-cal-load band-${loadBand(daily.get(date), dailyValues)}`} aria-hidden="true" title={`Load ${formatNumber(daily.get(date) ?? 0)}`} />
                ) : null}
                <span className="fit-cal-marks">
                  {info?.kinds.map((kind) => (
                    <i key={kind} className={`mark ${kind}`}>
                      {KIND_LETTER[kind]}
                    </i>
                  ))}
                  {info?.rest ? <Moon size={14} aria-hidden="true" /> : null}
                </span>
              </button>
            )
          })}
        </div>

        <ul className="fit-legend" aria-label="Legend">
          <li>
            <i className="mark strength">S</i> Strength
          </li>
          <li>
            <i className="mark cardio">E</i> Endurance
          </li>
          <li>
            <i className="mark sport">P</i> Sport
          </li>
          <li>
            <Moon size={14} /> Rest
          </li>
        </ul>
      </section>

      <section className="panel fit-selected">
        <div className="section-header compact">
          <div>
            {selected === today ? <p className="eyebrow">Today</p> : null}
            <h2>{formatWeekdayDate(selected)}</h2>
          </div>
          {selected <= today ? (
            <button type="button" className="ghost-button" onClick={() => onLogDay(selected)}>
              <Pencil size={16} />
              Log this day
            </button>
          ) : null}
        </div>
        <DayEntries info={selectedInfo} onEdit={onEdit} onDeleted={onDeleted} empty={selected > today ? quip(FUTURE_DAY, selected) : quip(EMPTY_DAY, `${selected}${person}`)} />
        {hasTotals ? (
          <p className="small-label fit-selected-food">
            {formatNumber(totals.proteinG)} g protein · {formatNumber(totals.fiberG)} g fiber · {formatNumber(totals.calories)} kcal
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-header compact">
          <h2>Last {WEEKS_SHOWN} weeks</h2>
          <div className="segmented-control fit-week-toggle" role="group" aria-label="Show sessions or training load">
            <button type="button" className={weekView === 'sessions' ? 'active' : ''} aria-pressed={weekView === 'sessions'} onClick={() => setWeekView('sessions')}>
              Sessions
            </button>
            <button type="button" className={weekView === 'load' ? 'active' : ''} aria-pressed={weekView === 'load'} onClick={() => setWeekView('load')}>
              Load
            </button>
          </div>
        </div>
        {weekView === 'sessions' ? <SessionWeeks weeks={weeks} target={profile.weeklySessions} today={today} /> : <LoadWeeks loads={loads} today={today} />}
      </section>

      {exercises.length ? (
        <section className="panel">
          <div className="section-header compact">
            <h2>Strength progress</h2>
            <button type="button" className="ghost-button" onClick={onOpenProgress}>
              See all →
            </button>
          </div>
          {exercises.some(({ history }) => history.length < 2) ? <p className="small-label">{PROGRESS_HINT}</p> : null}
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
                  {history.length > 1 ? <Sparkline values={history.slice(-10).map(metric)} label={`${title} progress`} /> : null}
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
        </section>
      ) : null}
    </div>
  )
}

function SessionWeeks({ weeks, target, today }: { weeks: ReturnType<typeof weeklyCounts>; target: number; today: string }) {
  return (
    <>
      <div className="fit-weeks" role="img" aria-label={`Sessions per week, last ${WEEKS_SHOWN} weeks`}>
        {weeks.map((week) => (
          <div key={week.start} className={`fit-week-col${week.sessions >= target ? ' hit' : ''}${week.start === weekStart(today) ? ' current' : ''}`}>
            <span className="fit-week-count">{week.sessions}</span>
            <div className="fit-week-bar">
              <i style={{ height: `${Math.min(week.sessions, 7) * (100 / 7)}%` }} />
              <b style={{ bottom: `${Math.min(target, 7) * (100 / 7)}%` }} />
            </div>
            <small>{week.start.slice(8)}/{week.start.slice(5, 7)}</small>
            <span className="fit-week-rest" title={`${week.rests} rest days`}>
              {week.rests ? (
                <>
                  <Moon size={11} />
                  {week.rests}
                </>
              ) : (
                ''
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="small-label">Dashed line: your target of {target}/week.</p>
    </>
  )
}

const LOAD_KINDS: TrainingKind[] = ['strength', 'cardio', 'sport']

/** Weekly session-RPE load (RPE × minutes), stacked by kind, against the previous 4-week average. */
function LoadWeeks({ loads, today }: { loads: ReturnType<typeof weeklyLoads>; today: string }) {
  const previous = loads.slice(-1 - LOAD_BASELINE_WEEKS, -1).filter((week) => week.load > 0)
  const average = previous.length ? previous.reduce((sum, week) => sum + week.load, 0) / previous.length : 0
  const max = Math.max(average, ...loads.map((week) => week.load)) || 1
  const unrated = loads.reduce((sum, week) => sum + week.unrated, 0)
  if (!loads.some((week) => week.load > 0)) {
    return <p className="empty-state">No rated sessions yet. Tap an entry and give it a 0–10 — load is how hard × how long.</p>
  }
  return (
    <>
      <div className="fit-weeks" role="img" aria-label={`Training load per week, last ${WEEKS_SHOWN} weeks`}>
        {loads.map((week) => (
          <div key={week.start} className={`fit-week-col load${week.start === weekStart(today) ? ' current' : ''}`}>
            <span className="fit-week-count">{week.load ? formatNumber(week.load) : '–'}</span>
            <div className="fit-week-bar">
              <span className="fit-load-stack">
                {LOAD_KINDS.map((kind) => (week.byKind[kind] ? <i key={kind} className={kind} style={{ height: `${(week.byKind[kind] / max) * 100}%` }} /> : null))}
              </span>
              {average ? <b style={{ bottom: `${(average / max) * 100}%` }} /> : null}
            </div>
            <small>{week.start.slice(8)}/{week.start.slice(5, 7)}</small>
            <span className="fit-week-rest" title={`${week.unrated} unrated`}>
              {week.unrated ? `+${week.unrated}?` : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="small-label">
        Load = how hard (0–10) × minutes.{average ? ` Dashed line: your ${LOAD_BASELINE_WEEKS}-week average (${formatNumber(Math.round(average))}).` : ''}
        {unrated ? ` ${unrated} unrated ${unrated === 1 ? 'entry' : 'entries'} (“+n?”) not counted.` : ''}
      </p>
    </>
  )
}
