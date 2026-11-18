import { ArrowDown, ArrowUp, Minus, Plus, Repeat, Trash2 } from 'lucide-react'
import { compareIntervals, expandPattern, formatSeconds, intervalSummary, isUniformPattern, patternFromSegments } from '../lib/fitness'
import type { IntervalSegment, SegmentType } from '../types'
import { formatNumber, parseNumber } from './shared'

// ---- Duration (min : sec) ---------------------------------------------------------

export interface DurationDraft {
  min: string
  sec: string
}

export const EMPTY_DURATION: DurationDraft = { min: '', sec: '' }

export function durationFromMinutes(minutes: number | undefined): DurationDraft {
  if (!minutes) return EMPTY_DURATION
  const total = Math.round(minutes * 60)
  const sec = total % 60
  return { min: String(Math.floor(total / 60)), sec: sec ? String(sec) : '' }
}

/** Draft → minutes. Blank → undefined; unreadable or seconds ≥ 60 → NaN. */
export function durationToMinutes(draft: DurationDraft): number | undefined {
  const min = parseNumber(draft.min)
  const sec = parseNumber(draft.sec)
  if (min === undefined && sec === undefined) return undefined
  if (Number.isNaN(min) || Number.isNaN(sec) || (sec ?? 0) < 0 || (sec ?? 0) >= 60 || (min ?? 0) < 0) return Number.NaN
  return (min ?? 0) + (sec ?? 0) / 60
}

const DURATION_CHIPS = [20, 30, 45, 60, 90]

