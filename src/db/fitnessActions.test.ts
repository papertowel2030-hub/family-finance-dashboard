import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { exportBackup, mergeBackup, parseBackup } from './backup'
import {
  addGoal,
  addMeal,
  addWorkout,
  deleteMeal,
  deleteWorkout,
  isBareMarker,
  logQuickSession,
  logRestDay,
  profileId,
  restoreWorkout,
  saveProfile,
  setGoalCurrent,
  updateWorkout,
} from './fitnessActions'
import type { Bucket, Transaction } from '../types'

const REALM = 'rlm_fit'
const stamp = '2026-08-01T00:00:00.000Z'

const bucket: Bucket = { id: 'b1', realmId: REALM, name: 'Moon', ownerId: 'moon', kind: 'spending', createdAt: stamp, updatedAt: stamp }
const txn: Transaction = {
  id: 't1',
  realmId: REALM,
  date: '2026-08-02',
  type: 'expense',
  amount: 10,
  currency: 'RUB',
  bucketId: 'b1',
  createdAt: stamp,
  updatedAt: stamp,
}

beforeEach(async () => {
  await Promise.all([
    db.settings.clear(),
    db.buckets.clear(),
    db.incomeSources.clear(),
    db.categories.clear(),
    db.transactions.clear(),
    db.workouts.clear(),
    db.meals.clear(),
    db.fitnessGoals.clear(),
    db.fitnessProfiles.clear(),
  ])
  await db.settings.add({ id: 's1', realmId: REALM, defaultCurrency: 'RUB', createdAt: stamp, updatedAt: stamp })
  await db.buckets.add(bucket)
  await db.transactions.add(txn)
})

describe('fitness actions never touch finance data', () => {
  it('leaves finance tables identical after a full fitness workout of writes and deletes', async () => {
    const financeBefore = JSON.stringify([await db.settings.toArray(), await db.buckets.toArray(), await db.transactions.toArray()])

    const run = await addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'cardio', title: 'Run', minutes: 30, realmId: REALM })
    const lift = await addWorkout({
      ownerId: 'moon',
      date: '2026-10-21',
      kind: 'strength',
      title: 'Squat',
      sets: [{ reps: 5, weight: 80 }],
      realmId: REALM,
    })
    const meal = await addMeal({ ownerId: 'moon', date: '2026-10-21', proteinG: 25, realmId: REALM })
    const goal = await addGoal({ ownerId: 'moon', title: 'Squat 100 kg', area: 'strength', target: 100, current: 80, unit: 'kg', realmId: REALM })
    await setGoalCurrent(goal.id, 90)
    await saveProfile({ ownerId: 'moon', proteinTarget: 120, fiberTarget: 30, calorieTarget: 2200, weeklySessions: 4, realmId: REALM })
    await deleteWorkout(run.id)
    await deleteWorkout(lift.id)
    await deleteMeal(meal.id)

    const financeAfter = JSON.stringify([await db.settings.toArray(), await db.buckets.toArray(), await db.transactions.toArray()])
    expect(financeAfter).toBe(financeBefore)
  })
})

describe('workouts', () => {
  it('validates input and can update, delete and restore', async () => {
    await expect(addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'strength', title: 'Squat', sets: [] })).rejects.toThrow('at least one set')
    await expect(addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'cardio', title: 'Run', minutes: 0 })).rejects.toThrow('minutes')
    await expect(addWorkout({ ownerId: 'moon', date: 'yesterday', kind: 'cardio', title: 'Run', minutes: 10 })).rejects.toThrow('valid date')
    await expect(addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'cardio', title: '  ', minutes: 10 })).rejects.toThrow('name')
    expect(await db.workouts.count()).toBe(0)

    const saved = await addWorkout({ ownerId: 'alena', date: '2026-10-21', kind: 'sport', title: ' Football ', minutes: 60, effort: 4, realmId: REALM })
    expect(saved).toMatchObject({ title: 'Football', ownerId: 'alena', realmId: REALM })

    await updateWorkout(saved.id, { ownerId: 'alena', date: '2026-10-21', kind: 'sport', title: 'Football', minutes: 75, effort: 5, niggle: true })
    expect(await db.workouts.get(saved.id)).toMatchObject({ minutes: 75, effort: 5, niggle: true, realmId: REALM })

    const before = (await db.workouts.get(saved.id))!
    await deleteWorkout(saved.id)
    expect(await db.workouts.count()).toBe(0)
    await restoreWorkout(before)
    expect(await db.workouts.get(saved.id)).toEqual(before)
  })
})

