import { db } from './database'
import type { FitnessGoal, FitnessProfile, GoalArea, Meal, OwnerId, StrengthSet, TrainingKind, Workout } from '../types'
import { DEFAULT_TARGETS } from '../lib/fitness'
import { makeId, nowIso } from '../utils/id'

// Safety rule: this module may only touch the fitness tables (workouts, meals,
// fitnessGoals, fitnessProfiles). It must never import or write finance tables.

function cleanNumber(value: number | undefined, label: string, { min = 0, max }: { min?: number; max?: number } = {}) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < min || (max !== undefined && value > max)) {
    throw new Error(`${label} must be a number${max !== undefined ? ` between ${min} and ${max}` : ` of at least ${min}`}.`)
  }
  return value
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

// ---- Workouts ---------------------------------------------------------------

export interface WorkoutInput {
  ownerId: OwnerId
  date: string
  kind: TrainingKind
  title: string
  sets?: StrengthSet[]
  minutes?: number
  distance?: number
  effort?: number
  niggle?: boolean
  note?: string
  realmId?: string
}

/** Title given to a one-tap "I trained" entry. */
export const QUICK_TITLES: Record<TrainingKind, string> = { strength: 'Strength', cardio: 'Endurance', sport: 'Sport' }
export const REST_TITLE = 'Rest'

/** A one-tap placeholder with no detail at all: safe to replace when a detailed entry is logged. */
export function isBareMarker(workout: Workout) {
  return (
    workout.kind !== 'rest' &&
    workout.title === QUICK_TITLES[workout.kind] &&
    !workout.sets?.length &&
    !workout.minutes &&
    !workout.distance &&
    !workout.effort &&
    !workout.niggle &&
    !workout.note
  )
}

const isBare = (workout: Workout) => !workout.sets?.length && !workout.minutes

function buildWorkoutFields(input: WorkoutInput, { allowBare = false } = {}) {
  const title = input.title.trim()
  if (!title) throw new Error('Give the exercise or activity a name.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Pick a valid date.')

  const sets = input.kind === 'strength' ? (input.sets ?? []).filter((set) => set.reps > 0) : undefined
  if (input.kind === 'strength' && !sets?.length && !allowBare) throw new Error('Add at least one set with reps.')
  sets?.forEach((set) => {
    cleanNumber(set.reps, 'Reps', { min: 1, max: 1000 })
    cleanNumber(set.weight, 'Weight', { min: 0, max: 2000 })
  })

  const minutes = cleanNumber(input.minutes, 'Minutes', { min: 0, max: 1440 })
  if (input.kind !== 'strength' && !minutes && !allowBare) throw new Error('Add how many minutes you trained.')

  return {
    ownerId: input.ownerId,
    date: input.date,
    kind: input.kind,
    title,
    sets,
    minutes: input.kind === 'strength' ? minutes || undefined : minutes,
    distance: cleanNumber(input.distance, 'Distance', { min: 0, max: 1000 }) || undefined,
    effort: cleanNumber(input.effort, 'Effort', { min: 1, max: 5 }),
    niggle: input.niggle ? true : undefined,
    note: optionalText(input.note),
  }
}

const ymd = /^\d{4}-\d{2}-\d{2}$/

async function workoutsOnDay(ownerId: OwnerId, date: string) {
  return db.workouts
    .where('date')
    .equals(date)
    .filter((workout) => workout.ownerId === ownerId)
    .toArray()
}

/** Adds a detailed entry. Rest on that day gives way to the workout, and a bare one-tap marker of the same kind is folded into it. */
export async function addWorkout(input: WorkoutInput) {
  const now = nowIso()
  const workout: Workout = { id: makeId('workout'), realmId: input.realmId, ...buildWorkoutFields(input), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.workouts, async () => {
    const sameDay = await workoutsOnDay(workout.ownerId, workout.date)
    const superseded = sameDay.filter((other) => other.kind === 'rest' || (other.kind === workout.kind && isBareMarker(other)))
    if (superseded.length) await db.workouts.bulkDelete(superseded.map((other) => other.id))
    await db.workouts.add(workout)
  })
  return workout
}

