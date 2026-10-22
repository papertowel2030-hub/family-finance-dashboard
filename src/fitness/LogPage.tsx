import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Flame, Moon, Plus, Trash2, Users, X } from 'lucide-react'
import {
  addMeal,
  deleteMeal,
  deleteWorkout,
  logQuickSession,
  logRestDay,
  profileOrDefault,
  restoreMeal,
  restoreWorkout,
} from '../db/fitnessActions'
import { addDays, dayMap, dayTotals, getNudges, progressRatio, weekStart, weekStatus, weekStreak } from '../lib/fitness'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { formatShortDate, formatWeekdayDate } from '../utils/date'
import { quip } from '../utils/quip'
import { EMPTY_DAY, EMPTY_MEALS, FUTURE_DAY, LOGGED_TOAST, REST_LOGGED_TOAST, REST_REMOVED_TOAST } from './copy'
import { KINDS, WorkoutForm } from './LogTab'
import { DayEntries, formatNumber, otherPerson, parseNumber, personName, Ring, WeekDots, type FitnessData, type OnDeleted } from './shared'

const PROTEIN_CHIPS = [10, 25, 40]
const FIBER_CHIPS = [5, 10]
const KCAL_CHIPS = [100, 300, 500]

/**
 * The one page for logging: pick a day, tap what you did (or Rest), optionally add exercise detail,
 * and tap nutrition chips. Everything saves on tap; Undo is always one tap away.
 */