describe('rest days and one-tap sessions', () => {
  const ids = { ownerId: 'moon' as const, date: '2026-10-21', realmId: REALM }

  it('logs one rest day per person per day, never alongside training', async () => {
    const rest = await logRestDay(ids)
    expect(rest).toMatchObject({ kind: 'rest', title: 'Rest', id: 'rest_moon_2026-10-21', realmId: REALM })
    await logRestDay(ids) // a second phone logging the same rest day adds nothing
    await logRestDay({ ...ids, ownerId: 'alena' })
    expect(await db.workouts.count()).toBe(2)

    await logQuickSession({ ...ids, date: '2026-10-22', kind: 'strength' })
    await expect(logRestDay({ ...ids, date: '2026-10-22' })).rejects.toThrow('already trained')
  })

  it('quick-logs a bare session and lets it replace a rest day, with undo information', async () => {
    const rest = await logRestDay(ids)
    const { workout, removedRest } = await logQuickSession({ ...ids, kind: 'cardio' })
    expect(workout).toMatchObject({ kind: 'cardio', title: 'Endurance', realmId: REALM })
    expect(workout.sets).toBeUndefined()
    expect(removedRest).toEqual([rest])
    expect(await db.workouts.toArray()).toEqual([workout])
  })

  it('folds a bare marker into a detailed entry of the same kind, and keeps other kinds', async () => {
    const marker = (await logQuickSession({ ...ids, kind: 'strength' })).workout
    const other = (await logQuickSession({ ...ids, kind: 'cardio' })).workout
    expect(isBareMarker(marker)).toBe(true)

    await addWorkout({ ...ids, kind: 'strength', title: 'Squat', sets: [{ reps: 5, weight: 80 }] })
    const rows = await db.workouts.toArray()
    expect(rows.map((row) => row.title).sort()).toEqual(['Endurance', 'Squat'])
    expect(rows.some((row) => row.id === marker.id)).toBe(false)
    expect(rows.some((row) => row.id === other.id)).toBe(true)
  })

  it('does not treat a noted or detailed entry as a marker, and lets a bare entry stay bare when edited', async () => {
    const { workout } = await logQuickSession({ ...ids, kind: 'strength' })
    expect(isBareMarker({ ...workout, note: 'Full back' })).toBe(false)
    expect(isBareMarker({ ...workout, sets: [{ reps: 5, weight: 0 }] })).toBe(false)

    await updateWorkout(workout.id, { ...ids, kind: 'strength', title: 'Strength', note: 'Chest + biceps' })
    expect(await db.workouts.get(workout.id)).toMatchObject({ note: 'Chest + biceps' })

    const detailed = await addWorkout({ ...ids, date: '2026-10-23', kind: 'strength', title: 'Squat', sets: [{ reps: 5, weight: 80 }] })
    await expect(updateWorkout(detailed.id, { ...ids, date: '2026-10-23', kind: 'strength', title: 'Squat', sets: [] })).rejects.toThrow('at least one set')
  })

  it('survives a backup round trip', async () => {
    await logRestDay({ ...ids, realmId: undefined })
    const backup = parseBackup(JSON.stringify({ app: 'family-finance-dashboard', version: 1, exportedAt: stamp, settings: [], buckets: [], incomeSources: [], categories: [], transactions: [], workouts: await db.workouts.toArray() }))
    expect(backup.workouts?.[0].kind).toBe('rest')
  })
})

describe('meals', () => {
  it('stores each quick-add as its own entry and rejects empty or negative entries', async () => {
    await addMeal({ ownerId: 'moon', date: '2026-10-21', proteinG: 25, realmId: REALM })
    await addMeal({ ownerId: 'moon', date: '2026-10-21', proteinG: 25, realmId: REALM })
    expect(await db.meals.count()).toBe(2)

    await expect(addMeal({ ownerId: 'moon', date: '2026-10-21' })).rejects.toThrow('Enter protein')
    await expect(addMeal({ ownerId: 'moon', date: '2026-10-21', proteinG: -5 })).rejects.toThrow('Protein')
    await expect(addMeal({ ownerId: 'moon', date: '2026-10-21', calories: Number.NaN })).rejects.toThrow('Calories')
    expect(await db.meals.count()).toBe(2)
  })
})