export async function updateWorkout(id: string, input: WorkoutInput) {
  const existing = await db.workouts.get(id)
  if (!existing) throw new Error('That workout no longer exists.')
  // An entry that was a plain "I trained" tick may stay plain; anything with detail must keep it.
  await db.workouts.put({ ...existing, ...buildWorkoutFields(input, { allowBare: isBare(existing) }), updatedAt: nowIso() })
}

export interface QuickLogResult {
  workout: Workout
  /** Rest entries that were replaced, so Undo can put them back. */
  removedRest: Workout[]
}

/** One tap: "I trained today" with no detail (the notebook S / E tick). */
export async function logQuickSession(input: { ownerId: OwnerId; date: string; kind: TrainingKind; realmId?: string }): Promise<QuickLogResult> {
  if (!ymd.test(input.date)) throw new Error('Pick a valid date.')
  const now = nowIso()
  const workout: Workout = {
    id: makeId('workout'),
    realmId: input.realmId,
    ownerId: input.ownerId,
    date: input.date,
    kind: input.kind,
    title: QUICK_TITLES[input.kind],
    createdAt: now,
    updatedAt: now,
  }
  let removedRest: Workout[] = []
  await db.transaction('rw', db.workouts, async () => {
    removedRest = (await workoutsOnDay(input.ownerId, input.date)).filter((other) => other.kind === 'rest')
    if (removedRest.length) await db.workouts.bulkDelete(removedRest.map((other) => other.id))
    await db.workouts.add(workout)
  })
  return { workout, removedRest }
}

/** Logs a deliberate rest day. One per person per day: the id is derived so two phones can't double-log it. */
export async function logRestDay(input: { ownerId: OwnerId; date: string; realmId?: string }) {
  if (!ymd.test(input.date)) throw new Error('Pick a valid date.')
  const sameDay = await workoutsOnDay(input.ownerId, input.date)
  if (sameDay.some((other) => other.kind !== 'rest')) throw new Error('You already trained that day.')
  const existing = sameDay.find((other) => other.kind === 'rest')
  if (existing) return existing
  const now = nowIso()
  const rest: Workout = {
    id: `rest_${input.ownerId}_${input.date}`,
    realmId: input.realmId,
    ownerId: input.ownerId,
    date: input.date,
    kind: 'rest',
    title: REST_TITLE,
    createdAt: now,
    updatedAt: now,
  }
  await db.workouts.put(rest)
  return rest
}

export async function deleteWorkout(id: string) {
  await db.workouts.delete(id)
}

/** Undo for deleteWorkout: put the exact row back. */
export async function restoreWorkout(workout: Workout) {
  await db.workouts.put(workout)
}

// ---- Meals ------------------------------------------------------------------

export interface MealInput {
  ownerId: OwnerId
  date: string
  proteinG?: number
  fiberG?: number
  calories?: number
  label?: string
  realmId?: string
}

export async function addMeal(input: MealInput) {
  const proteinG = cleanNumber(input.proteinG ?? 0, 'Protein', { min: 0, max: 5000 }) ?? 0
  const fiberG = cleanNumber(input.fiberG ?? 0, 'Fiber', { min: 0, max: 1000 }) ?? 0
  const calories = cleanNumber(input.calories ?? 0, 'Calories', { min: 0, max: 20000 }) ?? 0
  if (proteinG === 0 && fiberG === 0 && calories === 0) throw new Error('Enter protein, fiber or calories.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Pick a valid date.')

  const now = nowIso()
  const meal: Meal = {
    id: makeId('meal'),
    realmId: input.realmId,
    ownerId: input.ownerId,
    date: input.date,
    proteinG,
    fiberG,
    calories,
    label: optionalText(input.label),
    createdAt: now,
    updatedAt: now,
  }
  await db.meals.add(meal)
  return meal
}

