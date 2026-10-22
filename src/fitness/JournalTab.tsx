import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Moon, Pencil, TrendingUp } from 'lucide-react'
import { addDays, dayMap, dayTotals, exerciseHistory, weekDates, weekStart, weeklyCounts } from '../lib/fitness'
import { profileOrDefault } from '../db/fitnessActions'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { endDateForMonth, formatMonth, formatShortDate, formatWeekdayDate, monthKeyFromDate, nextMonthKey, previousMonthKey } from '../utils/date'
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
}: {
  data: FitnessData
  person: OwnerId
  onEdit: (workout: Workout) => void
  onDeleted: OnDeleted
  onLogDay: (date: string) => void
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
  const missedCount = monthDates.filter((date) => date < today && !days.get(date)).length

  const weeks = useMemo(() => weeklyCounts(workouts, person, today, WEEKS_SHOWN), [workouts, person, today])

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
            <p className="eyebrow">Journal</p>
            <h2>{formatMonth(month)}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Next month" disabled={month >= monthKeyFromDate(today)} onClick={() => setMonth(nextMonthKey(month))}>
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="fit-month-stats">
          <div className="stat trained">
            <strong>{trainedCount}</strong>
            <span>trained</span>
          </div>
          <div className="stat rest">
            <strong>{restCount}</strong>
            <span>rest</span>
          </div>
          <div className="stat missed">
            <strong>{missedCount}</strong>
            <span>not logged</span>
          </div>
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
              ? `trained: ${info?.kinds.map((kind) => KIND_LETTER[kind]).join(' ')}`
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
            <p className="eyebrow">{selected === today ? 'Today' : formatShortDate(selected)}</p>
            <h2>{formatWeekdayDate(selected)}</h2>
          </div>
          {selected <= today ? (
            <button type="button" className="ghost-button" onClick={() => onLogDay(selected)}>
              <Pencil size={16} />
              Log this day
            </button>
          ) : null}
        </div>
        <DayEntries info={selectedInfo} onEdit={onEdit} onDeleted={onDeleted} empty={selected > today ? 'Nothing yet — it’s in the future.' : 'Nothing logged this day.'} />
        {hasTotals ? (
          <p className="small-label fit-selected-food">
            {formatNumber(totals.proteinG)} g protein · {formatNumber(totals.fiberG)} g fiber · {formatNumber(totals.calories)} kcal
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Consistency</p>
            <h2>Last {WEEKS_SHOWN} weeks</h2>
          </div>
          <span className="small-label">Target {profile.weeklySessions}/week</span>
        </div>
        <div className="fit-weeks" role="img" aria-label={`Sessions per week, last ${WEEKS_SHOWN} weeks`}>
          {weeks.map((week) => (
            <div key={week.start} className={`fit-week-col${week.sessions >= profile.weeklySessions ? ' hit' : ''}${week.start === weekStart(today) ? ' current' : ''}`}>
              <span className="fit-week-count">{week.sessions}</span>
              <div className="fit-week-bar">
                <i style={{ height: `${Math.min(week.sessions, 7) * (100 / 7)}%` }} />
                <b style={{ bottom: `${Math.min(profile.weeklySessions, 7) * (100 / 7)}%` }} />
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
        <p className="small-label">Bars are training days per week (Mon–Sun); the line is your target. Green means target hit.</p>
      </section>

      {exercises.length ? (
        <section className="panel">
          <div className="section-header compact">
            <div>
              <p className="eyebrow">Strength</p>
              <h2>Progress</h2>
            </div>
          </div>
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
        </section>
      ) : null}
    </div>
  )
}
