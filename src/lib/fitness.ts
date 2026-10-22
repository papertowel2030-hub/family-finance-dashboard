import type { Meal, OwnerId, TrainingKind, Workout } from '../types'

/** Pure fitness logic: plain arrays in, plain objects out. Dates are YYYY-MM-DD strings. */

export interface DayTotals {
  proteinG: number
  fiberG: number
  calories: number
}

export interface WeekDay {
  date: string
  trained: boolean
  /** A logged rest day (never set on a day that also has a workout). */
  rest: boolean
  isToday: boolean
  isFuture: boolean
}

export interface WeekStatus {
  days: WeekDay[]
  /** Distinct days with a workout this week. */
  sessions: number
  /** Logged rest days this week. */
  rests: number
}

export interface ExercisePoint {
  date: string
  bestWeight: number
  bestReps: number
  /** Estimated one-rep max; null for bodyweight-only sessions. */
  oneRepMax: number | null
  volume: number
}

export type NudgeKind = 'rest' | 'volume' | 'niggle'

export interface Nudge {
  kind: NudgeKind
  message: string
}

/** Share a week's strength volume may grow over the previous week before we suggest easing off. */
export const VOLUME_SPIKE_RATIO = 1.3
/** Consecutive training days before we suggest a rest day. */
export const REST_AFTER_DAYS = 6

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7))
}

export function weekDates(date: string) {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export function dayTotals(meals: Meal[], ownerId: OwnerId, date: string): DayTotals {
  return meals
    .filter((meal) => meal.ownerId === ownerId && meal.date === date)
    .reduce<DayTotals>(
      (totals, meal) => ({
        proteinG: totals.proteinG + meal.proteinG,
        fiberG: totals.fiberG + meal.fiberG,
        calories: totals.calories + meal.calories,
      }),
      { proteinG: 0, fiberG: 0, calories: 0 },
    )
}

export const isRest = (workout: Workout) => workout.kind === 'rest'

/** Days with at least one real workout. Rest days are deliberately not training days. */
export function trainingDays(workouts: Workout[], ownerId: OwnerId) {
  return new Set(workouts.filter((workout) => workout.ownerId === ownerId && !isRest(workout)).map((workout) => workout.date))
}

export function restDays(workouts: Workout[], ownerId: OwnerId) {
  return new Set(workouts.filter((workout) => workout.ownerId === ownerId && isRest(workout)).map((workout) => workout.date))
}

/** The week containing `anchor` (defaults to today); `today` only drives the today/future flags. */
export function weekStatus(workouts: Workout[], ownerId: OwnerId, today: string, anchor: string = today): WeekStatus {
  const trained = trainingDays(workouts, ownerId)
  const rested = restDays(workouts, ownerId)
  const days = weekDates(anchor).map((date) => ({
    date,
    trained: trained.has(date),
    rest: !trained.has(date) && rested.has(date),
    isToday: date === today,
    isFuture: date > today,
  }))
  return { days, sessions: days.filter((day) => day.trained).length, rests: days.filter((day) => day.rest).length }
}

export interface DayInfo {
  date: string
  /** Real workouts that day, oldest first. */
  workouts: Workout[]
  /** Training kinds present, in a fixed order. */
  kinds: TrainingKind[]
  /** Rest logged and nothing else that day. */
  rest: boolean
  /** The rest entries themselves (to undo or remove). */
  restEntries: Workout[]
}

const KIND_ORDER: TrainingKind[] = ['strength', 'cardio', 'sport']

/** One entry per logged date for a person; unlogged dates are simply absent. */
export function dayMap(workouts: Workout[], ownerId: OwnerId) {
  const map = new Map<string, DayInfo>()
  const mine = workouts.filter((workout) => workout.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const workout of mine) {
    const info = map.get(workout.date) ?? { date: workout.date, workouts: [], kinds: [], rest: false, restEntries: [] }
    if (isRest(workout)) info.restEntries.push(workout)
    else info.workouts.push(workout)
    map.set(workout.date, info)
  }
  for (const info of map.values()) {
    info.workouts.sort((a, b) => KIND_ORDER.indexOf(a.kind as TrainingKind) - KIND_ORDER.indexOf(b.kind as TrainingKind))
    info.kinds = KIND_ORDER.filter((kind) => info.workouts.some((workout) => workout.kind === kind))
    info.rest = info.workouts.length === 0 && info.restEntries.length > 0
  }
  return map
}

export interface WeekCount {
  start: string
  sessions: number
  rests: number
}

/** The last `weeks` Monday-based weeks (oldest first, current week last) with training and rest day counts. */
export function weeklyCounts(workouts: Workout[], ownerId: OwnerId, today: string, weeks: number): WeekCount[] {
  const trained = trainingDays(workouts, ownerId)
  const rested = restDays(workouts, ownerId)
  const thisWeek = weekStart(today)
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(thisWeek, -7 * (weeks - 1 - index))
    const dates = weekDates(start)
    return {
      start,
      sessions: dates.filter((date) => trained.has(date)).length,
      rests: dates.filter((date) => !trained.has(date) && rested.has(date)).length,
    }
  })
}

/**
 * Consecutive weeks (ending with the current one, or the last finished one if the
 * current week hasn't hit the target yet) in which the person hit their session target.
 */
