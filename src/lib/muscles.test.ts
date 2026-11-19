import { describe, expect, it } from 'vitest'
import type { Workout } from '../types'
import { cleanMuscles, guessMuscles, isStale, muscleResolver, muscleWork, setsBand } from './muscles'

const stamp = '2026-11-01T00:00:00.000Z'
let counter = 0
const row = (date: string, extra: Partial<Workout>): Workout => ({
  id: `w${++counter}`,
  ownerId: 'moon',
  date,
  kind: 'strength',
  title: 'Squat',
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
})

describe('guessing muscles', () => {
  it('knows common moves and picks specific names over general ones', () => {
    expect(guessMuscles('strength', 'Back Squat')?.primary).toEqual(['quads', 'glutes'])
    expect(guessMuscles('strength', 'Leg curl')?.primary).toEqual(['hamstrings'])
    expect(guessMuscles('strength', 'Hammer curl')?.primary).toEqual(['biceps'])
    expect(guessMuscles('strength', 'Side plank')?.primary).toEqual(['obliques'])
    expect(guessMuscles('strength', 'Plank')?.primary).toEqual(['abs'])
    expect(guessMuscles('strength', 'Wall sit')?.primary).toEqual(['quads'])
    expect(guessMuscles('strength', 'Chin-up')?.primary).toEqual(['lats'])
    expect(guessMuscles('cardio', 'Rowing machine')?.primary).toEqual(['lats', 'quads'])
    expect(guessMuscles('sport', 'Football')?.primary).toEqual(['quads', 'hamstrings', 'calves'])
  })

  it('matches keywords at word starts only, and admits when it does not know', () => {
    expect(guessMuscles('strength', 'Ab machine')).toBeNull()
    expect(guessMuscles('strength', 'Mystery move')).toBeNull()
    expect(guessMuscles('strength', '  ')).toBeNull()
  })

  it('cleans picked muscles', () => {
    expect(cleanMuscles({ primary: ['quads', 'quads', 'nope' as never], secondary: ['quads', 'glutes'] })).toEqual({ primary: ['quads'], secondary: ['glutes'] })
    expect(cleanMuscles({ primary: [] })).toBeUndefined()
  })
})

describe('muscle work', () => {
  it('prefers hand-picked muscles, then the last hand-picked set for that name, then the guess', () => {
    const picked = row('2026-11-01', { title: 'Zercher thing', muscles: { primary: ['glutes'] } })
    const later = row('2026-11-05', { title: 'zercher thing' })
    const resolve = muscleResolver([picked, later])
    expect(resolve(later)?.primary).toEqual(['glutes'])
    expect(resolve(row('2026-11-05', { title: 'Bench press' }))?.primary).toEqual(['chest', 'triceps'])
  })

  it('counts sets fully for main movers and half for helpers, and minutes for all kinds', () => {
    const rows = [
      row('2026-11-17', { sets: [{ reps: 5, weight: 80 }, { reps: 5, weight: 80 }, { reps: 5, weight: 80 }] }),
      row('2026-11-18', { kind: 'sport', title: 'Football', minutes: 60 }),
      row('2026-11-18', { title: 'Weird move', sets: [{ reps: 5, weight: 10 }] }),
      row('2026-10-01', { title: 'Calf raise', sets: [{ reps: 10, weight: 0 }] }),
      row('2026-11-18', { ownerId: 'alena', sets: [{ reps: 5, weight: 40 }] }),
    ]
    const { work, unplaced } = muscleWork(rows, 'moon', '2026-11-13', '2026-11-19')
    expect(work.get('quads')).toMatchObject({ sets: 3, minutes: 60 })
    expect(work.get('adductors')).toMatchObject({ sets: 1.5, minutes: 30 })
    expect(work.get('glutes')?.exercises).toEqual([
      { title: 'Squat', sets: 3, minutes: 0 },
      { title: 'Football', sets: 0, minutes: 30 },
    ])
    // Calf raises in October are out of range (no sets now); football still gives calves minutes and the latest date.
    expect(work.get('calves')).toMatchObject({ sets: 0, minutes: 60, lastDate: '2026-11-18' })
    expect(work.get('chest')).toMatchObject({ sets: 0, minutes: 0, lastDate: null })
    expect(unplaced).toEqual(['Weird move'])
  })

  it('bands sets per week using the ~10 weekly sets guide, and flags muscles left alone for 2 weeks', () => {
    expect([0, 3, 6, 10].map((sets) => setsBand(sets, 7))).toEqual([0, 1, 2, 3])
    expect(setsBand(40, 28)).toBe(3)
    expect(setsBand(16, 28)).toBe(1)
    expect(isStale('2026-11-01', '2026-11-19')).toBe(true)
    expect(isStale('2026-11-10', '2026-11-19')).toBe(false)
    expect(isStale(null, '2026-11-19')).toBe(false)
  })

  it('counts each hold as a set', () => {
    const rows = [row('2026-11-18', { title: 'Plank', holds: [{ sec: 45, weight: 0 }, { sec: 45, weight: 0 }, { sec: 60, weight: 0 }] })]
    const { work } = muscleWork(rows, 'moon', '2026-11-13', '2026-11-19')
    expect(work.get('abs')?.sets).toBe(3)
    expect(work.get('obliques')?.sets).toBe(1.5)
  })
})