export function DurationField({ value, onChange, label = 'Time', optional = false }: { value: DurationDraft; onChange: (next: DurationDraft) => void; label?: string; optional?: boolean }) {
  return (
    <div className="fit-duration">
      <span className="fit-field-label">
        {label}
        {optional ? <small> (optional, needed for load)</small> : null}
      </span>
      <div className="fit-duration-row">
        <TimeInputs value={value} onChange={onChange} labelPrefix={label} />
        <div className="fit-duration-chips" role="group" aria-label="Quick minutes">
          {DURATION_CHIPS.map((minutes) => (
            <button key={minutes} type="button" className={`fit-chip pick${value.min === String(minutes) && !value.sec ? ' on' : ''}`} onClick={() => onChange({ min: String(minutes), sec: '' })}>
              {minutes}′
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimeInputs({ value, onChange, labelPrefix }: { value: DurationDraft; onChange: (next: DurationDraft) => void; labelPrefix: string }) {
  return (
    <span className="fit-time">
      <input inputMode="numeric" value={value.min} placeholder="min" aria-label={`${labelPrefix} minutes`} onChange={(event) => onChange({ ...value, min: event.target.value })} />
      <b aria-hidden="true">:</b>
      <input inputMode="numeric" value={value.sec} placeholder="sec" aria-label={`${labelPrefix} seconds`} onChange={(event) => onChange({ ...value, sec: event.target.value })} />
    </span>
  )
}

// ---- How hard (session RPE, CR-10) ----------------------------------------------

/** Verbal anchors of the session-RPE CR-10 scale (Foster et al. 2001), with a wink. */
export const RPE_ANCHORS: Record<number, { name: string; joke: string }> = {
  0: { name: 'Rest', joke: 'Did you even get up?' },
  1: { name: 'Very, very easy', joke: 'A stroll to the fridge.' },
  2: { name: 'Easy', joke: 'Could chat the whole time.' },
  3: { name: 'Moderate', joke: 'Still talking, shorter sentences.' },
  4: { name: 'Somewhat hard', joke: 'Talking is now optional.' },
  5: { name: 'Hard', joke: 'Words are getting expensive.' },
  6: { name: 'Hard +', joke: 'Single sentences, with pauses.' },
  7: { name: 'Very hard', joke: 'One-word answers only.' },
  8: { name: 'Very hard +', joke: 'Please don’t ask questions.' },
  9: { name: 'Near max', joke: 'Seeing colours.' },
  10: { name: 'Maximal', joke: 'Saw the light. Briefly.' },
}

export function RpeField({ value, onChange, legacyEffort }: { value: number | undefined; onChange: (next: number | undefined) => void; legacyEffort?: number }) {
  const anchor = value !== undefined ? RPE_ANCHORS[value] : undefined
  return (
    <div className="fit-rpe" role="group" aria-label="How hard was the whole session, 0 to 10">
      <span className="fit-field-label">
        How hard? <small>whole session, 0–10</small>
      </span>
      <div className="fit-rpe-scale">
        {Array.from({ length: 11 }, (_, level) => (
          <button
            key={level}
            type="button"
            className={`lvl-${level}${value === level ? ' active' : ''}`}
            aria-pressed={value === level}
            aria-label={`${level}, ${RPE_ANCHORS[level].name}`}
            onClick={() => onChange(value === level ? undefined : level)}
          >
            {level}
          </button>
        ))}
      </div>
      <p className="fit-rpe-hint" aria-live="polite">
        {anchor ? (
          <>
            <strong>{anchor.name}.</strong> {anchor.joke}
          </>
        ) : legacyEffort ? (
          <>Old rating: effort {legacyEffort}/5. Pick 0–10 so it counts toward load.</>
        ) : (
          <>Rate the whole thing, not just the last sprint.</>
        )}
      </p>
    </div>
  )
}

// ---- Intervals --------------------------------------------------------------------

export interface SegmentDraft {
  type: SegmentType
  min: string
  sec: string
  speed: string
  incline: string
}

export interface IntervalDraft {
  /** 'pattern' = warm-up · rounds × (work, recover) · cool-down; 'custom' = every part editable. */
  mode: 'pattern' | 'custom'
  warmup: SegmentDraft
  work: SegmentDraft
  recover: SegmentDraft
  cooldown: SegmentDraft
  rounds: string
  rows: SegmentDraft[]
}

const blank = (type: SegmentType): SegmentDraft => ({ type, min: '', sec: '', speed: '', incline: '' })

export const EMPTY_INTERVALS: IntervalDraft = {
  mode: 'pattern',
  warmup: blank('warmup'),
  work: blank('work'),
  recover: blank('recover'),
  cooldown: blank('cooldown'),
  rounds: '6',
  rows: [],
}

const SEGMENT_LABEL: Record<SegmentType, string> = { warmup: 'Warm-up', work: 'Work', recover: 'Recover', cooldown: 'Cool-down' }

function draftFromSegment(segment: IntervalSegment | undefined, type: SegmentType): SegmentDraft {
  if (!segment) return blank(type)
  const sec = segment.sec % 60
  return {
    type,
    min: String(Math.floor(segment.sec / 60)),
    sec: sec ? String(sec) : '',
    speed: segment.speed ? String(segment.speed) : '',
    incline: segment.incline ? String(segment.incline) : '',
  }
}

export function draftFromSegments(segments: IntervalSegment[]): IntervalDraft {
  const pattern = patternFromSegments(segments)
  const rows = segments.map((segment) => draftFromSegment(segment, segment.type))
  if (!pattern) return { ...EMPTY_INTERVALS, mode: 'custom', rows }
  return {
    mode: isUniformPattern(segments) ? 'pattern' : 'custom',
    warmup: draftFromSegment(pattern.warmup, 'warmup'),
    work: draftFromSegment(pattern.work, 'work'),
    recover: draftFromSegment(pattern.recover, 'recover'),
    cooldown: draftFromSegment(pattern.cooldown, 'cooldown'),
    rounds: String(pattern.rounds),
    rows,
  }
}

function segmentFromDraft(draft: SegmentDraft): IntervalSegment | null | 'invalid' {
  const minutes = durationToMinutes({ min: draft.min, sec: draft.sec })
  const speed = parseNumber(draft.speed)
  const incline = parseNumber(draft.incline)
  if (Number.isNaN(minutes) || Number.isNaN(speed) || Number.isNaN(incline)) return 'invalid'
  const sec = Math.round((minutes ?? 0) * 60)
  if (!sec) return null
  const segment: IntervalSegment = { type: draft.type, sec }
  if (speed) segment.speed = speed
  if (incline) segment.incline = incline
  return segment
}

/** Draft → saved parts, or a friendly error. */
export function segmentsFromDraft(draft: IntervalDraft): { segments: IntervalSegment[] } | { error: string } {
  const invalid = { error: 'Times, speeds and inclines must be numbers (seconds 0–59).' }
  if (draft.mode === 'custom') {
    const parsed = draft.rows.map(segmentFromDraft)
    if (parsed.includes('invalid')) return invalid
    const segments = parsed.filter((segment): segment is IntervalSegment => segment !== null && segment !== 'invalid')
    if (!segments.some((segment) => segment.type === 'work')) return { error: 'Add at least one work part with a time.' }
    return { segments }
  }
  const parts = [draft.warmup, draft.work, draft.recover, draft.cooldown].map(segmentFromDraft)
  if (parts.includes('invalid')) return invalid
  const [warmup, work, recover, cooldown] = parts as Array<IntervalSegment | null>
  const rounds = parseNumber(draft.rounds)
  if (!work) return { error: 'Give the work part a time, e.g. 0:30.' }
  if (rounds === undefined || Number.isNaN(rounds) || rounds < 1 || rounds > 30 || !Number.isInteger(rounds)) return { error: 'Rounds must be a whole number from 1 to 30.' }
  return { segments: expandPattern({ warmup: warmup ?? undefined, work, recover: recover ?? undefined, rounds, cooldown: cooldown ?? undefined }) }
}

const isBlankDraft = (draft: IntervalDraft) => (draft.mode === 'pattern' ? !draft.work.min && !draft.work.sec : !draft.rows.length)

export function IntervalBuilder({
  value,
  onChange,
  lastSegments,
}: {
  value: IntervalDraft
  onChange: (next: IntervalDraft) => void
  /** Parts from the latest earlier session with the same name, if any. */
  lastSegments: IntervalSegment[] | null
}) {
  const result = segmentsFromDraft(value)
  const current = 'segments' in result ? result.segments : null
  const summary = current ? intervalSummary(current) : null
  const changes = current && lastSegments ? compareIntervals(lastSegments, current) : []

  const setPart = (key: 'warmup' | 'work' | 'recover' | 'cooldown', patch: Partial<SegmentDraft>) => onChange({ ...value, [key]: { ...value[key], ...patch } })
  const setRow = (index: number, patch: Partial<SegmentDraft>) => onChange({ ...value, rows: value.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)) })
  const rounds = parseNumber(value.rounds)
  const stepRounds = (delta: number) => onChange({ ...value, rounds: String(Math.min(30, Math.max(1, (rounds && !Number.isNaN(rounds) ? rounds : 0) + delta))) })

  const toCustom = () => {
    const expanded = 'segments' in result ? result.segments : []
    onChange({ ...value, mode: 'custom', rows: expanded.length ? expanded.map((segment) => draftFromSegment(segment, segment.type)) : value.rows })
  }

  return (
    <div className="fit-intervals">
      {lastSegments && isBlankDraft(value) ? (
        <button type="button" className="ghost-button fit-repeat" onClick={() => onChange(draftFromSegments(lastSegments))}>
          <Repeat size={15} /> Repeat last: {describeIntervals(lastSegments)}
        </button>
      ) : null}

      {value.mode === 'pattern' ? (
        <>
          <SegmentRow draft={value.warmup} onChange={(patch) => setPart('warmup', patch)} />
          <div className="fit-round-box">
            <div className="fit-round-head">
              <span>Each round</span>
              <div className="fit-rounds" role="group" aria-label="Rounds">
                <button type="button" aria-label="Fewer rounds" onClick={() => stepRounds(-1)}>
                  <Minus size={16} />
                </button>
                <label>
                  <input inputMode="numeric" value={value.rounds} aria-label="Rounds" onChange={(event) => onChange({ ...value, rounds: event.target.value })} />
                  <span>rounds</span>
                </label>
                <button type="button" aria-label="More rounds" onClick={() => stepRounds(1)}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <SegmentRow draft={value.work} onChange={(patch) => setPart('work', patch)} />
            <SegmentRow draft={value.recover} onChange={(patch) => setPart('recover', patch)} />
          </div>
          <SegmentRow draft={value.cooldown} onChange={(patch) => setPart('cooldown', patch)} />
          <button type="button" className="ghost-button fit-link-button" onClick={toCustom}>
            Rounds not all the same? Edit them one by one
          </button>
        </>
      ) : (
        <>
          {value.rows.map((row, index) => (
            <SegmentRow
              key={index}
              draft={row}
              onChange={(patch) => setRow(index, patch)}
              onTypeChange={(type) => setRow(index, { type })}
              onRemove={() => onChange({ ...value, rows: value.rows.filter((_, rowIndex) => rowIndex !== index) })}
            />
          ))}
          <div className="fit-seg-add">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                const lastWork = [...value.rows].reverse().find((row) => row.type === 'work') ?? blank('work')
                const lastRecover = [...value.rows].reverse().find((row) => row.type === 'recover') ?? blank('recover')
                const cooldownAt = value.rows.findIndex((row) => row.type === 'cooldown')
                const insertAt = cooldownAt === -1 ? value.rows.length : cooldownAt
                const rows = [...value.rows]
                // Keep work/recover alternating: add a recovery first if the round before ended on work.
                const added = rows[insertAt - 1]?.type === 'work' ? [{ ...lastRecover }, { ...lastWork }] : [{ ...lastWork }]
                rows.splice(insertAt, 0, ...added)
                onChange({ ...value, rows })
              }}
            >
              <Plus size={16} /> Add a round
            </button>
          </div>
        </>
      )}

      {summary ? (
        <p className="fit-interval-summary">
          {summary.rounds} × {summary.workPartSec ? formatSeconds(summary.workPartSec) : '—'}
          {summary.topWorkSpeed ? ` @ ${formatNumber(summary.topWorkSpeed)} km/h` : ''} · total {formatSeconds(summary.totalSec)}
          {summary.distanceKm ? ` · ${formatNumber(summary.distanceKm)} km` : ''}
        </p>
      ) : null}

      {changes.length ? (
        <ul className="fit-interval-changes" aria-label="Compared with last time">
          {changes.map((change) => (
            <li key={change.label} className={change.harder ? 'harder' : 'easier'}>
              {change.harder ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
              {change.label} {change.from} → {change.to}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function SegmentRow({
  draft,
  onChange,
  onTypeChange,
  onRemove,
}: {
  draft: SegmentDraft
  onChange: (patch: Partial<SegmentDraft>) => void
  onTypeChange?: (type: SegmentType) => void
  onRemove?: () => void
}) {
  const label = SEGMENT_LABEL[draft.type]
  return (
    <div className={`fit-seg ${draft.type}`}>
      {onTypeChange ? (
        <select className="fit-seg-label" value={draft.type} aria-label="Part" onChange={(event) => onTypeChange(event.target.value as SegmentType)}>
          {(Object.keys(SEGMENT_LABEL) as SegmentType[]).map((type) => (
            <option key={type} value={type}>
              {SEGMENT_LABEL[type]}
            </option>
          ))}
        </select>
      ) : (
        <span className="fit-seg-label">
          {label}
          {draft.type === 'warmup' || draft.type === 'cooldown' || draft.type === 'recover' ? <small>optional</small> : null}
        </span>
      )}
      <label className="fit-seg-field time">
        <span>Time</span>
        <TimeInputs value={{ min: draft.min, sec: draft.sec }} onChange={(next) => onChange(next)} labelPrefix={label} />
      </label>
      <label className="fit-seg-field">
        <span>km/h</span>
        <input inputMode="decimal" value={draft.speed} aria-label={`${label} speed km/h`} onChange={(event) => onChange({ speed: event.target.value })} />
      </label>
      <label className="fit-seg-field">
        <span>Incl %</span>
        <input inputMode="decimal" value={draft.incline} aria-label={`${label} incline %`} onChange={(event) => onChange({ incline: event.target.value })} />
      </label>
      {onRemove ? (
        <button type="button" className="icon-button" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      ) : null}
    </div>
  )
}

/** "6 × 0:30 @ 14 km/h" — short enough for a list line. */
export function describeIntervals(segments: IntervalSegment[]) {
  const summary = intervalSummary(segments)
  return `${summary.rounds} × ${summary.workPartSec ? formatSeconds(summary.workPartSec) : '—'}${summary.topWorkSpeed ? ` @ ${formatNumber(summary.topWorkSpeed)} km/h` : ''}`
}
