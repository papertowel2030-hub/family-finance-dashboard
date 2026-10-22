import { useMemo, useState } from 'react'
import { Check, Dumbbell, Footprints, Minus, Plus, Trash2, Trophy } from 'lucide-react'
import { addWorkout, deleteWorkout, QUICK_TITLES, restoreWorkout, updateWorkout } from '../db/fitnessActions'
import { knownTitles, lastSessionSets } from '../lib/fitness'
import type { OwnerId, TrainingKind, Workout } from '../types'
import { todayInputDate } from '../utils/date'
import { formatNumber, parseNumber, type FitnessData, type OnDeleted } from './shared'

export const KINDS: Array<{ id: TrainingKind; label: string; Icon: typeof Dumbbell }> = [
  { id: 'strength', label: 'Strength', Icon: Dumbbell },
  { id: 'cardio', label: 'Endurance', Icon: Footprints },
  { id: 'sport', label: 'Sport', Icon: Trophy },
]

const DEFAULT_TITLES: Record<TrainingKind, string[]> = {
  strength: ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Row', 'Pull-up'],
  cardio: ['Run', 'Walk', 'Cycle', 'Swim', 'Rowing machine'],
  sport: ['Football', 'Tennis', 'Basketball', 'Padel', 'Yoga'],
}

const MAX_CHIPS = 8

type SetRow = { reps: string; weight: string }

const stepValue = (value: string, delta: number, min = 0) => {
  const current = parseNumber(value)
  const base = current !== undefined && Number.isFinite(current) ? current : 0
  return String(Math.max(min, Math.round((base + delta) * 10) / 10))
}

/**
 * Detail form for one exercise or activity. With `kind`/`date` given (the Log page) both are fixed
 * by the page, so the form stays short enough to fill in between sets.
 */
export function WorkoutForm({
  data,
  person,
  initial,
  kind: fixedKind,
  date: fixedDate,
  onDone,
}: {
  data: FitnessData
  person: OwnerId
  initial?: Workout
  kind?: TrainingKind
  date?: string
  onDone?: () => void
}) {
  const startKind: TrainingKind = initial && initial.kind !== 'rest' ? initial.kind : (fixedKind ?? 'strength')
  const [kind, setKind] = useState<TrainingKind>(startKind)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [pickedDate, setDate] = useState(initial?.date ?? todayInputDate())
  const date = fixedDate ?? pickedDate
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
    // The one-tap placeholder ("Strength", "Endurance") is not an exercise worth suggesting.
    const own = knownTitles(data.workouts, person, kind).filter((name) => name.toLowerCase() !== QUICK_TITLES[kind].toLowerCase())
    const extras = DEFAULT_TITLES[kind].filter((name) => !own.some((known) => known.toLowerCase() === name.toLowerCase()))
    return [...own, ...extras]
  }, [data.workouts, person, kind])

  const chips = suggestions.slice(0, MAX_CHIPS)
  const lastSets = kind === 'strength' && title.trim() ? lastSessionSets(data.workouts, person, title) : null
  const setsAreBlank = sets.every((set) => !set.reps && !set.weight)

  const changeKind = (next: TrainingKind) => {
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
      {initial || fixedKind ? null : (
        <div className="segmented-control fit-kinds" role="group" aria-label="Workout type">
          {KINDS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => changeKind(id)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      )}

      {chips.length ? (
        <div className="fit-title-chips" role="group" aria-label="Pick from your recent">
          {chips.map((name) => (
            <button
              key={name}
              type="button"
              className={`fit-chip pick${title.trim().toLowerCase() === name.toLowerCase() ? ' on' : ''}`}
              onClick={() => {
                setTitle(name)
                setSaved('')
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="form-grid fit-form-grid">
        <label>
          {kind === 'strength' ? 'Exercise' : kind === 'cardio' ? 'Activity' : 'Sport'}
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setSaved('')
            }}
            placeholder={kind === 'strength' ? 'e.g. Squat' : kind === 'cardio' ? 'e.g. Run' : 'e.g. Football'}
            autoComplete="off"
          />
        </label>
        {fixedDate ? null : (
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        )}
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
              <div className="fit-stepper">
                <button type="button" aria-label={`Fewer reps, set ${index + 1}`} onClick={() => updateSet(index, { reps: stepValue(set.reps, -1) })}>
                  <Minus size={16} />
                </button>
                <label>
                  <span>Reps</span>
                  <input inputMode="numeric" value={set.reps} placeholder="0" onChange={(event) => updateSet(index, { reps: event.target.value })} />
                </label>
                <button type="button" aria-label={`More reps, set ${index + 1}`} onClick={() => updateSet(index, { reps: stepValue(set.reps, 1) })}>
                  <Plus size={16} />
                </button>
              </div>
              <div className="fit-stepper">
                <button type="button" aria-label={`Lighter, set ${index + 1}`} onClick={() => updateSet(index, { weight: stepValue(set.weight, -2.5) })}>
                  <Minus size={16} />
                </button>
                <label>
                  <span>kg</span>
                  <input inputMode="decimal" value={set.weight} onChange={(event) => updateSet(index, { weight: event.target.value })} placeholder="BW" />
                </label>
                <button type="button" aria-label={`Heavier, set ${index + 1}`} onClick={() => updateSet(index, { weight: stepValue(set.weight, 2.5) })}>
                  <Plus size={16} />
                </button>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove set ${index + 1}`}
                disabled={sets.length === 1}
                onClick={() => setSets((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 size={16} />
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
        <span>
          Something hurt? <small>We’ll keep an eye on it.</small>
        </span>
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
