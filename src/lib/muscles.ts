import type { MuscleId, MuscleSet, OwnerId, TrainingKind, Workout } from '../types'
import { addDays, loadBand } from './fitness'

/** Body-map pilot: which muscles an exercise works, and how much each one got lately. */

export const MUSCLES: Array<{ id: MuscleId; label: string }> = [
  { id: 'chest', label: 'Chest' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' },
  { id: 'forearms', label: 'Forearms' },
  { id: 'abs', label: 'Abs' },
  { id: 'obliques', label: 'Obliques' },
  { id: 'traps', label: 'Upper back' },
  { id: 'lats', label: 'Lats' },
  { id: 'lowerBack', label: 'Lower back' },
  { id: 'glutes', label: 'Glutes' },
  { id: 'quads', label: 'Quads' },
  { id: 'hamstrings', label: 'Hamstrings' },
  { id: 'adductors', label: 'Adductors' },
  { id: 'calves', label: 'Calves' },
]

const MUSCLE_IDS = new Set(MUSCLES.map((muscle) => muscle.id))
export const muscleLabel = (id: MuscleId) => MUSCLES.find((muscle) => muscle.id === id)?.label ?? id

type Rule = [keywords: string[], primary: MuscleId[], secondary?: MuscleId[]]

/**
 * Standard anatomy for common moves (main movers vs helpers). Checked in order, first keyword hit
 * wins, so specific names ("leg curl", "side plank") sit above general ones ("curl", "plank").
 */
const STRENGTH_RULES: Rule[] = [
  [['side plank'], ['obliques'], ['abs', 'shoulders']],
  [['plank'], ['abs'], ['obliques', 'shoulders']],
  [['wall sit'], ['quads'], ['glutes']],
  [['leg curl', 'hamstring curl', 'nordic'], ['hamstrings']],
  [['leg extension'], ['quads']],
  [['leg press'], ['quads', 'glutes'], ['adductors']],
  [['romanian', 'rdl', 'stiff leg', 'good morning'], ['hamstrings', 'glutes'], ['lowerBack']],
  [['deadlift'], ['glutes', 'hamstrings', 'lowerBack'], ['quads', 'traps', 'forearms']],
  [['split squat', 'lunge', 'step-up', 'step up'], ['quads', 'glutes'], ['hamstrings', 'adductors']],
  [['squat'], ['quads', 'glutes'], ['adductors', 'lowerBack']],
  [['hip thrust', 'glute bridge', 'bridge'], ['glutes'], ['hamstrings']],
  [['kettlebell swing', 'swing'], ['glutes', 'hamstrings'], ['lowerBack', 'forearms']],
  [['calf'], ['calves']],
  [['bench', 'chest press', 'fly', 'flye'], ['chest', 'triceps'], ['shoulders']],
  [['push-up', 'push up', 'pushup', 'press-up', 'press up'], ['chest', 'triceps'], ['shoulders', 'abs']],
  [['dip'], ['chest', 'triceps'], ['shoulders']],
  [['overhead press', 'shoulder press', 'military press', 'ohp', 'arnold'], ['shoulders'], ['triceps', 'traps']],
  [['lateral raise', 'front raise', 'rear delt', 'face pull'], ['shoulders'], ['traps']],
  [['pull-up', 'pull up', 'pullup', 'chin'], ['lats'], ['biceps', 'traps', 'forearms']],
  [['pulldown', 'pull-down'], ['lats'], ['biceps']],
  [['row'], ['lats', 'traps'], ['biceps', 'shoulders']],
  [['shrug'], ['traps']],
  [['tricep', 'skull', 'pushdown', 'kickback'], ['triceps']],
  [['curl'], ['biceps'], ['forearms']],
  [['farmer', 'carry'], ['forearms', 'traps'], ['abs']],
  [['russian twist', 'woodchop', 'wood chop'], ['obliques'], ['abs']],
  [['crunch', 'sit-up', 'sit up', 'situp', 'leg raise', 'hollow', 'ab wheel', 'rollout'], ['abs'], ['obliques']],
  [['back extension', 'hyperextension', 'superman'], ['lowerBack'], ['glutes']],
]

const CARDIO_RULES: Rule[] = [
  [['rowing', 'row', 'erg'], ['lats', 'quads'], ['biceps', 'hamstrings', 'glutes']],
  [['swim'], ['lats', 'shoulders'], ['triceps', 'chest', 'abs']],
  [['cycl', 'bike', 'spin'], ['quads'], ['glutes', 'calves', 'hamstrings']],
  [['stair', 'step'], ['quads', 'glutes'], ['calves']],
  [['elliptical', 'cross trainer'], ['quads'], ['glutes', 'hamstrings', 'calves']],
  [['walk', 'hike'], ['calves', 'quads'], ['glutes', 'hamstrings']],
  [['run', 'jog', 'treadmill', 'sprint'], ['quads', 'hamstrings', 'calves'], ['glutes']],
  [['jump rope', 'skipping', 'skip'], ['calves'], ['quads', 'shoulders']],
]

const SPORT_RULES: Rule[] = [
  [['football', 'soccer', 'futsal'], ['quads', 'hamstrings', 'calves'], ['glutes', 'adductors', 'abs']],
  [['tennis', 'padel', 'squash', 'badminton', 'table tennis', 'ping pong'], ['shoulders', 'forearms', 'quads'], ['calves', 'obliques']],
  [['basketball', 'volleyball', 'handball'], ['quads', 'calves', 'shoulders'], ['glutes', 'abs']],
  [['yoga', 'pilates', 'stretch'], ['abs'], ['shoulders', 'hamstrings', 'glutes']],
  [['climb', 'boulder'], ['forearms', 'lats'], ['biceps', 'shoulders', 'abs']],
  [['box', 'martial', 'mma', 'kick', 'judo', 'bjj', 'wrestl'], ['shoulders', 'abs'], ['chest', 'quads', 'obliques']],
  [['ski', 'snowboard', 'skate'], ['quads', 'glutes'], ['calves', 'abs']],
]

const RULES: Record<TrainingKind, Rule[]> = { strength: STRENGTH_RULES, cardio: CARDIO_RULES, sport: SPORT_RULES }

/** Built-in guess for an exercise name, or null when we don't know it. */
export function guessMuscles(kind: TrainingKind, title: string): MuscleSet | null {
  const name = title.trim().toLowerCase()
  if (!name) return null
  // Keywords must start a word: "chin-up" matches "chin", "ab machine" does not.
  const startsWord = (keyword: string) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)
  const rule = RULES[kind].find(([keywords]) => keywords.some(startsWord))
  return rule ? { primary: rule[1], secondary: rule[2] ?? [] } : null
}

