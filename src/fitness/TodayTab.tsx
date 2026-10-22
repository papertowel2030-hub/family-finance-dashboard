import { useState } from 'react'
import { Dumbbell, Flame, Plus, Trash2, Users } from 'lucide-react'
import { addMeal, deleteMeal, profileOrDefault, restoreMeal } from '../db/fitnessActions'
import { dayTotals, getNudges, progressRatio, weekStatus, weekStreak } from '../lib/fitness'
import type { OwnerId } from '../types'
import { formatShortDate } from '../utils/date'
import { formatNumber, otherPerson, parseNumber, personName, Ring, WeekDots, type FitnessData, type OnDeleted } from './shared'

const PROTEIN_CHIPS = [10, 25, 40]
const FIBER_CHIPS = [5, 10]
const KCAL_CHIPS = [100, 300, 500]

export function TodayTab({
  data,
  person,
  onLog,
  onDeleted,
}: {
  data: FitnessData
  person: OwnerId
  onLog: () => void
  onDeleted: OnDeleted
}) {
  const { today, workouts, meals, profiles, realmId } = data
  const profile = profileOrDefault(profiles.find((row) => row.ownerId === person), person)
  const totals = dayTotals(meals, person, today)
  const week = weekStatus(workouts, person, today)
  const streak = weekStreak(workouts, person, today, profile.weeklySessions)
  const nudges = getNudges(workouts, person, today)
  const todaysEntries = meals.filter((meal) => meal.ownerId === person && meal.date === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [error, setError] = useState('')

  const quickAdd = async (input: { proteinG?: number; fiberG?: number; calories?: number }) => {
    setError('')
    try {
      await addMeal({ ownerId: person, date: today, realmId, ...input })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const buddy = otherPerson(person)
  const buddyProfile = profileOrDefault(profiles.find((row) => row.ownerId === buddy), buddy)
  const buddyTotals = dayTotals(meals, buddy, today)
  const buddyWeek = weekStatus(workouts, buddy, today)

  return (
    <div className="fit-stack">
      <section className="panel fit-week-card">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">{formatShortDate(today)}</p>
            <h2>This week</h2>
          </div>
          <button type="button" className="primary-button" onClick={onLog}>
            <Dumbbell size={18} />
            Log workout
          </button>
        </div>
        <WeekDots days={week.days} />
        <p className="fit-week-summary">
          <strong>
            {week.sessions} of {profile.weeklySessions}
          </strong>{' '}
          sessions
          {streak > 0 ? (
            <span className="fit-streak">
              <Flame size={16} /> {streak}-week streak
            </span>
          ) : null}
        </p>
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

      <section className="panel">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Today</p>
            <h2>Nutrition</h2>
          </div>
        </div>
        <div className="fit-rings">
          <Ring tone="leaf" label="Protein" unit="g" value={totals.proteinG} target={profile.proteinTarget} ratio={progressRatio(totals.proteinG, profile.proteinTarget)} />
          <Ring tone="amber" label="Fiber" unit="g" value={totals.fiberG} target={profile.fiberTarget} ratio={progressRatio(totals.fiberG, profile.fiberTarget)} />
          <Ring tone="blue" label="Calories" unit="kcal" value={totals.calories} target={profile.calorieTarget} ratio={progressRatio(totals.calories, profile.calorieTarget)} />
        </div>

        <div className="fit-chip-rows">
          <div className="fit-chip-row">
            <span>Protein</span>
            {PROTEIN_CHIPS.map((grams) => (
              <button key={grams} type="button" className="fit-chip leaf" onClick={() => quickAdd({ proteinG: grams })}>
                +{grams} g
              </button>
            ))}
          </div>
          <div className="fit-chip-row">
            <span>Fiber</span>
            {FIBER_CHIPS.map((grams) => (
              <button key={grams} type="button" className="fit-chip amber" onClick={() => quickAdd({ fiberG: grams })}>
                +{grams} g
              </button>
            ))}
          </div>
          <div className="fit-chip-row">
            <span>Calories</span>
            {KCAL_CHIPS.map((kcal) => (
              <button key={kcal} type="button" className="fit-chip blue" onClick={() => quickAdd({ calories: kcal })}>
                +{kcal}
              </button>
            ))}
          </div>
        </div>

        <CustomMeal onAdd={quickAdd} />
        {error ? <p className="form-error">{error}</p> : null}

        {todaysEntries.length ? (
          <ul className="fit-entries">
            {todaysEntries.map((meal) => (
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
          <p className="empty-state">Nothing logged yet today. Tap a chip to add.</p>
        )}
      </section>

      <section className="panel fit-buddy">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Family</p>
            <h2>
              <Users size={18} /> {personName(buddy)} today
            </h2>
          </div>
        </div>
        <WeekDots days={buddyWeek.days} compact />
        <p className="small-label">
          {buddyWeek.sessions} of {buddyProfile.weeklySessions} sessions this week · {formatNumber(buddyTotals.proteinG)}/{formatNumber(buddyProfile.proteinTarget)} g protein ·{' '}
          {formatNumber(buddyTotals.fiberG)}/{formatNumber(buddyProfile.fiberTarget)} g fiber
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
