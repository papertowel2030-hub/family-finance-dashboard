import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { muscleLabel, MUSCLES, muscleWork, minutesBand, isStale, setsBand } from '../lib/muscles'
import { addDays } from '../lib/fitness'
import type { MuscleId, MuscleSet, OwnerId, Workout } from '../types'
import { formatShortDate } from '../utils/date'
import { formatNumber } from './shared'

// ---- Picker (workout form) ----------------------------------------------------------

type MuscleRole = 'primary' | 'secondary' | 'off'

const roleOf = (set: MuscleSet | null | undefined, id: MuscleId): MuscleRole =>
  set?.primary.includes(id) ? 'primary' : set?.secondary?.includes(id) ? 'secondary' : 'off'

/**
 * Shows which muscles an entry counts toward. `value` is a hand-picked set (saved on the entry);
 * `fallback` is what the body map would use otherwise (built-in guess or last pick for this name).
 */
export function MusclePicker({ value, fallback, onChange }: { value: MuscleSet | undefined; fallback: MuscleSet | null; onChange: (next: MuscleSet | undefined) => void }) {
  const [open, setOpen] = useState(false)
  const shown = value ?? fallback

  const cycle = (id: MuscleId) => {
    const base = shown ?? { primary: [], secondary: [] }
    const primary = base.primary.filter((muscle) => muscle !== id)
    const secondary = (base.secondary ?? []).filter((muscle) => muscle !== id)
    const role = roleOf(base, id)
    if (role === 'off') primary.push(id)
    if (role === 'primary') secondary.push(id)
    onChange({ primary, secondary })
  }

  return (
    <div className="fit-muscles">
      <div className="fit-muscles-summary">
        <span className="fit-field-label">
          Works <small>for the body map</small>
        </span>
        <p>
          {shown?.primary.length || shown?.secondary?.length ? (
            <>
              {shown.primary.map(muscleLabel).join(', ') || '—'}
              {shown.secondary?.length ? <small> · helpers: {shown.secondary.map(muscleLabel).join(', ')}</small> : null}
              {!value ? <small className="fit-muscles-guess"> (auto)</small> : null}
            </>
          ) : (
            <small>Not sure what this one works. Pick if you like.</small>
          )}
        </p>
        <button type="button" className="ghost-button fit-link-button" aria-expanded={open} onClick={() => setOpen((state) => !state)}>
          {open ? 'Done' : shown ? 'Change' : 'Pick muscles'}
        </button>
      </div>
      {open ? (
        <>
          <div className="fit-muscle-chips" role="group" aria-label="Muscles worked">
            {MUSCLES.map(({ id, label }) => {
              const role = roleOf(shown, id)
              return (
                <button key={id} type="button" className={`fit-chip pick muscle ${role}`} aria-label={`${label}: ${role === 'off' ? 'not worked' : role === 'primary' ? 'main' : 'helper'}`} onClick={() => cycle(id)}>
                  {label}
                  {role === 'secondary' ? <small> ½</small> : null}
                </button>
              )
            })}
          </div>
          <p className="small-label">
            Tap once = main muscle, twice = helper (counts half), again = off.
            {value ? (
              <>
                {' '}
                <button type="button" className="fit-inline-link" onClick={() => onChange(undefined)}>
                  Back to the guess
                </button>
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </div>
  )
}

// ---- Body map ---------------------------------------------------------------------

type Shape = { id: MuscleId; mirror?: boolean; el: (props: { className: string }) => ReactNode }

const ellipse = (cx: number, cy: number, rx: number, ry: number) => (props: { className: string }) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...props} />
const rect = (x: number, y: number, w: number, h: number, r: number) => (props: { className: string }) => <rect x={x} y={y} width={w} height={h} rx={r} {...props} />

/** A plain, original figure on a 100×210 grid. Left-side shapes are mirrored for the right side. */
const FRONT: Shape[] = [
  { id: 'shoulders', mirror: true, el: ellipse(32, 37, 7, 6) },
  { id: 'chest', mirror: true, el: ellipse(42.5, 43, 7.5, 7) },
  { id: 'biceps', mirror: true, el: ellipse(26.5, 54, 4.2, 9) },
  { id: 'forearms', mirror: true, el: ellipse(23.5, 74, 3.8, 10) },
  { id: 'abs', el: rect(44, 53, 12, 33, 4) },
  { id: 'obliques', mirror: true, el: ellipse(38.5, 70, 4.2, 12) },
  { id: 'quads', mirror: true, el: ellipse(41.5, 124, 7, 19) },
  { id: 'adductors', mirror: true, el: ellipse(47.6, 112, 2.2, 10) },
  { id: 'calves', mirror: true, el: ellipse(41.5, 170, 4.5, 13) },
]

const BACK: Shape[] = [
  { id: 'traps', el: (props) => <path d="M50 27 L64 35 L57 52 L50 56 L43 52 L36 35 Z" {...props} /> },
  { id: 'shoulders', mirror: true, el: ellipse(32, 37, 7, 6) },
  { id: 'triceps', mirror: true, el: ellipse(26.5, 54, 4.2, 9) },
  { id: 'forearms', mirror: true, el: ellipse(23.5, 74, 3.8, 10) },
  { id: 'lats', mirror: true, el: ellipse(39.5, 60, 6.5, 13) },
  { id: 'lowerBack', el: rect(44, 72, 12, 20, 4) },
  { id: 'glutes', mirror: true, el: ellipse(43, 104, 7.5, 8) },
  { id: 'hamstrings', mirror: true, el: ellipse(41.5, 131, 6.5, 16) },
  { id: 'calves', mirror: true, el: ellipse(41.5, 168, 5, 13) },
]

function Silhouette() {
  const half = (
    <>
      <rect x="21" y="32" width="11" height="31" rx="5" />
      <rect x="19" y="60" width="10" height="27" rx="5" />
      <circle cx="23.5" cy="91" r="4" />
      <rect x="34" y="94" width="15.5" height="94" rx="7" />
      <ellipse cx="41" cy="192" rx="7" ry="3.5" />
    </>
  )
  return (
    <g className="fit-body-base">
      <circle cx="50" cy="14" r="9" />
      <rect x="45.5" y="21" width="9" height="8" rx="3" />
      <rect x="30" y="28" width="40" height="72" rx="11" />
      {half}
      <g transform="translate(100 0) scale(-1 1)">{half}</g>
    </g>
  )
}

function Figure({ shapes, title, classFor, onPick }: { shapes: Shape[]; title: string; classFor: (id: MuscleId) => string; onPick: (id: MuscleId) => void }) {
  return (
    <figure className="fit-body-figure">
      <svg viewBox="0 0 100 200" role="group" aria-label={`${title} view`}>
        <Silhouette />
        {shapes.map(({ id, mirror, el }) => {
          const className = classFor(id)
          const press = {
            role: 'button',
            tabIndex: 0,
            'aria-label': muscleLabel(id),
            onClick: () => onPick(id),
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') onPick(id)
            },
          }
          return (
            <g key={`${title}-${id}`} {...press}>
              {el({ className })}
              {mirror ? <g transform="translate(100 0) scale(-1 1)">{el({ className })}</g> : null}
            </g>
          )
        })}
      </svg>
      <figcaption>{title}</figcaption>
    </figure>
  )
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 28, label: '4 weeks' },
]

/** Pilot: which muscles got work lately, shaded on a front/back figure. */
export function BodyMapCard({ workouts, person, today }: { workouts: Workout[]; person: OwnerId; today: string }) {
  const [days, setDays] = useState(7)
  const [measure, setMeasure] = useState<'sets' | 'minutes'>('sets')
  const [picked, setPicked] = useState<MuscleId | null>(null)
  const from = addDays(today, -(days - 1))
  const { work, unplaced } = useMemo(() => muscleWork(workouts, person, from, today), [workouts, person, from, today])
  const allMinutes = [...work.values()].map((entry) => entry.minutes)
  const anything = [...work.values()].some((entry) => entry.sets || entry.minutes)

  const band = (id: MuscleId) => {
    const entry = work.get(id)
    if (!entry) return 0
    return measure === 'sets' ? setsBand(entry.sets, days) : minutesBand(entry.minutes, allMinutes)
  }
  const classFor = (id: MuscleId) => {
    const entry = work.get(id)
    const stale = entry && !entry.sets && !entry.minutes && isStale(entry.lastDate, today)
    return `fit-muscle band-${band(id)}${stale ? ' stale' : ''}${picked === id ? ' picked' : ''}`
  }
  const detail = picked ? work.get(picked) : null

  return (
    <section className="panel fit-body">
      <div className="section-header compact">
        <h2>
          Body map <span className="type-chip fit-beta">beta</span>
        </h2>
        <div className="segmented-control fit-range" role="group" aria-label="Period">
          {RANGES.map((option) => (
            <button key={option.days} type="button" className={days === option.days ? 'active' : ''} aria-pressed={days === option.days} onClick={() => setDays(option.days)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="segmented-control fit-metrics" role="group" aria-label="Measure">
        <button type="button" className={measure === 'sets' ? 'active' : ''} aria-pressed={measure === 'sets'} onClick={() => setMeasure('sets')}>
          Resistance sets
        </button>
        <button type="button" className={measure === 'minutes' ? 'active' : ''} aria-pressed={measure === 'minutes'} onClick={() => setMeasure('minutes')}>
          All minutes
        </button>
      </div>

      <div className="fit-body-figures">
        <Figure shapes={FRONT} title="Front" classFor={classFor} onPick={(id) => setPicked(picked === id ? null : id)} />
        <Figure shapes={BACK} title="Back" classFor={classFor} onPick={(id) => setPicked(picked === id ? null : id)} />
      </div>

      {detail && picked ? (
        <div className="fit-body-detail" aria-live="polite">
          <strong>{muscleLabel(picked)}</strong>{' '}
          <span className="small-label">
            {formatNumber(detail.sets)} sets · {formatNumber(Math.round(detail.minutes))} min in {RANGES.find((option) => option.days === days)?.label}
            {measure === 'sets' && detail.sets ? ` · ~${formatNumber(Math.round(((detail.sets * 7) / days) * 10) / 10)}/week` : ''}
          </span>
          {detail.exercises.length ? (
            <ul>
              {[...detail.exercises].sort((a, b) => b.sets - a.sets || b.minutes - a.minutes).map((exercise) => (
                <li key={exercise.title}>
                  {exercise.title}
                  <small>
                    {exercise.sets ? ` ${formatNumber(exercise.sets)} sets` : ''}
                    {exercise.minutes ? ` ${formatNumber(Math.round(exercise.minutes))} min` : ''}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small-label">{detail.lastDate ? `Nothing in this period. Last worked ${formatShortDate(detail.lastDate)}.` : 'Not worked yet. It’s waiting patiently.'}</p>
          )}
        </div>
      ) : (
        <p className="small-label">{anything ? 'Tap a muscle to see what worked it.' : 'Nothing logged in this period. The figure is resting too.'}</p>
      )}

      <ul className="fit-body-legend" aria-label="Legend">
        {measure === 'sets' ? (
          <>
            <li>
              <i className="fit-muscle band-1" /> 1–4 sets/wk
            </li>
            <li>
              <i className="fit-muscle band-2" /> 5–9
            </li>
            <li>
              <i className="fit-muscle band-3" /> 10+
            </li>
          </>
        ) : (
          <>
            <li>
              <i className="fit-muscle band-1" /> less
            </li>
            <li>
              <i className="fit-muscle band-3" /> more (vs your other muscles)
            </li>
          </>
        )}
        <li>
          <i className="fit-muscle band-0 stale" /> not for 2+ weeks
        </li>
      </ul>
      <p className="small-label fit-body-note">
        Helpers count half. {measure === 'sets' ? 'Around 10+ sets a week per muscle is where studies see the most growth (Schoenfeld et al. 2017).' : 'Cardio and sport count by minutes.'}
        {unplaced.length ? ` Not placed yet: ${unplaced.slice(0, 4).join(', ')}${unplaced.length > 4 ? '…' : ''} — edit one and pick its muscles.` : ''}
      </p>
    </section>
  )
}
