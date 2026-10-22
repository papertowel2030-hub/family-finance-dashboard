import { useMemo, useState } from 'react'
import { Check, Dumbbell, Footprints, Minus, Plus, Trash2, Trophy } from 'lucide-react'
import { addWorkout, deleteWorkout, restoreWorkout, updateWorkout } from '../db/fitnessActions'
import { knownTitles, lastSessionSets } from '../lib/fitness'
import type { OwnerId, Workout, WorkoutKind } from '../types'
import { todayInputDate } from '../utils/date'
import { formatNumber, parseNumber, type FitnessData, type OnDeleted } from './shared'

const KINDS: Array<{ id: WorkoutKind; label: string; Icon: typeof Dumbbell }> = [
  { id: 'strength', label: 'Strength', Icon: Dumbbell },
  { id: 'cardio', label: 'Cardio', Icon: Footprints },
  { id: 'sport', label: 'Sport', Icon: Trophy },
]

const DEFAULT_TITLES: Record<WorkoutKind, string[]> = {
  strength: ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Row', 'Pull-up'],
  cardio: ['Run', 'Walk', 'Cycle', 'Swim', 'Rowing machine'],
  sport: ['Football', 'Tennis', 'Basketball', 'Padel', 'Yoga'],
}

type SetRow = { reps: string; weight: string }

export function LogTab({ data, person }: { data: FitnessData; person: OwnerId }) {
  return (
    <section className="panel fit-log">
      <div className="section-header compact">
        <div>
          <p className="eyebrow">Fast add</p>
          <h2>Log a workout</h2>
        </div>
      </div>
      <WorkoutForm data={data} person={person} />
    </section>
  )
}

