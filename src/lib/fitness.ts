import type { IntervalSegment, Meal, OwnerId, TrainingKind, Workout } from '../types'

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

export type NudgeKind = 'rest' | 'volume' | 'load' | 'niggle'

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

  const loads = weeklyLoads(workouts, ownerId, today, LOAD_BASELINE_WEEKS + 1)
  const current = loads[loads.length - 1]
  const baseline = loads.slice(0, -1).filter((week) => week.load > 0)
  if (baseline.length >= LOAD_MIN_BASELINE_WEEKS) {
    const average = baseline.reduce((sum, week) => sum + week.load, 0) / baseline.length
    if (current.load > average * LOAD_SPIKE_RATIO) {
      const percent = Math.round((current.load / average - 1) * 100)
      nudges.push({ kind: 'load', message: `This week's training load is ${percent}% above your recent average — big jumps are when niggles like to show up.` })
    }
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

// ---- Duration ----------------------------------------------------------------

/** Minutes → "25:30" or "1:05:00" (seconds rounded). */
export function formatDuration(minutes: number) {
  const total = Math.round(minutes * 60)
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`
}

/** Seconds → "0:30" / "5:00". */
export const formatSeconds = (sec: number) => formatDuration(sec / 60)

// ---- Intensity (session RPE) ----------------------------------------------------

/** Share a week's load may exceed the recent average before we mention it. */
export const LOAD_SPIKE_RATIO = 1.3
/** Weeks averaged for the load baseline. */
export const LOAD_BASELINE_WEEKS = 4
/** Rated weeks needed before the load hint says anything. */
export const LOAD_MIN_BASELINE_WEEKS = 3

/**
 * Session-RPE training load (Foster et al. 2001): CR-10 rating × minutes, in arbitrary units.
 * Null when the session has no rating or no duration — "unrated", never guessed.
 */
export function sessionLoad(workout: Workout) {
  if (workout.kind === 'rest' || workout.rpe === undefined || !workout.minutes) return null
  return Math.round(workout.rpe * workout.minutes)
}

export interface WeekLoad {
  start: string
  load: number
  byKind: Record<TrainingKind, number>
  /** Training entries that week without a rating or duration. */
  unrated: number
}

/** The last `weeks` Monday-based weeks (oldest first) with summed session load. */
export function weeklyLoads(workouts: Workout[], ownerId: OwnerId, today: string, weeks: number): WeekLoad[] {
  const thisWeek = weekStart(today)
  const first = addDays(thisWeek, -7 * (weeks - 1))
  const result = Array.from({ length: weeks }, (_, index) => ({
    start: addDays(first, 7 * index),
    load: 0,
    byKind: { strength: 0, cardio: 0, sport: 0 } as Record<TrainingKind, number>,
    unrated: 0,
  }))
  for (const workout of workouts) {
    if (workout.ownerId !== ownerId || isRest(workout) || workout.date < first || workout.date > addDays(thisWeek, 6)) continue
    const week = result.find((row) => row.start === weekStart(workout.date))
    if (!week) continue
    const load = sessionLoad(workout)
    if (load === null) week.unrated += 1
    else {
      week.load += load
      week.byKind[workout.kind as TrainingKind] += load
    }
  }
  return result
}

/** Summed session load per date for one person (rated entries only). */
export function dailyLoads(workouts: Workout[], ownerId: OwnerId) {
  const map = new Map<string, number>()
  for (const workout of workouts) {
    if (workout.ownerId !== ownerId) continue
    const load = sessionLoad(workout)
    if (load !== null) map.set(workout.date, (map.get(workout.date) ?? 0) + load)
  }
  return map
}

/**
 * Light / medium / hard bands from the person's own training days (terciles), so the
 * calendar tint is relative to how *they* train rather than a made-up threshold.
 * Returns 0 for no rated load, else 1–3.
 */
export function loadBand(load: number | undefined, allDailyLoads: number[]) {
  if (!load) return 0
  const values = allDailyLoads.filter((value) => value > 0)
  if (values.length < 3) return 2
  // Mid-rank percentile, so equal days share a band instead of tipping into the next one.
  const below = values.filter((value) => value < load).length
  const equal = values.filter((value) => value === load).length
  const percentile = (below + equal / 2) / values.length
  if (percentile < 1 / 3) return 1
  if (percentile < 2 / 3) return 2
  return 3
}

// ---- Intervals ---------------------------------------------------------------

export interface IntervalSummary {
  rounds: number
  workSec: number
  recoverSec: number
  totalSec: number
  /** Fastest work speed, km/h. */
  topWorkSpeed: number | null
  /** Typical (median) work-part length in seconds. */
  workPartSec: number | null
  /** Typical recovery-part length in seconds. */
  recoverPartSec: number | null
  /** Highest incline used in a work part. */
  topWorkIncline: number | null
  distanceKm: number
}

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function intervalSummary(segments: IntervalSegment[]): IntervalSummary {
  const work = segments.filter((segment) => segment.type === 'work')
  const recover = segments.filter((segment) => segment.type === 'recover')
  const speeds = work.map((segment) => segment.speed ?? 0).filter((speed) => speed > 0)
  const inclines = work.map((segment) => segment.incline ?? 0).filter((incline) => incline !== 0)
  return {
    rounds: work.length,
    workSec: work.reduce((sum, segment) => sum + segment.sec, 0),
    recoverSec: recover.reduce((sum, segment) => sum + segment.sec, 0),
    totalSec: segments.reduce((sum, segment) => sum + segment.sec, 0),
    topWorkSpeed: speeds.length ? Math.max(...speeds) : null,
    workPartSec: median(work.map((segment) => segment.sec)),
    recoverPartSec: median(recover.map((segment) => segment.sec)),
    topWorkIncline: inclines.length ? Math.max(...inclines) : null,
    distanceKm: Math.round(segments.reduce((sum, segment) => sum + ((segment.speed ?? 0) * segment.sec) / 3600, 0) * 100) / 100,
  }
}

/** Latest earlier interval session with the same title, for "Repeat last" and "vs last time". */
export function lastIntervalSession(workouts: Workout[], ownerId: OwnerId, title: string, exceptId?: string) {
  const wanted = title.trim().toLowerCase()
  return (
    workouts
      .filter((workout) => workout.ownerId === ownerId && workout.kind === 'cardio' && workout.id !== exceptId && workout.title.trim().toLowerCase() === wanted && workout.segments?.length)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

export interface IntervalChange {
  label: string
  from: string
  to: string
  /** True when the change makes the session harder (the progressive-overload direction). */
  harder: boolean
}

/**
 * What moved since last time, one line per variable — the progressive-overload levers:
 * faster or longer work, more rounds, shorter recovery, steeper incline.
 */
export function compareIntervals(previous: IntervalSegment[], next: IntervalSegment[]): IntervalChange[] {
  const a = intervalSummary(previous)
  const b = intervalSummary(next)
  const changes: IntervalChange[] = []
  const num = (value: number) => String(Math.round(value * 10) / 10)
  if (a.topWorkSpeed !== null && b.topWorkSpeed !== null && a.topWorkSpeed !== b.topWorkSpeed) {
    changes.push({ label: 'Work speed', from: `${num(a.topWorkSpeed)}`, to: `${num(b.topWorkSpeed)} km/h`, harder: b.topWorkSpeed > a.topWorkSpeed })
  }
  if (a.workPartSec !== null && b.workPartSec !== null && a.workPartSec !== b.workPartSec) {
    changes.push({ label: 'Work time', from: formatSeconds(a.workPartSec), to: formatSeconds(b.workPartSec), harder: b.workPartSec > a.workPartSec })
  }
  if (a.rounds !== b.rounds && a.rounds && b.rounds) changes.push({ label: 'Rounds', from: String(a.rounds), to: String(b.rounds), harder: b.rounds > a.rounds })
  if (a.recoverPartSec !== null && b.recoverPartSec !== null && a.recoverPartSec !== b.recoverPartSec) {
    changes.push({ label: 'Recovery', from: formatSeconds(a.recoverPartSec), to: formatSeconds(b.recoverPartSec), harder: b.recoverPartSec < a.recoverPartSec })
  }
  if ((a.topWorkIncline ?? 0) !== (b.topWorkIncline ?? 0)) {
    changes.push({ label: 'Incline', from: `${num(a.topWorkIncline ?? 0)}`, to: `${num(b.topWorkIncline ?? 0)}%`, harder: (b.topWorkIncline ?? 0) > (a.topWorkIncline ?? 0) })
  }
  return changes
}

export interface IntervalPattern {
  warmup?: IntervalSegment
  work: IntervalSegment
  recover?: IntervalSegment
  rounds: number
  cooldown?: IntervalSegment
}

/** Expands warm-up + rounds × (work, recover) + cool-down. The last round skips its recovery when a cool-down follows. */
export function expandPattern(pattern: IntervalPattern): IntervalSegment[] {
  const segments: IntervalSegment[] = []
  if (pattern.warmup?.sec) segments.push({ ...pattern.warmup, type: 'warmup' })
  for (let round = 0; round < pattern.rounds; round += 1) {
    segments.push({ ...pattern.work, type: 'work' })
    const last = round === pattern.rounds - 1
    if (pattern.recover?.sec && !(last && pattern.cooldown?.sec)) segments.push({ ...pattern.recover, type: 'recover' })
  }
  if (pattern.cooldown?.sec) segments.push({ ...pattern.cooldown, type: 'cooldown' })
  return segments
}

/** Best-effort inverse of expandPattern, used to prefill the builder from a saved session. */
export function patternFromSegments(segments: IntervalSegment[]): IntervalPattern | null {
  const work = segments.filter((segment) => segment.type === 'work')
  if (!work.length) return null
  const first = (type: IntervalSegment['type']) => segments.find((segment) => segment.type === type)
  return {
    warmup: first('warmup'),
    work: work[0],
    recover: first('recover'),
    rounds: work.length,
    cooldown: first('cooldown'),
  }
}

/** True when every round matches the first one, so the simple builder can show it faithfully. */
export function isUniformPattern(segments: IntervalSegment[]) {
  const pattern = patternFromSegments(segments)
  if (!pattern) return false
  const same = (a: IntervalSegment[], b: IntervalSegment[]) =>
    a.length === b.length && a.every((segment, index) => segment.type === b[index].type && segment.sec === b[index].sec && (segment.speed ?? 0) === (b[index].speed ?? 0) && (segment.incline ?? 0) === (b[index].incline ?? 0))
  return same(expandPattern(pattern), segments)
}