/** Keeps only known muscle ids, removes duplicates and helpers that are also main movers. */
export function cleanMuscles(muscles: MuscleSet | undefined): MuscleSet | undefined {
  if (!muscles) return undefined
  const primary = [...new Set(muscles.primary.filter((id) => MUSCLE_IDS.has(id)))]
  const secondary = [...new Set((muscles.secondary ?? []).filter((id) => MUSCLE_IDS.has(id) && !primary.includes(id)))]
  return primary.length || secondary.length ? { primary, secondary } : undefined
}

/**
 * Resolves the muscles for every entry: picked-by-hand on the entry, else the latest hand-picked set
 * for the same name, else the built-in guess. Entries we can't place return null.
 */
export function muscleResolver(workouts: Workout[]) {
  const picked = new Map<string, MuscleSet>()
  ;[...workouts]
    .filter((workout) => workout.muscles)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .forEach((workout) => picked.set(`${workout.ownerId}|${workout.kind}|${workout.title.trim().toLowerCase()}`, workout.muscles as MuscleSet))
  return (workout: Workout): MuscleSet | null => {
    if (workout.kind === 'rest') return null
    return workout.muscles ?? picked.get(`${workout.ownerId}|${workout.kind}|${workout.title.trim().toLowerCase()}`) ?? guessMuscles(workout.kind, workout.title)
  }
}

export interface MuscleWork {
  /** Strength sets: main mover 1 per set, helper 0.5. */
  sets: number
  /** Minutes of any training: main mover full, helper half. */
  minutes: number
  /** Most recent day this muscle was worked (any time, not only in range). */
  lastDate: string | null
  /** Exercises that hit it in range, with their set/minute share. */
  exercises: Array<{ title: string; sets: number; minutes: number }>
}

/**
 * How much each muscle got between `from` and `to` (inclusive). Unknown exercises are counted in
 * `unplaced` instead of being guessed.
 */
export function muscleWork(workouts: Workout[], ownerId: OwnerId, from: string, to: string) {
  const resolve = muscleResolver(workouts)
  const work = new Map<MuscleId, MuscleWork>(MUSCLES.map((muscle) => [muscle.id, { sets: 0, minutes: 0, lastDate: null, exercises: [] }]))
  const unplaced = new Set<string>()

  for (const workout of workouts) {
    if (workout.ownerId !== ownerId || workout.kind === 'rest' || workout.date > to) continue
    const muscles = resolve(workout)
    const inRange = workout.date >= from
    if (!muscles) {
      if (inRange && (workout.sets?.length || workout.minutes)) unplaced.add(workout.title.trim())
      continue
    }
    const sets = workout.kind === 'strength' ? (workout.sets?.length ?? 0) : 0
    const minutes = workout.minutes ?? 0
    const touch = (id: MuscleId, share: number) => {
      const entry = work.get(id)
      if (!entry) return
      if (sets || minutes) entry.lastDate = !entry.lastDate || workout.date > entry.lastDate ? workout.date : entry.lastDate
      if (!inRange) return
      entry.sets += sets * share
      entry.minutes += minutes * share
      if (sets || minutes) {
        const title = workout.title.trim()
        const row = entry.exercises.find((exercise) => exercise.title.toLowerCase() === title.toLowerCase())
        if (row) {
          row.sets += sets * share
          row.minutes += minutes * share
        } else entry.exercises.push({ title, sets: sets * share, minutes: minutes * share })
      }
    }
    muscles.primary.forEach((id) => touch(id, 1))
    ;(muscles.secondary ?? []).forEach((id) => touch(id, 0.5))
  }
  return { work, unplaced: [...unplaced] }
}

/**
 * Shading for sets, using the weekly-set evidence: Schoenfeld et al. (2017) found more weekly sets per
 * muscle gave more growth, with roughly 10+ sets/week in the top group. Bands are per week on average.
 */
export function setsBand(sets: number, days: number) {
  const perWeek = (sets * 7) / days
  if (perWeek <= 0) return 0
  if (perWeek < 5) return 1
  if (perWeek < 10) return 2
  return 3
}

/** Minutes have no per-muscle standard, so they shade relative to the person's other muscles (thirds). */
export function minutesBand(minutes: number, all: number[]) {
  return loadBand(minutes, all)
}

/** Worked before, but not in the last `days` days (or never in range): worth a glance. */
export function isStale(lastDate: string | null, today: string, days = 14) {
  return Boolean(lastDate && lastDate < addDays(today, -days))
}
