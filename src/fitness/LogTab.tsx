import { useMemo, useState } from 'react'
import { ArrowRightLeft, Check, Dumbbell, Footprints, Minus, Plus, Trash2, Trophy } from 'lucide-react'
import { addWorkout, deleteWorkout, QUICK_TITLES, restoreWorkout, updateWorkout } from '../db/fitnessActions'
import { holdLabel, holdText, isHoldName, knownTitles, lastIntervalSession, lastSessionHolds, lastSessionSets, paceText, parseHoldSeconds } from '../lib/fitness'
import type { HoldSet, MuscleSet, OwnerId, TrainingKind, Workout } from '../types'
import { muscleResolver } from '../lib/muscles'
import { MusclePicker } from './BodyMap'
import { todayInputDate } from '../utils/date'
import {
  draftFromSegments,
  DurationField,
  durationFromMinutes,
  durationToMinutes,
  EMPTY_DURATION,
  EMPTY_INTERVALS,
  IntervalBuilder,
  RpeField,
  segmentsFromDraft,
} from './IntensityFields'
import { displayTitle, formatNumber, KIND_HINT, kindLabel, parseNumber, type FitnessData, type OnDeleted } from './shared'

export const KINDS: Array<{ id: TrainingKind; label: string; Icon: typeof Dumbbell }> = [
  { id: 'strength', label: kindLabel('strength'), Icon: Dumbbell },
  { id: 'cardio', label: kindLabel('cardio'), Icon: Footprints },
  { id: 'sport', label: kindLabel('sport'), Icon: Trophy },
]

const DEFAULT_TITLES: Record<TrainingKind, string[]> = {
  strength: ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Row', 'Pull-up', 'Plank', 'Wall sit'],
  cardio: ['Run', 'Walk', 'Cycle', 'Swim', 'Rowing machine'],
  sport: ['Football', 'Tennis', 'Basketball', 'Padel', 'Yoga'],
}

const MAX_CHIPS = 8

type SetRow = { reps: string; weight: string }
type HoldRow = { time: string; weight: string }
type SetMode = 'reps' | 'hold'

