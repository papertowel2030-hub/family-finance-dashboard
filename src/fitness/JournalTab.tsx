import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Moon, Pencil, TrendingUp } from 'lucide-react'
import { addDays, dailyLoads, DAY_LOAD_BANDS, dayLoadBand, dayMap, dayTotals, exerciseHistory, LOAD_BASELINE_WEEKS, weekDates, weekStart, weeklyCounts, weeklyLoads } from '../lib/fitness'
import { profileOrDefault } from '../db/fitnessActions'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { endDateForMonth, formatMonth, formatShortDate, formatWeekdayDate, monthKeyFromDate, nextMonthKey, previousMonthKey } from '../utils/date'
import { quip } from '../utils/quip'
import { EMPTY_DAY, EMPTY_MONTH, FUTURE_DAY, NO_GAIN_YET } from './copy'
import { DayEntries, formatNumber, type FitnessData, type OnDeleted } from './shared'

const WEEKS_SHOWN = 8
const KIND_LETTER: Record<TrainingKind, string> = { strength: 'R', cardio: 'C', sport: 'P' }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HEAT_WORD = ['unrated', 'easy', 'medium', 'hard']

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
  // Current month: stop after this week, so empty future rows don't push the day detail off screen.
  const lastShown = month === monthKeyFromDate(today) && today < monthEnd ? today : monthEnd
  const gridEnd = weekDates(lastShown)[6]
  const gridDates: string[] = []
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) gridDates.push(cursor)

  const monthDates = gridDates.filter((date) => date >= monthStart && date <= monthEnd)
  const trainedCount = monthDates.filter((date) => days.get(date)?.workouts.length).length
  const restCount = monthDates.filter((date) => days.get(date)?.rest).length
  const gapCount = monthDates.filter((date) => date < today && !days.get(date)?.workouts.length && !days.get(date)?.rest).length

  const weeks = useMemo(() => weeklyCounts(workouts, person, today, WEEKS_SHOWN), [workouts, person, today])
  const loads = useMemo(() => weeklyLoads(workouts, person, today, WEEKS_SHOWN), [workouts, person, today])
  const daily = useMemo(() => dailyLoads(workouts, person), [workouts, person])
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
  }, [mine, person])

  // One line instead of a card grid: the Progress tab owns the charts.
  const topGain = useMemo(() => {
    let best: { title: string; gain: number; since: string } | null = null
    for (const { title, history } of exercises) {
      if (history.length < 2) continue
      const metric = (point: (typeof history)[number]) => point.oneRepMax ?? point.bestWeight
      const gain = metric(history[history.length - 1]) - metric(history[0])
      if (gain > 0 && (!best || gain > best.gain)) best = { title, gain, since: history[0].date }
    }
    return best
  }, [exercises])

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
            {trainedCount + restCount ? (
              <p className="fit-cal-summary">
                {trainedCount ? <span className="trained">{trainedCount} trained</span> : null}
                {restCount ? <span className="rest">{restCount} rest</span> : null}
                {gapCount ? <span className="gap">{gapCount} {gapCount === 1 ? 'gap' : 'gaps'}</span> : null}
              </p>
            ) : (
              <p className="small-label">{quip(EMPTY_MONTH, month)}</p>
            )}
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
            const gap = !trained && !info?.rest && date < today
            const heat = trained ? dayLoadBand(daily.get(date)) : 0
            const label = trained
              ? `trained: ${info?.kinds.map((kind) => KIND_LETTER[kind]).join(' ')}${daily.get(date) ? `, load ${daily.get(date)} (${HEAT_WORD[heat]})` : ', unrated'}`
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
                className={`fit-cal-day${trained ? ` trained heat-${heat}` : ''}${info?.rest ? ' rest' : ''}${gap ? ' gap' : ''}${future ? ' future' : ''}${date === today ? ' today' : ''}${date === selected ? ' selected' : ''}`}
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
            <i className="mark strength">R</i> Resistance
          </li>
          <li>
            <i className="mark cardio">C</i> Cardio
          </li>
          <li>
            <i className="mark sport">P</i> Sport
          </li>
          <li>
            <Moon size={14} /> Rest
          </li>
          <li className="fit-legend-heat" title={`Shade = day load (RPE × minutes): easy under ${DAY_LOAD_BANDS[0]}, medium ${DAY_LOAD_BANDS[0]}–${DAY_LOAD_BANDS[1] - 1}, hard ${DAY_LOAD_BANDS[1]}+`}>
            easy
            <i className="heat-1" />
            <i className="heat-2" />
            <i className="heat-3" />
            hard
          </li>
          <li>
            <i className="fit-legend-gap" /> Not logged
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
        <button type="button" className="panel fit-gain-teaser" onClick={onOpenProgress}>
          <TrendingUp size={18} aria-hidden="true" />
          <span>
            {topGain ? (
              <>
                <b>{topGain.title}</b> +{formatNumber(topGain.gain)} kg since {formatShortDate(topGain.since)}
              </>
            ) : (
              <>
                {exercises.length} {exercises.length === 1 ? 'lift' : 'lifts'} tracked · {quip(NO_GAIN_YET, `${today}${person}`)}
              </>
            )}
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
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
            <small>{week.start === weekStart(today) ? 'now' : `${week.start.slice(8)}/${week.start.slice(5, 7)}`}</small>
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
      <ul className="fit-legend fit-week-key" aria-label="Chart key">
        <li>
          <i className="key-hit" /> Hit target
        </li>
        <li>
          <i className="key-short" /> Short
        </li>
        <li>
          <i className="key-now" /> In progress
        </li>
        <li>
          <i className="key-target" /> Target {target}/wk
        </li>
      </ul>
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
            <small>{week.start === weekStart(today) ? 'now' : `${week.start.slice(8)}/${week.start.slice(5, 7)}`}</small>
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
