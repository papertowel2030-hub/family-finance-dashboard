import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, Check, Eraser, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import {
  addGoal,
  deleteGoal,
  findDuplicateOrphans,
  profileOrDefault,
  removeDuplicateOrphans,
  restoreGoal,
  restoreWorkouts,
  saveProfile,
  setGoalArchived,
  setGoalCurrent,
  setGoalDone,
  updateGoal,
} from '../db/fitnessActions'
import { progressRatio } from '../lib/fitness'
import type { FitnessGoal, GoalArea, OwnerId } from '../types'
import { formatShortDate } from '../utils/date'
import { formatNumber, parseNumber, type FitnessData, type OnDeleted } from './shared'

const AREAS: Array<{ id: GoalArea; label: string }> = [
  { id: 'strength', label: 'Strength' },
  { id: 'cardio', label: 'Cardio / endurance' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'health', label: 'Health & injury-free' },
  { id: 'other', label: 'Other' },
]

export function GoalsTab({ data, person, onDeleted }: { data: FitnessData; person: OwnerId; onDeleted: OnDeleted }) {
  const [editing, setEditing] = useState<FitnessGoal | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const mine = data.goals.filter((goal) => goal.ownerId === person)
  const active = mine.filter((goal) => !goal.archived && !goal.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const finished = mine.filter((goal) => !goal.archived && goal.done)
  const archived = mine.filter((goal) => goal.archived)

  return (
    <div className="fit-stack">
      <section className="panel">
        <div className="section-header compact">
          <h2>What I'm working toward</h2>
          <button type="button" className="primary-button" onClick={() => setEditing('new')}>
            <Plus size={18} />
            Add goal
          </button>
        </div>

        {active.length ? (
          <ul className="fit-goals">
            {active.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} />
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            No goals yet. Try “Squat 100 kg”, “Run 5 km without stopping” or “Train 3× a week for 3 months”. “Never skip leg day” also counts.
          </p>
        )}

        {finished.length ? (
          <>
            <h3 className="fit-subhead">Achieved</h3>
            <ul className="fit-goals">
              {finished.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} />
              ))}
            </ul>
          </>
        ) : null}

        {archived.length ? (
          <button type="button" className="ghost-button fit-archived-toggle" onClick={() => setShowArchived((open) => !open)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
        ) : null}
        {showArchived ? (
          <ul className="fit-goals">
            {archived.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} />
            ))}
          </ul>
        ) : null}
      </section>

      <TargetsCard data={data} person={person} />

      <OldCopiesCard realmId={data.realmId} onDeleted={onDeleted} />

      {editing ? (
        <GoalDialog
          goal={editing === 'new' ? undefined : editing}
          person={person}
          realmId={data.realmId}
          onClose={() => setEditing(null)}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  )
}

function GoalCard({ goal, onEdit }: { goal: FitnessGoal; onEdit: () => void }) {
  const hasTarget = goal.target !== undefined && goal.target > 0
  const ratio = hasTarget ? progressRatio(goal.current ?? 0, goal.target ?? 0) : goal.done ? 1 : 0
  const [value, setValue] = useState('')

  return (
    <li className={`fit-goal${goal.done ? ' done' : ''}`}>
      <button
        type="button"
        className={`fit-goal-check${goal.done ? ' on' : ''}`}
        aria-label={goal.done ? `Mark “${goal.title}” as not done` : `Mark “${goal.title}” as done`}
        aria-pressed={Boolean(goal.done)}
        onClick={() => setGoalDone(goal.id, !goal.done)}
      >
        {goal.done ? <Check size={16} /> : null}
      </button>
      <div className="fit-goal-body">
        <div className="fit-goal-title">
          <strong>{goal.title}</strong>
          <span className="type-chip fit-area">{AREAS.find((area) => area.id === goal.area)?.label ?? goal.area}</span>
        </div>
        {hasTarget ? (
          <>
            <div className="fit-bar" role="progressbar" aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={goal.current ?? 0} aria-label={`${goal.title} progress`}>
              <i style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <p className="small-label">
              {formatNumber(goal.current ?? 0)} / {formatNumber(goal.target ?? 0)} {goal.unit ?? ''}
              {goal.targetDate ? ` · by ${formatShortDate(goal.targetDate)}` : ''}
            </p>
            {!goal.done && !goal.archived ? (
              <form
                className="fit-goal-update"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const parsed = parseNumber(value)
                  if (parsed === undefined || Number.isNaN(parsed) || parsed < 0) return
                  await setGoalCurrent(goal.id, parsed)
                  if (goal.target !== undefined && parsed >= goal.target) await setGoalDone(goal.id, true)
                  setValue('')
                }}
              >
                <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Now at…" aria-label={`Update ${goal.title}`} />
                <button type="submit" className="ghost-button">
                  Update
                </button>
              </form>
            ) : null}
          </>
        ) : goal.targetDate ? (
          <p className="small-label">By {formatShortDate(goal.targetDate)}</p>
        ) : null}
        {goal.note ? <p className="small-label">{goal.note}</p> : null}
      </div>
      <button type="button" className="icon-button" aria-label={`Edit ${goal.title}`} onClick={onEdit}>
        <Pencil size={16} />
      </button>
    </li>
  )
}

function TargetsCard({ data, person }: { data: FitnessData; person: OwnerId }) {
  const stored = data.profiles.find((row) => row.ownerId === person)
  const current = profileOrDefault(stored, person)
  // Remount on person change / external sync so fields never show stale values.
  return <TargetsForm key={`${person}-${stored?.updatedAt ?? 'default'}`} current={current} person={person} realmId={data.realmId} />
}