export function WorkoutForm({
  data,
  person,
  initial,
  onDone,
}: {
  data: FitnessData
  person: OwnerId
  initial?: Workout
  onDone?: () => void
}) {
  const [kind, setKind] = useState<WorkoutKind>(initial?.kind ?? 'strength')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(initial?.date ?? todayInputDate())
  const [sets, setSets] = useState<SetRow[]>(
    initial?.sets?.length ? initial.sets.map((set) => ({ reps: String(set.reps), weight: String(set.weight) })) : [{ reps: '', weight: '' }],
  )
  const [minutes, setMinutes] = useState(initial?.minutes ? String(initial.minutes) : '')
  const [distance, setDistance] = useState(initial?.distance ? String(initial.distance) : '')
  const [effort, setEffort] = useState<number | undefined>(initial?.effort)
  const [niggle, setNiggle] = useState(Boolean(initial?.niggle))
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)

  const suggestions = useMemo(() => {
    const own = knownTitles(data.workouts, person, kind)
    const extras = DEFAULT_TITLES[kind].filter((name) => !own.some((known) => known.toLowerCase() === name.toLowerCase()))
    return [...own, ...extras]
  }, [data.workouts, person, kind])

  const lastSets = kind === 'strength' && title.trim() ? lastSessionSets(data.workouts, person, title) : null
  const setsAreBlank = sets.every((set) => !set.reps && !set.weight)

  const changeKind = (next: WorkoutKind) => {
    setKind(next)
    setTitle('')
    setError('')
    setSaved('')
  }

  const updateSet = (index: number, patch: Partial<SetRow>) => {
    setSets((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
    setSaved('')
  }

  return (
    <form
      className="entry-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        setSaved('')

        const parsedSets = sets
          .filter((set) => set.reps.trim() || set.weight.trim())
          .map((set) => ({ reps: parseNumber(set.reps) ?? 0, weight: parseNumber(set.weight) ?? 0 }))
        if (kind === 'strength' && parsedSets.some((set) => Number.isNaN(set.reps) || Number.isNaN(set.weight))) {
          return setError('Reps and weight must be numbers.')
        }
        const parsedMinutes = parseNumber(minutes)
        const parsedDistance = parseNumber(distance)
        if (Number.isNaN(parsedMinutes) || Number.isNaN(parsedDistance)) return setError('Minutes and distance must be numbers.')

        setSaving(true)
        try {
          const input = {
            ownerId: person,
            date,
            kind,
            // Reuse the existing spelling ("Squat" vs "squat") so one exercise stays one exercise.
            title: suggestions.find((name) => name.toLowerCase() === title.trim().toLowerCase()) ?? title,
            sets: kind === 'strength' ? parsedSets : undefined,
            minutes: parsedMinutes,
            distance: kind === 'cardio' ? parsedDistance : undefined,
            effort: kind === 'sport' ? effort : undefined,
            niggle,
            note,
            realmId: initial?.realmId ?? data.realmId,
          }
          if (initial) {
            await updateWorkout(initial.id, input)
            onDone?.()
          } else {
            await addWorkout(input)
            setSaved(`Saved ${title.trim()} ✓`)
            setTitle('')
            setSets([{ reps: '', weight: '' }])
            setMinutes('')
            setDistance('')
            setEffort(undefined)
            setNiggle(false)
            setNote('')
            onDone?.()
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setSaving(false)
        }
      }}
    >
      {initial ? null : (
        <div className="segmented-control fit-kinds" role="group" aria-label="Workout type">
          {KINDS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => changeKind(id)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="form-grid fit-form-grid">
        <label>
          {kind === 'strength' ? 'Exercise' : kind === 'cardio' ? 'Activity' : 'Sport'}
          <input
            list="fit-titles"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setSaved('')
            }}
            placeholder={kind === 'strength' ? 'e.g. Squat' : kind === 'cardio' ? 'e.g. Run' : 'e.g. Football'}
            autoComplete="off"
          />
          <datalist id="fit-titles">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      {kind === 'strength' ? (
        <div className="fit-sets">
          <div className="fit-sets-head">
            <span>Sets</span>
            {lastSets && setsAreBlank ? (
              <button
                type="button"
                className="ghost-button fit-repeat"
                onClick={() => setSets(lastSets.map((set) => ({ reps: String(set.reps), weight: String(set.weight) })))}
              >
                Repeat last: {lastSets.map((set) => `${set.reps}×${formatNumber(set.weight)}`).join(', ')} kg
              </button>
            ) : null}
          </div>
          {sets.map((set, index) => (
            <div className="fit-set-row" key={index}>
              <span className="fit-set-number">{index + 1}</span>
              <label>
                Reps
                <input inputMode="numeric" value={set.reps} onChange={(event) => updateSet(index, { reps: event.target.value })} />
              </label>
              <label>
                Weight kg
                <input inputMode="decimal" value={set.weight} onChange={(event) => updateSet(index, { weight: event.target.value })} placeholder="0 = bodyweight" />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove set ${index + 1}`}
                disabled={sets.length === 1}
                onClick={() => setSets((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Minus size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="ghost-button fit-add-set" onClick={() => setSets((rows) => [...rows, { ...rows[rows.length - 1] }])}>
            <Plus size={16} />
            Add set
          </button>
        </div>
      ) : (
        <div className="form-grid fit-form-grid">
          <label>
            Minutes
            <input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
          </label>
          {kind === 'cardio' ? (
            <label>
              Distance km (optional)
              <input inputMode="decimal" value={distance} onChange={(event) => setDistance(event.target.value)} />
            </label>
          ) : (
            <div className="fit-effort" role="group" aria-label="Effort">
              <span>Effort</span>
              <div>
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={effort === level ? 'active' : ''}
                    aria-pressed={effort === level}
                    onClick={() => setEffort(effort === level ? undefined : level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <label className="fit-note">
        Note (optional)
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>

      <label className="fit-check">
        <input type="checkbox" checked={niggle} onChange={(event) => setNiggle(event.target.checked)} />
        Something hurt <small>— so we can keep an eye on it</small>
      </label>

      {error ? <p className="form-error">{error}</p> : null}
      {saved ? (
        <p className="fit-saved" role="status">
          <Check size={16} /> {saved}
        </p>
      ) : null}
      <button type="submit" className="primary-button" disabled={saving}>
        <Check size={18} />
        {initial ? 'Save changes' : 'Save workout'}
      </button>
    </form>
  )
}

export function EditWorkoutDialog({
  workout,
  data,
  onClose,
  onDeleted,
}: {
  workout: Workout
  data: FitnessData
  onClose: () => void
  onDeleted: OnDeleted
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="dialog-backdrop">
      <div className="dialog wide">
        <h2>Edit {workout.title}</h2>
        <WorkoutForm data={data} person={workout.ownerId} initial={workout} onDone={onClose} />
        {confirming ? (
          <div className="dialog-actions">
            <span className="small-label">Delete this entry?</span>
            <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={async () => {
                await deleteWorkout(workout.id)
                onDeleted(`Deleted ${workout.title}`, () => restoreWorkout(workout))
                onClose()
              }}
            >
              <Trash2 size={16} />
              Yes, delete
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            <button type="button" className="ghost-button delete-link" onClick={() => setConfirming(true)}>
              <Trash2 size={16} />
              Delete…
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
