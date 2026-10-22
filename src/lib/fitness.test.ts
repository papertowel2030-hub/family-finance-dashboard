import { describe, expect, it } from 'vitest'
import type { Meal, Workout } from '../types'
import {
  addDays,
  dayTotals,
  estimateOneRepMax,
  exerciseHistory,
  getNudges,
  knownTitles,
  lastSessionSets,
  progressRatio,
  weekDates,
  weekStart,
  weekStatus,
  weekStreak,
} from './fitness'

const now = '2026-10-01T00:00:00.000Z'
let counter = 0

const workout = (date: string, extra: Partial<Workout> = {}): Workout => ({
  id: `w${++counter}`,
  ownerId: 'moon',
  date,
  kind: 'cardio',
  title: 'Run',
  minutes: 30,
  createdAt: now,
  updatedAt: now,
  ...extra,
})

const lift = (date: string, title: string, sets: Array<[number, number]>, extra: Partial<Workout> = {}) =>
  workout(date, { kind: 'strength', title, minutes: undefined, sets: sets.map(([reps, weight]) => ({ reps, weight })), ...extra })

const meal = (date: string, extra: Partial<Meal> = {}): Meal => ({
  id: `m${++counter}`,
  ownerId: 'moon',
  date,
  proteinG: 0,
  fiberG: 0,
  calories: 0,
  createdAt: now,
  updatedAt: now,
  ...extra,
})

// 2026-10-21 is a Wednesday → its week is Mon 10-19 … Sun 10-25.
const TODAY = '2026-10-21'

