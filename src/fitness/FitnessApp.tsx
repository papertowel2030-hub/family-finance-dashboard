import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Table } from 'dexie'
import { BookOpen, Dumbbell, Target } from 'lucide-react'
import { db } from '../db/database'
import type { OwnerId, Workout } from '../types'
import { todayInputDate } from '../utils/date'
import { EditWorkoutDialog } from './LogTab'
import { LogPage } from './LogPage'
import { GoalsTab } from './GoalsTab'
import { JournalTab } from './JournalTab'
import { PersonSwitch, type FitnessData } from './shared'

type FitTab = 'log' | 'journal' | 'goals'

const TABS: Array<{ id: FitTab; label: string; Icon: typeof Dumbbell }> = [
  { id: 'log', label: 'Log', Icon: Dumbbell },
  { id: 'journal', label: 'Journal', Icon: BookOpen },
  { id: 'goals', label: 'Goals', Icon: Target },
]

const PERSON_KEY = 'familyFitnessPerson'
const UNDO_WINDOW_MS = 12_000

function readPerson(): OwnerId {
  try {
    return window.localStorage.getItem(PERSON_KEY) === 'alena' ? 'alena' : 'moon'
  } catch {
    return 'moon'
  }
}

async function rowsInRealm<T extends { realmId?: string }>(table: Table<T, string>, realmId?: string) {
  const rows = await table.toArray()
  return rows.filter((row) => row.realmId === realmId)
}

export function FitnessApp({ realmId }: { realmId?: string }) {
  const workouts = useLiveQuery(() => rowsInRealm(db.workouts, realmId), [realmId], [])
  const meals = useLiveQuery(() => rowsInRealm(db.meals, realmId), [realmId], [])
  const goals = useLiveQuery(() => rowsInRealm(db.fitnessGoals, realmId), [realmId], [])
  const profiles = useLiveQuery(() => rowsInRealm(db.fitnessProfiles, realmId), [realmId], [])

  const [tab, setTab] = useState<FitTab>('log')
  const [logDate, setLogDate] = useState(todayInputDate)
  const [person, setPersonState] = useState<OwnerId>(readPerson)
  const [editing, setEditing] = useState<Workout | null>(null)
  const [undoItems, setUndoItems] = useState<Array<{ id: number; label: string; undo: () => Promise<void>; at: number }>>([])

  const setPerson = (next: OwnerId) => {
    setPersonState(next)
    try {
      window.localStorage.setItem(PERSON_KEY, next)
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  useEffect(() => {
    if (!undoItems.length) return
    const oldest = Math.min(...undoItems.map((item) => item.at))
    const timer = window.setTimeout(
      () => setUndoItems((items) => items.filter((item) => Date.now() - item.at < UNDO_WINDOW_MS)),
      Math.max(0, oldest + UNDO_WINDOW_MS - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [undoItems])

  const data: FitnessData = {
    realmId,
    today: todayInputDate(),
    workouts: workouts ?? [],
    meals: meals ?? [],
    goals: goals ?? [],
    profiles: profiles ?? [],
  }

  // Opening Log from the tab bar always starts on today; "Log this day" in the Journal keeps its day.
  const openTab = (next: FitTab) => {
    if (next === 'log') setLogDate(data.today)
    setTab(next)
  }

  const onDeleted = (label: string, undo: () => Promise<void>) =>
    setUndoItems((items) => [...items, { id: Date.now() + Math.random(), label, undo, at: Date.now() }])

  return (
    <div className={`fitness${undoItems.length ? ' has-toast' : ''}`} data-section="fitness">
      <div className="fit-who">
        <PersonSwitch person={person} onChange={setPerson} />
      </div>

      <nav className="tab-bar" aria-label="Fitness sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => openTab(id)}>
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {tab === 'log' ? <LogPage data={data} person={person} date={logDate} onDate={setLogDate} onEdit={setEditing} onDeleted={onDeleted} /> : null}
      {tab === 'journal' ? (
        <JournalTab
          data={data}
          person={person}
          onEdit={setEditing}
          onDeleted={onDeleted}
          onLogDay={(date) => {
            setLogDate(date)
            setTab('log')
          }}
        />
      ) : null}
      {tab === 'goals' ? <GoalsTab data={data} person={person} onDeleted={onDeleted} /> : null}

      {editing ? <EditWorkoutDialog workout={editing} data={data} onClose={() => setEditing(null)} onDeleted={onDeleted} /> : null}

      {undoItems.length ? (
        <div className="undo-stack" role="status">
          {undoItems.slice(-3).map((item) => (
            <div className="undo-toast" key={item.id}>
              <span>{item.label}</span>
              <button
                type="button"
                onClick={async () => {
                  await item.undo()
                  setUndoItems((items) => items.filter((other) => other.id !== item.id))
                }}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