export function LogPage({
  data,
  person,
  date,
  onDate,
  onEdit,
  onDeleted,
}: {
  data: FitnessData
  person: OwnerId
  date: string
  onDate: (date: string) => void
  onEdit: (workout: Workout) => void
  onDeleted: OnDeleted
}) {
  const { today, workouts, meals, profiles, realmId } = data
  const profile = profileOrDefault(profiles.find((row) => row.ownerId === person), person)
  const info = useMemo(() => dayMap(workouts, person).get(date), [workouts, person, date])
  const week = weekStatus(workouts, person, today, date)
  const streak = weekStreak(workouts, person, today, profile.weeklySessions)
  const nudges = getNudges(workouts, person, today)
  const totals = dayTotals(meals, person, date)
  const dayMeals = meals.filter((meal) => meal.ownerId === person && meal.date === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const isToday = date === today
  const [detailKind, setDetailKind] = useState<TrainingKind | null>(null)
  const [error, setError] = useState('')
  const detailRef = useRef<HTMLDivElement>(null)

  // On a phone the form opens below the fold; bring it into view so the next tap is on a field.
  useEffect(() => {
    if (detailKind) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [detailKind])

  const guard = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const goToDay = (next: string) => {
    setDetailKind(null)
    setError('')
    onDate(next)
  }

  const tapTraining = (kind: TrainingKind) =>
    guard(async () => {
      const done = info?.kinds.includes(kind)
      if (done) {
        setDetailKind(detailKind === kind ? null : kind)
        return
      }
      const { workout, removedRest } = await logQuickSession({ ownerId: person, date, kind, realmId })
      onDeleted(LOGGED_TOAST[kind], async () => {
        await deleteWorkout(workout.id)
        await Promise.all(removedRest.map(restoreWorkout))
      })
      setDetailKind(kind)
    })

  const tapRest = () =>
    guard(async () => {
      if (info?.rest) {
        const rows = info.restEntries
        await Promise.all(rows.map((row) => deleteWorkout(row.id)))
        onDeleted(REST_REMOVED_TOAST, async () => {
          await Promise.all(rows.map(restoreWorkout))
        })
        return
      }
      const rest = await logRestDay({ ownerId: person, date, realmId })
      setDetailKind(null)
      onDeleted(REST_LOGGED_TOAST, () => deleteWorkout(rest.id))
    })

  const quickAdd = (input: { proteinG?: number; fiberG?: number; calories?: number }) => guard(async () => void (await addMeal({ ownerId: person, date, realmId, ...input })))

  const buddy = otherPerson(person)
  const buddyProfile = profileOrDefault(profiles.find((row) => row.ownerId === buddy), buddy)
  const buddyTotals = dayTotals(meals, buddy, today)
  const buddyWeek = weekStatus(workouts, buddy, today)

  const tiles: Array<{ id: TrainingKind | 'rest'; label: string; Icon: (typeof KINDS)[number]['Icon'] | typeof Moon }> = [...KINDS, { id: 'rest', label: 'Rest', Icon: Moon }]

  return (
    <div className="fit-stack">
      <section className="panel fit-week-card">
        <div className="fit-week-head">
          <h2>
            {week.sessions} of {profile.weeklySessions} sessions{' '}
            <small>{week.sessions >= profile.weeklySessions ? 'target smashed' : weekStart(date) === weekStart(today) ? 'this week' : `week of ${formatShortDate(weekStart(date))}`}</small>
          </h2>
          {streak > 0 ? (
            <span className="fit-streak">
              <Flame size={16} /> {streak}-week streak
            </span>
          ) : null}
        </div>
        <WeekDots days={week.days} selected={date} onSelect={goToDay} />
      </section>

      {nudges.length ? (
        <section className="fit-nudges" aria-label="Heads up">
          {nudges.map((nudge) => (
            <p key={nudge.kind} className={`fit-nudge ${nudge.kind}`}>
              {nudge.message}
            </p>
          ))}
        </section>
      ) : null}

      <section className="panel fit-day-card">
        <div className="fit-day-bar">
          <button type="button" className="icon-button" aria-label="Previous day" onClick={() => goToDay(addDays(date, -1))}>
            <ChevronLeft size={20} />
          </button>
          <div>
            {isToday ? <p className="eyebrow">Today</p> : null}
            <h2>{formatWeekdayDate(date)}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Next day" disabled={date >= today} onClick={() => goToDay(addDays(date, 1))}>
            <ChevronRight size={20} />
          </button>
          {isToday ? null : (
            <button type="button" className="ghost-button" onClick={() => goToDay(today)}>
              Back to today
            </button>
          )}
        </div>

        <div className="fit-tiles" role="group" aria-label={`What did ${personName(person)} do`}>
          {tiles.map(({ id, label, Icon }) => {
            const rest = id === 'rest'
            const done = rest ? Boolean(info?.rest) : Boolean(info?.kinds.includes(id))
            const blocked = rest && Boolean(info?.workouts.length)
            const count = rest ? 0 : (info?.workouts.filter((workout) => workout.kind === id).length ?? 0)
            return (
              <button
                key={id}
                type="button"
                className={`fit-tile ${id}${done ? ' done' : ''}`}
                aria-pressed={done}
                disabled={blocked || date > today}
                title={blocked ? 'You trained this day' : undefined}
                onClick={() => (rest ? tapRest() : tapTraining(id))}
              >
                <span className="fit-tile-icon">{done ? <Check size={22} strokeWidth={3} /> : <Icon size={22} />}</span>
                <strong>{label}</strong>
                <small>
                  {rest ? (done ? 'Doing nothing ✓' : blocked ? 'Already sweaty' : 'Legs on holiday') : done ? (count > 1 ? `${count} logged` : 'Done · add detail') : 'Tap to log'}
                </small>
              </button>
            )
          })}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {detailKind ? (
          <div className="fit-detail" ref={detailRef}>
            <div className="fit-detail-head">
              <h3>Add detail — {KINDS.find((kind) => kind.id === detailKind)?.label}</h3>
              <button type="button" className="icon-button" aria-label="Close detail" onClick={() => setDetailKind(null)}>
                <X size={18} />
              </button>
            </div>
            <WorkoutForm key={`${date}-${detailKind}`} data={data} person={person} kind={detailKind} date={date} />
          </div>
        ) : null}

        {info?.workouts.length || info?.restEntries.length ? <h3 className="fit-subhead">Logged</h3> : null}
        <DayEntries info={info} onEdit={onEdit} onDeleted={onDeleted} empty={date > today ? quip(FUTURE_DAY, date) : quip(EMPTY_DAY, `${date}${person}`)} />
      </section>

      <section className="panel">
        <div className="section-header compact">
          <h2>
            Nutrition {isToday ? null : <small>{formatWeekdayDate(date)}</small>}
          </h2>
        </div>
        <div className="fit-macros">
          <div className="fit-macro">
            <Ring tone="leaf" label="Protein" unit="g" value={totals.proteinG} target={profile.proteinTarget} ratio={progressRatio(totals.proteinG, profile.proteinTarget)} />
            <div className="fit-macro-chips">
              {PROTEIN_CHIPS.map((grams) => (
                <button key={grams} type="button" className="fit-chip leaf" onClick={() => quickAdd({ proteinG: grams })}>
                  +{grams} g
                </button>
              ))}
            </div>
          </div>
          <div className="fit-macro">
            <Ring tone="amber" label="Fiber" unit="g" value={totals.fiberG} target={profile.fiberTarget} ratio={progressRatio(totals.fiberG, profile.fiberTarget)} />
            <div className="fit-macro-chips">
              {FIBER_CHIPS.map((grams) => (
                <button key={grams} type="button" className="fit-chip amber" onClick={() => quickAdd({ fiberG: grams })}>
                  +{grams} g
                </button>
              ))}
            </div>
          </div>
          <div className="fit-macro">
            <Ring tone="blue" label="Calories" unit="kcal" value={totals.calories} target={profile.calorieTarget} ratio={progressRatio(totals.calories, profile.calorieTarget)} />
            <div className="fit-macro-chips">
              {KCAL_CHIPS.map((kcal) => (
                <button key={kcal} type="button" className="fit-chip blue" onClick={() => quickAdd({ calories: kcal })}>
                  +{kcal}
                </button>
              ))}
            </div>
          </div>
        </div>

        <CustomMeal onAdd={quickAdd} />

        {dayMeals.length ? (
          <ul className="fit-entries">
            {dayMeals.map((meal) => (
              <li key={meal.id}>
                <span>
                  {[meal.proteinG ? `${formatNumber(meal.proteinG)} g protein` : '', meal.fiberG ? `${formatNumber(meal.fiberG)} g fiber` : '', meal.calories ? `${formatNumber(meal.calories)} kcal` : '']
                    .filter(Boolean)
                    .join(' · ')}
                  {meal.label ? <small> — {meal.label}</small> : null}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove entry"
                  onClick={async () => {
                    await deleteMeal(meal.id)
                    onDeleted('Removed entry', () => restoreMeal(meal))
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">{quip(EMPTY_MEALS, `${date}${person}`)}</p>
        )}
      </section>

      <section className="panel fit-buddy">
        <div className="section-header compact">
          <h2>
            <Users size={18} /> {personName(buddy)} today
          </h2>
        </div>
        <WeekDots days={buddyWeek.days} compact />
        <p className="small-label">
          {buddyWeek.sessions} of {buddyProfile.weeklySessions} sessions · protein {formatNumber(buddyTotals.proteinG)}/{formatNumber(buddyProfile.proteinTarget)} g · fiber {formatNumber(buddyTotals.fiberG)}/
          {formatNumber(buddyProfile.fiberTarget)} g
        </p>
      </section>
    </div>
  )
}

function CustomMeal({ onAdd }: { onAdd: (input: { proteinG?: number; fiberG?: number; calories?: number }) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [protein, setProtein] = useState('')
  const [fiber, setFiber] = useState('')
  const [kcal, setKcal] = useState('')

  if (!open) {
    return (
      <button type="button" className="ghost-button fit-custom-toggle" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Custom amount
      </button>
    )
  }

  return (
    <form
      className="fit-custom"
      onSubmit={async (event) => {
        event.preventDefault()
        await onAdd({ proteinG: parseNumber(protein) || undefined, fiberG: parseNumber(fiber) || undefined, calories: parseNumber(kcal) || undefined })
        setProtein('')
        setFiber('')
        setKcal('')
      }}
    >
      <label>
        Protein g
        <input inputMode="decimal" value={protein} onChange={(event) => setProtein(event.target.value)} />
      </label>
      <label>
        Fiber g
        <input inputMode="decimal" value={fiber} onChange={(event) => setFiber(event.target.value)} />
      </label>
      <label>
        Calories
        <input inputMode="decimal" value={kcal} onChange={(event) => setKcal(event.target.value)} />
      </label>
      <button type="submit" className="primary-button">
        Add
      </button>
    </form>
  )
}