export async function deleteMeal(id: string) {
  await db.meals.delete(id)
}

export async function restoreMeal(meal: Meal) {
  await db.meals.put(meal)
}

// ---- Goals ------------------------------------------------------------------

export interface GoalInput {
  ownerId: OwnerId
  title: string
  area: GoalArea
  target?: number
  current?: number
  unit?: string
  targetDate?: string
  note?: string
  realmId?: string
}

function buildGoalFields(input: GoalInput) {
  const title = input.title.trim()
  if (!title) throw new Error('Give the goal a title.')
  return {
    ownerId: input.ownerId,
    title,
    area: input.area,
    target: cleanNumber(input.target, 'Target', { min: 0 }),
    current: cleanNumber(input.current, 'Current', { min: 0 }),
    unit: optionalText(input.unit),
    targetDate: optionalText(input.targetDate),
    note: optionalText(input.note),
  }
}

export async function addGoal(input: GoalInput) {
  const now = nowIso()
  const goal: FitnessGoal = { id: makeId('goal'), realmId: input.realmId, ...buildGoalFields(input), createdAt: now, updatedAt: now }
  await db.fitnessGoals.add(goal)
  return goal
}

export async function updateGoal(id: string, input: GoalInput) {
  const existing = await db.fitnessGoals.get(id)
  if (!existing) throw new Error('That goal no longer exists.')
  await db.fitnessGoals.put({ ...existing, ...buildGoalFields(input), updatedAt: nowIso() })
}

export async function setGoalCurrent(id: string, current: number) {
  await db.fitnessGoals.update(id, { current: cleanNumber(current, 'Current', { min: 0 }), updatedAt: nowIso() })
}

export async function setGoalDone(id: string, done: boolean) {
  await db.fitnessGoals.update(id, { done, updatedAt: nowIso() })
}

export async function setGoalArchived(id: string, archived: boolean) {
  await db.fitnessGoals.update(id, { archived, updatedAt: nowIso() })
}

export async function deleteGoal(id: string) {
  await db.fitnessGoals.delete(id)
}

export async function restoreGoal(goal: FitnessGoal) {
  await db.fitnessGoals.put(goal)
}

// ---- Profile (daily targets) --------------------------------------------------

export function profileId(ownerId: OwnerId) {
  return `fprof_${ownerId}`
}

export function profileOrDefault(profile: FitnessProfile | undefined, ownerId: OwnerId) {
  return {
    proteinTarget: profile?.proteinTarget ?? DEFAULT_TARGETS.proteinTarget,
    fiberTarget: profile?.fiberTarget ?? DEFAULT_TARGETS.fiberTarget,
    calorieTarget: profile?.calorieTarget ?? DEFAULT_TARGETS.calorieTarget,
    weeklySessions: profile?.weeklySessions ?? DEFAULT_TARGETS.weeklySessions,
    ownerId,
  }
}

export interface ProfileInput {
  ownerId: OwnerId
  proteinTarget: number
  fiberTarget: number
  calorieTarget: number
  weeklySessions: number
  realmId?: string
}

export async function saveProfile(input: ProfileInput) {
  const id = profileId(input.ownerId)
  const existing = await db.fitnessProfiles.get(id)
  const now = nowIso()
  await db.fitnessProfiles.put({
    id,
    realmId: existing?.realmId ?? input.realmId,
    ownerId: input.ownerId,
    proteinTarget: cleanNumber(input.proteinTarget, 'Protein target', { min: 0, max: 5000 }) ?? 0,
    fiberTarget: cleanNumber(input.fiberTarget, 'Fiber target', { min: 0, max: 1000 }) ?? 0,
    calorieTarget: cleanNumber(input.calorieTarget, 'Calorie target', { min: 0, max: 20000 }) ?? 0,
    weeklySessions: cleanNumber(input.weeklySessions, 'Weekly sessions', { min: 0, max: 21 }) ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}