describe('dates', () => {
  it('finds the Monday-based week, including across month and year boundaries', () => {
    expect(weekStart('2026-10-21')).toBe('2026-10-19')
    expect(weekStart('2026-10-25')).toBe('2026-10-19') // Sunday belongs to the week that started Monday
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(weekStart('2027-01-01')).toBe('2026-12-28')
    expect(weekDates('2026-10-21')).toHaveLength(7)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('dayTotals', () => {
  it('sums only the chosen person and day', () => {
    const meals = [
      meal(TODAY, { proteinG: 25, fiberG: 5, calories: 300 }),
      meal(TODAY, { proteinG: 30, calories: 450 }),
      meal(TODAY, { ownerId: 'alena', proteinG: 99 }),
      meal('2026-10-20', { proteinG: 80 }),
    ]
    expect(dayTotals(meals, 'moon', TODAY)).toEqual({ proteinG: 55, fiberG: 5, calories: 750 })
    expect(dayTotals([], 'moon', TODAY)).toEqual({ proteinG: 0, fiberG: 0, calories: 0 })
  })
})

describe('weekStatus', () => {
  it('marks trained days, today and future days; counts a day once however many entries', () => {
    const logs = [workout('2026-10-19'), workout('2026-10-19', { title: 'Swim' }), workout('2026-10-21'), workout('2026-10-18')]
    const status = weekStatus(logs, 'moon', TODAY)

    expect(status.sessions).toBe(2)
    expect(status.days.map((day) => day.trained)).toEqual([true, false, true, false, false, false, false])
    expect(status.days.find((day) => day.isToday)?.date).toBe(TODAY)
    expect(status.days.filter((day) => day.isFuture)).toHaveLength(4)
  })

  it("ignores the other person's workouts", () => {
    expect(weekStatus([workout('2026-10-20', { ownerId: 'alena' })], 'moon', TODAY).sessions).toBe(0)
  })
})

describe('weekStreak', () => {
  const trainOn = (...dates: string[]) => dates.map((date) => workout(date))

  it('counts finished weeks that hit the target plus the current one once it is met', () => {
    const logs = trainOn('2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21')
    expect(weekStreak(logs, 'moon', TODAY, 3)).toBe(3)
  })

  it('does not break the streak while the current week is still in progress', () => {
    const logs = trainOn('2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19')
    expect(weekStreak(logs, 'moon', TODAY, 3)).toBe(1)
  })

  it('stops at a missed week', () => {
    const logs = trainOn('2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-19', '2026-10-20', '2026-10-21')
    expect(weekStreak(logs, 'moon', TODAY, 3)).toBe(1)
  })

  it('is zero with no target', () => {
    expect(weekStreak(trainOn(TODAY), 'moon', TODAY, 0)).toBe(0)
  })
})

describe('estimateOneRepMax', () => {
  it('uses the Epley formula and rejects bodyweight/invalid sets', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100)
    expect(estimateOneRepMax(60, 10)).toBe(80)
    expect(estimateOneRepMax(0, 10)).toBeNull()
    expect(estimateOneRepMax(50, 0)).toBeNull()
  })
})

describe('exercise history', () => {
  const logs = [
    lift('2026-10-10', 'Squat', [[5, 80], [5, 80]]),
    lift('2026-10-17', 'squat ', [[5, 85], [3, 90]]),
    lift('2026-10-17', 'Bench', [[5, 60]]),
    lift('2026-10-03', 'Squat', [[8, 70]], { ownerId: 'alena' }),
  ]

  it('groups per day, case-insensitively, oldest first, for one person', () => {
    const history = exerciseHistory(logs, 'moon', 'Squat')
    expect(history.map((point) => point.date)).toEqual(['2026-10-10', '2026-10-17'])
    expect(history[0]).toMatchObject({ bestWeight: 80, bestReps: 5, volume: 800 })
    expect(history[1]).toMatchObject({ bestWeight: 90, bestReps: 3, volume: 5 * 85 + 3 * 90 })
  })

  it('returns the latest sets for prefilling and null when unknown', () => {
    expect(lastSessionSets(logs, 'moon', 'SQUAT')).toEqual([{ reps: 5, weight: 85 }, { reps: 3, weight: 90 }])
    expect(lastSessionSets(logs, 'moon', 'Deadlift')).toBeNull()
  })

  it('lists known titles most recent first without duplicates', () => {
    expect(knownTitles(logs, 'moon', 'strength')).toEqual(['squat', 'Bench'])
  })
})

describe('getNudges', () => {
  it('suggests rest after six training days in a row', () => {
    const logs = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((date) => workout(date))
    expect(getNudges(logs, 'moon', TODAY).map((nudge) => nudge.kind)).toContain('rest')
  })

  it('does not nudge for five days in a row, and counts a run ending yesterday', () => {
    const five = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((date) => workout(date))
    expect(getNudges(five, 'moon', TODAY)).toEqual([])
    const sixEndingYesterday = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'].map((date) => workout(date))
    expect(getNudges(sixEndingYesterday, 'moon', TODAY).map((nudge) => nudge.kind)).toContain('rest')
  })

  it('warns when weekly strength volume jumps more than 30%', () => {
    const logs = [lift('2026-10-12', 'Squat', [[10, 100]]), lift('2026-10-20', 'Squat', [[10, 140]])]
    const nudges = getNudges(logs, 'moon', TODAY)
    expect(nudges.find((nudge) => nudge.kind === 'volume')?.message).toContain('40%')
  })

  it('stays quiet for a modest increase or no previous week', () => {
    const modest = [lift('2026-10-12', 'Squat', [[10, 100]]), lift('2026-10-20', 'Squat', [[10, 120]])]
    expect(getNudges(modest, 'moon', TODAY)).toEqual([])
    expect(getNudges([lift('2026-10-20', 'Squat', [[10, 120]])], 'moon', TODAY)).toEqual([])
  })

  it('surfaces a recent niggle but not an old one', () => {
    expect(getNudges([workout('2026-10-19', { niggle: true, title: 'Football' })], 'moon', TODAY)[0]).toMatchObject({ kind: 'niggle' })
    expect(getNudges([workout('2026-10-01', { niggle: true })], 'moon', TODAY)).toEqual([])
  })
})

describe('progressRatio', () => {
  it('clamps to 0..1 and handles an unset target', () => {
    expect(progressRatio(50, 100)).toBe(0.5)
    expect(progressRatio(250, 100)).toBe(1)
    expect(progressRatio(10, 0)).toBe(0)
    expect(progressRatio(0, 100)).toBe(0)
  })
})