const holdRows = (holds: HoldSet[]): HoldRow[] => holds.map((hold) => ({ time: holdText(hold.sec), weight: hold.weight ? String(hold.weight) : '' }))

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
  // One-tap entries are stored as "Strength"/"Endurance"; the field shows today's name and maps it back on save.
  const [title, setTitle] = useState(initial ? displayTitle(initial) : '')
  const [pickedDate, setDate] = useState(initial?.date ?? todayInputDate())
  const date = fixedDate ?? pickedDate
  const [sets, setSets] = useState<SetRow[]>(
    initial?.sets?.length ? initial.sets.map((set) => ({ reps: String(set.reps), weight: String(set.weight) })) : [{ reps: '', weight: '' }],
  )
  const [holds, setHolds] = useState<HoldRow[]>(initial?.holds?.length ? holdRows(initial.holds) : [{ time: '', weight: '' }])
  const [modeChoice, setModeChoice] = useState<SetMode | null>(initial?.holds?.length ? 'hold' : initial?.sets?.length ? 'reps' : null)
  const [duration, setDuration] = useState(() => durationFromMinutes(initial?.segments?.length ? undefined : initial?.minutes))
  const [distance, setDistance] = useState(initial?.distance && !initial.segments?.length ? String(initial.distance) : '')
  const [rpe, setRpe] = useState<number | undefined>(initial?.rpe)
  const [muscles, setMuscles] = useState<MuscleSet | undefined>(initial?.muscles)
  const [useIntervals, setUseIntervals] = useState(Boolean(initial?.segments?.length))
  const [intervals, setIntervals] = useState(() => (initial?.segments?.length ? draftFromSegments(initial.segments) : EMPTY_INTERVALS))
  const [niggle, setNiggle] = useState(Boolean(initial?.niggle))
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)

  const suggestions = useMemo(() => {
    // The one-tap placeholder ("Strength"/"Endurance", shown as "Resistance"/"Cardio") is not an exercise worth suggesting.
    const own = knownTitles(data.workouts, person, kind).filter(
      (name) => name.toLowerCase() !== QUICK_TITLES[kind].toLowerCase() && name.toLowerCase() !== kindLabel(kind).toLowerCase(),
    )
    const extras = DEFAULT_TITLES[kind].filter((name) => !own.some((known) => known.toLowerCase() === name.toLowerCase()))
    return [...own, ...extras]
  }, [data.workouts, person, kind])

  const chips = suggestions.slice(0, MAX_CHIPS)
  const lastSets = kind === 'strength' && title.trim() ? lastSessionSets(data.workouts, person, title) : null
  const lastHolds = kind === 'strength' && title.trim() ? lastSessionHolds(data.workouts, person, title) : null
  const setsAreBlank = sets.every((set) => !set.reps && !set.weight)
  const holdsAreBlank = holds.every((hold) => !hold.time && !hold.weight)
  // Until switched by hand: holds if it was held last time or the name says so (plank, wall sit…). The name
  // beats older rep sets, because planks logged before holds existed were squeezed in as "1 rep".
  const mode: SetMode = modeChoice ?? (lastHolds || isHoldName(title) ? 'hold' : 'reps')
  const resolveMuscles = useMemo(() => muscleResolver(data.workouts), [data.workouts])
  const guessedMuscles = title.trim()
    ? resolveMuscles({ id: '', ownerId: person, date: date, kind, title, createdAt: '', updatedAt: '' })
    : null
  const lastIntervals = kind === 'cardio' && title.trim() ? (lastIntervalSession(data.workouts, person, title, initial?.id)?.segments ?? null) : null

  const changeKind = (next: TrainingKind) => {
    setKind(next)
    setTitle('')
    setError('')
    setSaved('')
  }

  const pickTitle = (next: string) => {
    setTitle(next)
    setMuscles(undefined)
    if (!initial) setModeChoice(null)
    setSaved('')
  }

  const updateHold = (index: number, patch: Partial<HoldRow>) => {
    setHolds((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
    setSaved('')
  }
  const stepHold = (text: string, delta: number) => {
    const current = parseHoldSeconds(text)
    return holdText(Math.max(0, (current !== undefined && Number.isFinite(current) ? current : 0) + delta))
  }

  const steadyPace = kind === 'cardio' && !useIntervals ? paceText(title, durationToMinutes(duration), parseNumber(distance)) : null

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
        const holdMode = kind === 'strength' && mode === 'hold'
        if (kind === 'strength' && !holdMode && parsedSets.some((set) => Number.isNaN(set.reps) || Number.isNaN(set.weight))) {
          return setError('Reps and weight must be numbers.')
        }
        const parsedHolds = holds
          .filter((hold) => hold.time.trim() || hold.weight.trim())
          .map((hold) => ({ sec: parseHoldSeconds(hold.time) ?? 0, weight: parseNumber(hold.weight) ?? 0 }))
        if (holdMode && parsedHolds.some((hold) => Number.isNaN(hold.sec) || Number.isNaN(hold.weight))) {
          return setError('Hold time is seconds (45) or min:sec (1:30); weight a number.')
        }
        if (holdMode && !parsedHolds.some((hold) => hold.sec > 0) && !(initial && !initial.sets?.length && !initial.holds?.length)) {
          return setError('Add how long you held it.')
        }
        const intervalMode = kind === 'cardio' && useIntervals
        const parsedMinutes = intervalMode ? undefined : durationToMinutes(duration)
        const parsedDistance = intervalMode ? undefined : parseNumber(distance)
        if (Number.isNaN(parsedMinutes)) return setError('Time must be minutes and seconds (seconds 0–59).')
        if (Number.isNaN(parsedDistance)) return setError('Distance must be a number.')
        const builtIntervals = intervalMode ? segmentsFromDraft(intervals) : null
        if (builtIntervals && 'error' in builtIntervals) return setError(builtIntervals.error)

        setSaving(true)
        try {
          const input = {
            ownerId: person,
            date,
            kind,
            // Reuse the existing spelling ("Squat" vs "squat") so one exercise stays one exercise.
            title:
              initial && initial.kind !== 'rest' && initial.title === QUICK_TITLES[initial.kind] && title.trim() === kindLabel(initial.kind)
                ? initial.title
                : (suggestions.find((name) => name.toLowerCase() === title.trim().toLowerCase()) ?? title),
            sets: kind === 'strength' && !holdMode ? parsedSets : undefined,
            holds: holdMode ? parsedHolds : undefined,
            minutes: parsedMinutes,
            distance: kind === 'cardio' ? parsedDistance : undefined,
            // Legacy 1–5 effort is carried through untouched; new ratings use the 0–10 RPE.
            effort: initial?.effort,
            rpe,
            muscles,
            segments: builtIntervals && 'segments' in builtIntervals ? builtIntervals.segments : undefined,
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
            setHolds([{ time: '', weight: '' }])
            setModeChoice(null)
            setDuration(EMPTY_DURATION)
            setDistance('')
            setRpe(undefined)
            setIntervals(EMPTY_INTERVALS)
            setMuscles(undefined)
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

      <p className="small-label fit-kind-hint">
        {KIND_HINT[kind]}
      </p>

      {chips.length ? (
        <div className="fit-title-chips" role="group" aria-label="Pick from your recent">
          {chips.map((name) => (
            <button
              key={name}
              type="button"
              className={`fit-chip pick${title.trim().toLowerCase() === name.toLowerCase() ? ' on' : ''}`}
              onClick={() => pickTitle(name)}
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
            onChange={(event) => pickTitle(event.target.value)}
            placeholder={kind === 'strength' ? 'e.g. Squat or Plank' : kind === 'cardio' ? 'e.g. Run' : 'e.g. Football'}
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
        <div className="segmented-control fit-mode" role="group" aria-label="Reps or hold">
          <button type="button" className={mode === 'reps' ? 'active' : ''} aria-pressed={mode === 'reps'} onClick={() => setModeChoice('reps')}>
            Reps
          </button>
          <button type="button" className={mode === 'hold' ? 'active' : ''} aria-pressed={mode === 'hold'} onClick={() => setModeChoice('hold')}>
            Hold
          </button>
        </div>
      ) : null}

      {kind === 'strength' && mode === 'hold' ? (
        <div className="fit-sets">
          <div className="fit-sets-head">
            <span>Holds</span>
            {lastHolds && holdsAreBlank ? (
              <button type="button" className="ghost-button fit-repeat" onClick={() => setHolds(holdRows(lastHolds))}>
                Repeat last: {lastHolds.map((hold) => `${holdLabel(hold.sec)}${hold.weight ? ` +${formatNumber(hold.weight)}kg` : ''}`).join(', ')}
              </button>
            ) : null}
          </div>
          {holds.map((hold, index) => (
            <div className="fit-set-row" key={index}>
              <span className="fit-set-number">{index + 1}</span>
              <div className="fit-stepper">
                <button type="button" aria-label={`5 seconds shorter, hold ${index + 1}`} onClick={() => updateHold(index, { time: stepHold(hold.time, -5) })}>
                  <Minus size={16} />
                </button>
                <label>
                  <span>sec</span>
                  <input inputMode="numeric" value={hold.time} placeholder="45" onChange={(event) => updateHold(index, { time: event.target.value })} />
                </label>
                <button type="button" aria-label={`5 seconds longer, hold ${index + 1}`} onClick={() => updateHold(index, { time: stepHold(hold.time, 5) })}>
                  <Plus size={16} />
                </button>
              </div>
              <div className="fit-stepper">
                <button type="button" aria-label={`Lighter, hold ${index + 1}`} onClick={() => updateHold(index, { weight: stepValue(hold.weight, -2.5) })}>
                  <Minus size={16} />
                </button>
                <label>
                  <span>+kg</span>
                  <input inputMode="decimal" value={hold.weight} onChange={(event) => updateHold(index, { weight: event.target.value })} placeholder="BW" />
                </label>
                <button type="button" aria-label={`Heavier, hold ${index + 1}`} onClick={() => updateHold(index, { weight: stepValue(hold.weight, 2.5) })}>
                  <Plus size={16} />
                </button>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove hold ${index + 1}`}
                disabled={holds.length === 1}
                onClick={() => setHolds((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="ghost-button fit-add-set" onClick={() => setHolds((rows) => [...rows, { ...rows[rows.length - 1] }])}>
            <Plus size={16} />
            Add hold
          </button>
          <p className="small-label">Progress by holding longer, adding a set or adding weight. One change at a time.</p>
        </div>
      ) : null}

      {kind === 'strength' && mode === 'reps' ? (
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
      ) : null}

      {kind === 'cardio' && !initial && isHoldName(title) ? (
        <p className="small-label fit-pace">{title.trim()} is muscle endurance: log it under Resistance as holds, so it counts as sets.</p>
      ) : null}

      {kind === 'cardio' ? (
        <div className="segmented-control fit-mode" role="group" aria-label="Steady or intervals">
          <button type="button" className={useIntervals ? '' : 'active'} aria-pressed={!useIntervals} onClick={() => setUseIntervals(false)}>
            Steady
          </button>
          <button type="button" className={useIntervals ? 'active' : ''} aria-pressed={useIntervals} onClick={() => setUseIntervals(true)}>
            Intervals
          </button>
        </div>
      ) : null}

      {kind === 'cardio' && useIntervals ? (
        <IntervalBuilder value={intervals} onChange={setIntervals} lastSegments={lastIntervals} />
      ) : (
        <>
          <DurationField value={duration} onChange={setDuration} optional={kind === 'strength'} />
          {kind === 'cardio' ? (
            <label className="fit-distance">
              Distance km (optional)
              <input inputMode="decimal" value={distance} onChange={(event) => setDistance(event.target.value)} />
            </label>
          ) : null}
          {steadyPace ? <p className="small-label fit-pace">≈ {steadyPace}</p> : null}
        </>
      )}

      {title.trim() ? <MusclePicker value={muscles} fallback={guessedMuscles} onChange={setMuscles} /> : null}

      <RpeField value={rpe} onChange={setRpe} legacyEffort={initial?.rpe === undefined ? initial?.effort : undefined} />

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
  const [moveError, setMoveError] = useState('')
  // Planks and wall sits logged as cardio minutes before holds existed: offer a one-tap fix, never automatic.
  const canMove = workout.kind === 'cardio' && isHoldName(workout.title) && !workout.segments?.length && Boolean(workout.minutes)
  const moveToHold = async () => {
    setMoveError('')
    try {
      await updateWorkout(workout.id, {
        ownerId: workout.ownerId,
        date: workout.date,
        kind: 'strength',
        title: workout.title,
        holds: [{ sec: Math.round((workout.minutes ?? 0) * 60), weight: 0 }],
        // Kept as the session time, so a rated entry keeps its load.
        minutes: workout.minutes,
        effort: workout.effort,
        rpe: workout.rpe,
        muscles: workout.muscles,
        niggle: workout.niggle,
        note: workout.note,
        realmId: workout.realmId,
      })
      onDeleted(`Moved ${workout.title} to Resistance as a hold`, () => restoreWorkout(workout))
      onClose()
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <div className="dialog-backdrop">
      <div className="dialog wide">
        <h2>Edit {displayTitle(workout)}</h2>
        {canMove ? (
          <div className="fit-move">
            <p className="small-label">
              {workout.title} is muscle endurance: it belongs in Resistance as a hold ({holdLabel(Math.round((workout.minutes ?? 0) * 60))}), not cardio minutes.
            </p>
            <button type="button" className="ghost-button" onClick={moveToHold}>
              <ArrowRightLeft size={16} />
              Move to Resistance as a hold
            </button>
            {moveError ? <p className="form-error">{moveError}</p> : null}
          </div>
        ) : null}
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
                onDeleted(`Deleted ${displayTitle(workout)}`, () => restoreWorkout(workout))
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