function TargetsForm({ current, person, realmId }: { current: ReturnType<typeof profileOrDefault>; person: OwnerId; realmId?: string }) {
  const [protein, setProtein] = useState(String(current.proteinTarget))
  const [fiber, setFiber] = useState(String(current.fiberTarget))
  const [kcal, setKcal] = useState(String(current.calorieTarget))
  const [sessions, setSessions] = useState(String(current.weeklySessions))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  return (
    <section className="panel">
      <div className="section-header compact">
        <h2>
          <Target size={18} /> My targets
        </h2>
      </div>
      <form
        className="entry-form"
        onSubmit={async (event) => {
          event.preventDefault()
          setError('')
          setSaved(false)
          const values = [protein, fiber, kcal, sessions].map((value) => parseNumber(value))
          if (values.some((value) => value === undefined || Number.isNaN(value))) return setError('Targets must be numbers.')
          try {
            await saveProfile({
              ownerId: person,
              proteinTarget: values[0] as number,
              fiberTarget: values[1] as number,
              calorieTarget: values[2] as number,
              weeklySessions: values[3] as number,
              realmId,
            })
            setSaved(true)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <div className="form-grid fit-targets-grid">
          <label>
            Protein g/day
            <input inputMode="decimal" value={protein} onChange={(event) => setProtein(event.target.value)} />
          </label>
          <label>
            Fiber g/day
            <input inputMode="decimal" value={fiber} onChange={(event) => setFiber(event.target.value)} />
          </label>
          <label>
            Calories/day
            <input inputMode="decimal" value={kcal} onChange={(event) => setKcal(event.target.value)} />
          </label>
          <label>
            Sessions/week
            <input inputMode="numeric" value={sessions} onChange={(event) => setSessions(event.target.value)} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="fit-targets-actions">
          <button type="submit" className="primary-button">
            Save targets
          </button>
          {saved ? <span className="fit-saved">Saved ✓</span> : null}
        </div>
      </form>
    </section>
  )
}

function GoalDialog({
  goal,
  person,
  realmId,
  onClose,
  onDeleted,
}: {
  goal?: FitnessGoal
  person: OwnerId
  realmId?: string
  onClose: () => void
  onDeleted: OnDeleted
}) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [area, setArea] = useState<GoalArea>(goal?.area ?? 'strength')
  const [target, setTarget] = useState(goal?.target !== undefined ? String(goal.target) : '')
  const [current, setCurrent] = useState(goal?.current !== undefined ? String(goal.current) : '')
  const [unit, setUnit] = useState(goal?.unit ?? '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [note, setNote] = useState(goal?.note ?? '')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        onSubmit={async (event) => {
          event.preventDefault()
          setError('')
          const parsedTarget = parseNumber(target)
          const parsedCurrent = parseNumber(current)
          if (Number.isNaN(parsedTarget) || Number.isNaN(parsedCurrent)) return setError('Target and current must be numbers.')
          try {
            const input = { ownerId: goal?.ownerId ?? person, title, area, target: parsedTarget, current: parsedCurrent, unit, targetDate, note, realmId: goal?.realmId ?? realmId }
            if (goal) await updateGoal(goal.id, input)
            else await addGoal(input)
            onClose()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <h2>{goal ? 'Edit goal' : 'New goal'}</h2>
        <label>
          Goal
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Squat 100 kg" autoFocus />
        </label>
        <div className="form-grid fit-goal-grid">
          <label>
            Area
            <select value={area} onChange={(event) => setArea(event.target.value as GoalArea)}>
              {AREAS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target (optional)
            <input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} />
          </label>
          <label>
            Right now
            <input inputMode="decimal" value={current} onChange={(event) => setCurrent(event.target.value)} />
          </label>
          <label>
            Unit
            <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="kg, km, sessions…" />
          </label>
          <label>
            By when
            <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          </label>
        </div>
        <label>
          Note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {goal && confirming ? (
          <div className="dialog-actions">
            <span className="small-label">Delete this goal?</span>
            <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={async () => {
                await deleteGoal(goal.id)
                onDeleted(`Deleted goal ${goal.title}`, () => restoreGoal(goal))
                onClose()
              }}
            >
              <Trash2 size={16} />
              Yes, delete
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            {goal ? (
              <>
                <button type="button" className="ghost-button delete-link" onClick={() => setConfirming(true)}>
                  <Trash2 size={16} />
                  Delete…
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={async () => {
                    await setGoalArchived(goal.id, !goal.archived)
                    onClose()
                  }}
                >
                  <Archive size={16} />
                  {goal.archived ? 'Unarchive' : 'Archive'}
                </button>
              </>
            ) : null}
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              {goal ? 'Save' : 'Add goal'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

/** Shown only while hidden copies from the first notebook import still exist; vanishes after cleanup. */
function OldCopiesCard({ realmId, onDeleted }: { realmId?: string; onDeleted: OnDeleted }) {
  const copies = useLiveQuery(() => findDuplicateOrphans(realmId), [realmId], [])
  const [error, setError] = useState('')
  if (!copies?.length) return null

  return (
    <section className="panel">
      <div className="section-header compact">
        <h2>
          <Eraser size={18} /> Tidy up old copies
        </h2>
      </div>
      <p className="small-label">
        {copies.length} entries from your first import are hidden twins of days that are already in your journal. Removing them changes nothing you can see.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      <button
        type="button"
        className="ghost-button"
        onClick={async () => {
          if (!window.confirm(`Remove ${copies.length} hidden old copies? Your journal and the days it shows stay as they are.`)) return
          setError('')
          try {
            const removed = await removeDuplicateOrphans(realmId)
            onDeleted(`Removed ${removed.length} old copies`, () => restoreWorkouts(removed))
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        Remove {copies.length} old copies
      </button>
    </section>
  )
}