describe('profile', () => {
  it('uses one deterministic row per person and keeps its realm and creation time on update', async () => {
    await saveProfile({ ownerId: 'alena', proteinTarget: 90, fiberTarget: 25, calorieTarget: 1800, weeklySessions: 3, realmId: REALM })
    const first = (await db.fitnessProfiles.get(profileId('alena')))!
    await saveProfile({ ownerId: 'alena', proteinTarget: 100, fiberTarget: 25, calorieTarget: 1800, weeklySessions: 4 })

    expect(await db.fitnessProfiles.count()).toBe(1)
    expect(await db.fitnessProfiles.get(profileId('alena'))).toMatchObject({ proteinTarget: 100, weeklySessions: 4, realmId: REALM, createdAt: first.createdAt })
  })
})

describe('backup with fitness data', () => {
  it('round-trips fitness rows and finance rows through export → parse → merge into an empty db', async () => {
    await addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'cardio', title: 'Run', minutes: 30, realmId: REALM })
    await addMeal({ ownerId: 'alena', date: '2026-10-21', proteinG: 30, realmId: REALM })
    await addGoal({ ownerId: 'moon', title: 'Run 5k', area: 'cardio', realmId: REALM })
    await saveProfile({ ownerId: 'moon', proteinTarget: 120, fiberTarget: 30, calorieTarget: 2200, weeklySessions: 4, realmId: REALM })

    const exported = JSON.parse(JSON.stringify(await exportBackup(REALM)))
    const backup = parseBackup(JSON.stringify(exported))
    expect(backup.workouts).toHaveLength(1)
    expect(backup.meals).toHaveLength(1)

    await Promise.all([db.buckets.clear(), db.transactions.clear(), db.workouts.clear(), db.meals.clear(), db.fitnessGoals.clear(), db.fitnessProfiles.clear()])
    const result = await mergeBackup(backup, REALM)

    expect(result.added).toMatchObject({ buckets: 1, transactions: 1, workouts: 1, meals: 1, fitnessGoals: 1, fitnessProfiles: 1 })
    expect(await db.workouts.count()).toBe(1)
    expect(await db.transactions.get('t1')).toEqual(txn)

    // Merging the same backup again adds nothing and never overwrites.
    const again = await mergeBackup(backup, REALM)
    expect(Object.values(again.added).reduce((sum, count) => sum + count, 0)).toBe(0)
    expect(again.skippedExisting).toBeGreaterThan(0)
  })

  it('still restores an older backup that has no fitness keys, without touching existing fitness rows', async () => {
    await addWorkout({ ownerId: 'moon', date: '2026-10-21', kind: 'cardio', title: 'Run', minutes: 30, realmId: REALM })
    const legacy = {
      app: 'family-finance-dashboard',
      version: 1,
      exportedAt: stamp,
      settings: [{ id: 's1', realmId: REALM, defaultCurrency: 'RUB', createdAt: stamp, updatedAt: stamp }],
      buckets: [bucket, { ...bucket, id: 'b2', name: 'Alena', ownerId: 'alena' }],
      incomeSources: [],
      categories: [],
      transactions: [txn],
    }

    const parsed = parseBackup(JSON.stringify(legacy))
    const result = await mergeBackup(parsed, REALM)

    expect(result.added).toMatchObject({ buckets: 1, transactions: 0, workouts: 0 })
    expect(await db.workouts.count()).toBe(1)
    expect(await db.buckets.count()).toBe(2)
  })

  it('rejects a backup whose fitness section is malformed', () => {
    const bad = { app: 'family-finance-dashboard', version: 1, exportedAt: stamp, settings: [], buckets: [], incomeSources: [], categories: [], transactions: [], workouts: 'nope' }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('not a Family Finance backup')
    expect(() => parseBackup(JSON.stringify({ ...bad, workouts: [{ noId: true }] }))).toThrow('invalid record')
  })
})
