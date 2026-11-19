import { describe, expect, it } from 'vitest'
import type { Meal, Workout } from '../types'
import {
  addDays,
  compareIntervals,
  dailyLoads,
  dayMap,
  dayTotals,
  estimateOneRepMax,
  exerciseHistory,
  exerciseList,
  holdLabel,
  holdText,
  isHoldName,
  lastSessionHolds,
  paceText,
  parseHoldSeconds,
  metricsFor,
  progressSeries,
  rangeStart,
  summarizeSeries,
  weeklyLoadSeries,
  expandPattern,
  formatDuration,
  getNudges,
  intervalSummary,
  isUniformPattern,
  lastIntervalSession,
  loadBand,
  patternFromSegments,
  sessionLoad,
  weeklyLoads,
  knownTitles,
  lastSessionSets,
  progressRatio,
  weekDates,
  weeklyCounts,
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

describe('rest days', () => {
  const rest = (date: string, extra: Partial<Workout> = {}) => workout(date, { kind: 'rest', title: 'Rest', minutes: undefined, ...extra })

  it('are shown in the week but never count as training or toward the streak', () => {
    const logs = [workout('2026-10-19'), rest('2026-10-20'), rest('2026-10-21'), workout('2026-10-21', { kind: 'strength', title: 'Squat', minutes: undefined })]
    const status = weekStatus(logs, 'moon', TODAY)
    expect(status.sessions).toBe(2)
    expect(status.rests).toBe(1) // 10-21 has both: training wins
    expect(status.days.map((day) => day.rest)).toEqual([false, true, false, false, false, false, false])
    expect(weekStreak([rest('2026-10-19'), rest('2026-10-20'), rest('2026-10-21')], 'moon', TODAY, 1)).toBe(0)
  })

  it('break a run of training days for the rest nudge', () => {
    const days = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']
    const run = days.map((date) => workout(date))
    expect(getNudges(run, 'moon', TODAY).some((nudge) => nudge.kind === 'rest')).toBe(true)
    const withRest = run.filter((entry) => entry.date !== '2026-10-18').concat(rest('2026-10-18'))
    expect(getNudges(withRest, 'moon', TODAY).some((nudge) => nudge.kind === 'rest')).toBe(false)
  })

  it('stay out of exercise titles, history and progress', () => {
    const logs = [rest('2026-10-20'), lift('2026-10-19', 'Squat', [[5, 80]])]
    expect(knownTitles(logs, 'moon', 'strength')).toEqual(['Squat'])
    expect(exerciseHistory(logs, 'moon', 'Rest')).toEqual([])
  })

  it('build per-day info with kinds in a fixed order and rest only when nothing else happened', () => {
    const map = dayMap([workout('2026-10-20'), lift('2026-10-20', 'Squat', [[5, 80]]), rest('2026-10-21'), rest('2026-10-20'), workout('2026-10-22', { ownerId: 'alena' })], 'moon')
    expect(map.get('2026-10-20')).toMatchObject({ kinds: ['strength', 'cardio'], rest: false })
    expect(map.get('2026-10-21')).toMatchObject({ kinds: [], rest: true })
    expect(map.has('2026-10-22')).toBe(false)
  })

  it('count training and rest days per week, oldest first', () => {
    const counts = weeklyCounts([workout('2026-10-12'), workout('2026-10-13'), rest('2026-10-14'), workout('2026-10-20')], 'moon', TODAY, 3)
    expect(counts).toEqual([
      { start: '2026-10-05', sessions: 0, rests: 0 },
      { start: '2026-10-12', sessions: 2, rests: 1 },
      { start: '2026-10-19', sessions: 1, rests: 0 },
    ])
  })
})

describe('duration', () => {
  it('formats back to mm:ss without float noise', () => {
    expect(formatDuration(25.5)).toBe('25:30')
    expect(formatDuration(65)).toBe('1:05:00')
    expect(formatDuration(750 / 60)).toBe('12:30')
    expect(formatDuration(1 / 3)).toBe('0:20')
  })
})

describe('session load (session RPE × minutes)', () => {
  it('is null when unrated or without duration, never guessed from old 1–5 effort', () => {
    expect(sessionLoad(workout('2026-11-02', { kind: 'sport', minutes: 60, rpe: 8 }))).toBe(480)
    expect(sessionLoad(workout('2026-11-02', { kind: 'sport', minutes: 60, effort: 5 }))).toBeNull()
    expect(sessionLoad(lift('2026-11-02', 'Squat', [[5, 80]], { rpe: 7 }))).toBeNull()
    expect(sessionLoad(workout('2026-11-02', { minutes: 25.5, rpe: 0 }))).toBe(0)
  })

  it('sums load per week by kind and counts unrated entries', () => {
    const rows = [
      workout('2026-11-10', { kind: 'sport', title: 'Football', minutes: 60, rpe: 8 }),
      workout('2026-11-11', { minutes: 30, rpe: 5 }),
      workout('2026-11-12'),
      workout('2026-11-03', { minutes: 20, rpe: 4 }),
      workout('2026-11-12', { kind: 'rest', title: 'Rest', minutes: undefined }),
    ]
    const weeks = weeklyLoads(rows, 'moon', '2026-11-12', 2)
    expect(weeks[0]).toMatchObject({ start: '2026-11-02', load: 80, unrated: 0 })
    expect(weeks[1]).toMatchObject({ start: '2026-11-09', load: 630, unrated: 1 })
    expect(weeks[1].byKind).toEqual({ strength: 0, cardio: 150, sport: 480 })
    expect(dailyLoads(rows, 'moon').get('2026-11-10')).toBe(480)
  })

  it('bands days relative to the person’s own loads', () => {
    const all = [100, 200, 300, 400, 500, 600]
    expect(loadBand(undefined, all)).toBe(0)
    expect(loadBand(100, all)).toBe(1)
    expect(loadBand(350, all)).toBe(2)
    expect(loadBand(600, all)).toBe(3)
    // Ties stay together: three identical days are the middle, not "hard".
    const tied = [123, 144, 360, 360, 810]
    expect([123, 144, 360, 810].map((load) => loadBand(load, tied))).toEqual([1, 1, 2, 3])
  })

  it('hints when this week’s load jumps well above the 4-week average, and stays quiet without history', () => {
    const steady = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'].map((date) => workout(date, { minutes: 40, rpe: 5 }))
    const today = '2026-11-19'
    const easyWeek = [...steady, workout(today, { minutes: 40, rpe: 5 })]
    expect(getNudges(easyWeek, 'moon', today).some((nudge) => nudge.kind === 'load')).toBe(false)
    const bigWeek = [...steady, workout('2026-11-17', { minutes: 60, rpe: 8 }), workout(today, { minutes: 40, rpe: 5 })]
    expect(getNudges(bigWeek, 'moon', today).find((nudge) => nudge.kind === 'load')?.message).toMatch(/240% above/)
    expect(getNudges(bigWeek.slice(3), 'moon', today).some((nudge) => nudge.kind === 'load')).toBe(false)
  })
})

describe('intervals', () => {
  const pattern = { warmup: { type: 'warmup' as const, sec: 300, speed: 6 }, work: { type: 'work' as const, sec: 30, speed: 14 }, recover: { type: 'recover' as const, sec: 90, speed: 6 }, rounds: 6, cooldown: { type: 'cooldown' as const, sec: 300, speed: 5 } }

  it('expands a pattern and reads it back', () => {
    const segments = expandPattern(pattern)
    // warm-up + 6 work + 5 recover (last one replaced by the cool-down) + cool-down
    expect(segments).toHaveLength(13)
    expect(segments.filter((segment) => segment.type === 'work')).toHaveLength(6)
    expect(patternFromSegments(segments)).toMatchObject({ rounds: 6, work: { sec: 30, speed: 14 } })
    expect(isUniformPattern(segments)).toBe(true)
    const tweaked = segments.map((segment, index) => (index === 3 ? { ...segment, speed: 15 } : segment))
    expect(isUniformPattern(tweaked)).toBe(false)
  })

  it('summarises work, recovery and distance', () => {
    const summary = intervalSummary(expandPattern(pattern))
    expect(summary).toMatchObject({ rounds: 6, workSec: 180, recoverSec: 450, totalSec: 1230, topWorkSpeed: 14, workPartSec: 30, recoverPartSec: 90 })
    // 6·300 + 14·180 + 6·450 + 5·300 = 8520 → 2.37 km
    expect(summary.distanceKm).toBe(2.37)
  })

  it('lists which progression lever moved since last time', () => {
    const before = expandPattern(pattern)
    const after = expandPattern({ ...pattern, work: { ...pattern.work, speed: 14.5 }, recover: { ...pattern.recover, sec: 75 }, rounds: 7 })
    const changes = compareIntervals(before, after)
    expect(changes.map((change) => [change.label, change.to, change.harder])).toEqual([
      ['Work speed', '14.5 km/h', true],
      ['Rounds', '7', true],
      ['Recovery', '1:15', true],
    ])
    expect(compareIntervals(before, before)).toEqual([])
  })

  it('finds the latest earlier session with the same name', () => {
    const rows = [
      workout('2026-11-01', { title: 'Treadmill', segments: expandPattern(pattern) }),
      workout('2026-11-08', { title: 'treadmill ', segments: expandPattern({ ...pattern, rounds: 7 }) }),
      workout('2026-11-09', { title: 'Treadmill' }),
    ]
    expect(lastIntervalSession(rows, 'moon', 'Treadmill')?.date).toBe('2026-11-08')
    expect(lastIntervalSession(rows, 'moon', 'Treadmill', rows[1].id)?.date).toBe('2026-11-01')
  })
})

describe('progress over time', () => {
  const rows = [
    lift('2026-09-01', 'Squat', [[5, 60], [5, 70]]),
    lift('2026-10-01', 'squat', [[3, 80]]),
    lift('2026-11-01', 'Squat', [[5, 75]], { minutes: 45, rpe: 8 }),
    lift('2026-11-02', 'Plank', [[1, 0]]),
    workout('2026-11-03', { title: 'Run', minutes: 30, distance: 5 }),
    workout('2026-11-10', { title: 'Run', minutes: 25.5, distance: 5, rpe: 6 }),
    workout('2026-11-10', { title: 'Endurance', minutes: undefined }),
    workout('2026-11-12', { kind: 'sport', title: 'Football', minutes: 90, rpe: 9 }),
    workout('2026-11-13', { kind: 'sport', title: 'Football', minutes: 60, effort: 4 }),
    workout('2026-11-12', { ownerId: 'alena', title: 'Run', minutes: 20, distance: 3 }),
  ]

  it('lists every exercise per kind, newest first, without one-tap ticks or other people', () => {
    expect(exerciseList(rows, 'moon', ['Endurance']).map((entry) => [entry.title, entry.kind, entry.sessions])).toEqual([
      ['Football', 'sport', 2],
      ['Run', 'cardio', 2],
      ['Plank', 'strength', 1],
      ['Squat', 'strength', 3],
    ])
  })

  it('charts strength by estimated 1RM, top set and volume, treating spellings as one exercise', () => {
    expect(progressSeries(rows, 'moon', 'strength', 'Squat', 'oneRepMax')).toEqual([
      { date: '2026-09-01', value: 81.7 },
      { date: '2026-10-01', value: 88 },
      { date: '2026-11-01', value: 87.5 },
    ])
    expect(progressSeries(rows, 'moon', 'strength', 'Squat', 'topWeight').map((point) => point.value)).toEqual([70, 80, 75])
    expect(progressSeries(rows, 'moon', 'strength', 'Squat', 'volume').map((point) => point.value)).toEqual([650, 240, 375])
    expect(progressSeries(rows, 'moon', 'strength', 'Squat', 'load')).toEqual([{ date: '2026-11-01', value: 360 }])
    expect(progressSeries(rows, 'moon', 'strength', 'Plank', 'bestReps')).toEqual([{ date: '2026-11-02', value: 1 }])
  })

  it('charts endurance speed and leaves unmeasurable days out instead of plotting zero', () => {
    expect(progressSeries(rows, 'moon', 'cardio', 'Run', 'avgSpeed').map((point) => point.value)).toEqual([10, 11.8])
    expect(progressSeries(rows, 'moon', 'cardio', 'Run', 'load')).toEqual([{ date: '2026-11-10', value: 153 }])
    expect(progressSeries(rows, 'moon', 'sport', 'Football', 'load')).toEqual([{ date: '2026-11-12', value: 810 }])
    expect(progressSeries(rows, 'moon', 'sport', 'Football', 'time').map((point) => point.value)).toEqual([90, 60])
  })

  it('picks metrics that fit what was logged', () => {
    expect(metricsFor('strength', rows.slice(0, 3))[0]).toBe('oneRepMax')
    expect(metricsFor('strength', [rows[3]])[0]).toBe('bestReps')
    expect(metricsFor('cardio', [workout('2026-11-01', { segments: [{ type: 'work', sec: 30, speed: 14 }] })])[0]).toBe('workSpeed')
    expect(metricsFor('sport')[0]).toBe('load')
  })

  it('summarises change, best and record-setting points', () => {
    const summary = summarizeSeries([
      { date: 'a', value: 50 },
      { date: 'b', value: 55 },
      { date: 'c', value: 52 },
      { date: 'd', value: 60 },
    ])
    expect(summary).toMatchObject({ change: 10, best: { date: 'd', value: 60 }, records: [1, 3] })
    expect(summarizeSeries([])).toBeNull()
  })

  it('turns weekly load into points and ranges into start dates', () => {
    expect(weeklyLoadSeries(rows, 'moon', '2026-11-13', 3)).toEqual([
      { date: '2026-10-26', value: 360 },
      { date: '2026-11-09', value: 963 },
    ])
    expect(rangeStart('1M', '2026-11-19')).toBe('2026-10-20')
    expect(rangeStart('All', '2026-11-19')).toBeUndefined()
  })
})

describe('holds and pace', () => {
  it('spots isometric holds by name at word starts only', () => {
    expect(['Plank', 'Side plank', 'Wall sit', 'Dead hang', 'Hollow hold', 'L-sit', 'Glute bridge hold'].every(isHoldName)).toBe(true)
    expect(['Squat', 'Hanging leg raise', 'Run', 'Bridge'].some(isHoldName)).toBe(false)
  })

  it('reads hold times as seconds or min:sec and writes them back the same way', () => {
    expect(parseHoldSeconds('45')).toBe(45)
    expect(parseHoldSeconds('1:30')).toBe(90)
    expect(parseHoldSeconds('')).toBeUndefined()
    expect(parseHoldSeconds('1:75')).toBeNaN()
    expect(parseHoldSeconds('abc')).toBeNaN()
    expect([45, 90, 600].map(holdText)).toEqual(['45', '1:30', '10:00'])
    expect([45, 90].map(holdLabel)).toEqual(['45 s', '1:30'])
  })

  it('charts the longest and total hold per day, and offers hold metrics for hold exercises', () => {
    const plank = (date: string, secs: number[], extra: Partial<Workout> = {}) =>
      workout(date, { kind: 'strength', title: 'Plank', minutes: undefined, holds: secs.map((sec) => ({ sec, weight: 0 })), ...extra })
    const rows = [plank('2026-11-01', [30, 45]), plank('2026-11-08', [60, 60, 50]), plank('2026-11-08', [20], { ownerId: 'alena' })]
    expect(metricsFor('strength', rows)).toEqual(['longestHold', 'holdTime', 'load'])
    expect(progressSeries(rows, 'moon', 'strength', 'plank', 'longestHold')).toEqual([
      { date: '2026-11-01', value: 45 },
      { date: '2026-11-08', value: 60 },
    ])
    expect(progressSeries(rows, 'moon', 'strength', 'Plank', 'holdTime').map((point) => point.value)).toEqual([75, 170])
    expect(lastSessionHolds(rows, 'moon', 'plank')).toEqual([{ sec: 60, weight: 0 }, { sec: 60, weight: 0 }, { sec: 50, weight: 0 }])
    // Holds never feed est. 1RM, so a weighted plank can't fake a squat-sized max.
    expect(progressSeries([plank('2026-11-09', [40], { holds: [{ sec: 40, weight: 20 }] })], 'moon', 'strength', 'Plank', 'oneRepMax')).toEqual([])
  })

  it('gives runners pace and everyone else speed, only with time and distance', () => {
    expect(paceText('Run', 27.5, 5)).toBe('5:30 /km')
    expect(paceText('Evening walk', 60, 5)).toBe('12:00 /km')
    expect(paceText('Cycle', 60, 24)).toBe('24 km/h')
    expect(paceText('Run', 30, undefined)).toBeNull()
  })
})