export function weekStreak(workouts: Workout[], ownerId: OwnerId, today: string, weeklyTarget: number) {
  if (weeklyTarget <= 0) return 0
  const trained = trainingDays(workouts, ownerId)
  const sessionsInWeek = (anyDateInWeek: string) => weekDates(anyDateInWeek).filter((date) => trained.has(date)).length

  let cursor = weekStart(today)
  // The current week is still in progress: it only counts once the target is met.
  if (sessionsInWeek(cursor) < weeklyTarget) cursor = addDays(cursor, -7)

  let streak = 0
  while (sessionsInWeek(cursor) >= weeklyTarget) {
    streak += 1
    cursor = addDays(cursor, -7)
  }
  return streak
}

/** Epley estimate. Returns null for bodyweight sets (weight 0) or invalid input. */
export function estimateOneRepMax(weight: number, reps: number) {
  if (weight <= 0 || reps <= 0) return null
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}

export function setVolume(workout: Workout) {
  return (workout.sets ?? []).reduce((sum, set) => sum + set.reps * set.weight, 0)
}

/** One point per day for an exercise name (case-insensitive), oldest first. */
export function exerciseHistory(workouts: Workout[], ownerId: OwnerId, title: string): ExercisePoint[] {
  const wanted = title.trim().toLowerCase()
  const byDate = new Map<string, ExercisePoint>()

  workouts
    .filter((workout) => workout.ownerId === ownerId && workout.kind === 'strength' && workout.title.trim().toLowerCase() === wanted)
    .forEach((workout) => {
      const point = byDate.get(workout.date) ?? { date: workout.date, bestWeight: 0, bestReps: 0, oneRepMax: null, volume: 0 }
      for (const set of workout.sets ?? []) {
        if (set.weight > point.bestWeight || (set.weight === point.bestWeight && set.reps > point.bestReps)) {
          point.bestWeight = set.weight
          point.bestReps = set.reps
        }
        const estimate = estimateOneRepMax(set.weight, set.reps)
        if (estimate !== null && (point.oneRepMax === null || estimate > point.oneRepMax)) point.oneRepMax = estimate
      }
      point.volume += setVolume(workout)
      byDate.set(workout.date, point)
    })

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Latest logged sets for an exercise, used to prefill "repeat last session". */
export function lastSessionSets(workouts: Workout[], ownerId: OwnerId, title: string) {
  const wanted = title.trim().toLowerCase()
  const latest = workouts
    .filter((workout) => workout.ownerId === ownerId && workout.kind === 'strength' && workout.title.trim().toLowerCase() === wanted && workout.sets?.length)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0]
  return latest?.sets ?? null
}

/** Distinct exercise/activity names the person has used for a kind, most recent first, for autocomplete. */
export function knownTitles(workouts: Workout[], ownerId: OwnerId, kind: Workout['kind']) {
  const seen = new Map<string, string>()
  workouts
    .filter((workout) => workout.ownerId === ownerId && workout.kind === kind)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((workout) => {
      const key = workout.title.trim().toLowerCase()
      if (key && !seen.has(key)) seen.set(key, workout.title.trim())
    })
  return [...seen.values()]
}

export function strengthVolumeBetween(workouts: Workout[], ownerId: OwnerId, from: string, to: string) {
  return workouts
    .filter((workout) => workout.ownerId === ownerId && workout.kind === 'strength' && workout.date >= from && workout.date <= to)
    .reduce((sum, workout) => sum + setVolume(workout), 0)
}

/** Gentle, rule-based hints to keep training consistent and avoid overuse injuries. */
export function getNudges(workouts: Workout[], ownerId: OwnerId, today: string): Nudge[] {
  const nudges: Nudge[] = []
  const trained = trainingDays(workouts, ownerId)

  // Consecutive training days ending today, or yesterday if today isn't logged yet.
  let cursor = trained.has(today) ? today : addDays(today, -1)
  let run = 0
  while (trained.has(cursor)) {
    run += 1
    cursor = addDays(cursor, -1)
  }
  if (run >= REST_AFTER_DAYS) {
    nudges.push({ kind: 'rest', message: `${run} training days in a row — a rest day helps you recover and avoid injury.` })
  }

  const thisWeek = strengthVolumeBetween(workouts, ownerId, addDays(today, -6), today)
  const lastWeek = strengthVolumeBetween(workouts, ownerId, addDays(today, -13), addDays(today, -7))
  if (lastWeek > 0 && thisWeek > lastWeek * VOLUME_SPIKE_RATIO) {
    const percent = Math.round((thisWeek / lastWeek - 1) * 100)
    nudges.push({ kind: 'volume', message: `Strength volume is up ${percent}% on last week — build up gradually to stay injury-free.` })
  }

  const recentNiggle = workouts
    .filter((workout) => workout.ownerId === ownerId && workout.niggle && workout.date >= addDays(today, -6) && workout.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (recentNiggle) {
    nudges.push({ kind: 'niggle', message: `Something hurt during ${recentNiggle.title} recently — go easy and keep an eye on it.` })
  }

  return nudges
}

export const DEFAULT_TARGETS = {
  proteinTarget: 100,
  fiberTarget: 30,
  calorieTarget: 2000,
  weeklySessions: 3,
} as const

/** Share of a daily target reached, clamped to 0..1 (0 when the target is unset). */
export function progressRatio(value: number, target: number) {
  if (!(target > 0) || !(value > 0)) return 0
  return Math.min(value / target, 1)
}
