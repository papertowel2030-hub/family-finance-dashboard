import type { TrainingKind } from '../types'

/** Microcopy for the Fitness screens. Light on jokes, never in the way of the facts. */

export const EMPTY_DAY = [
  'Nothing yet. The couch is currently winning.',
  'Blank day. Mystery workout, or mystery nap?',
  'Nothing logged. Tap above and make it official.',
]

export const FUTURE_DAY = ['Nothing to log yet. Time travel is not a feature.', 'That day has not happened. No spoilers.']

export const EMPTY_MEALS = ['Nothing yet. Your fiber is feeling neglected.', 'Empty plate, empty log. Tap a chip when you eat.']

export const LOGGED_TOAST: Record<TrainingKind, string> = {
  strength: 'Strength logged. Gravity lost again.',
  cardio: 'Endurance logged. Lungs 1, couch 0.',
  sport: 'Sport logged. Fun counts.',
}

export const REST_LOGGED_TOAST = 'Rest logged. Doing nothing, professionally.'
export const REST_REMOVED_TOAST = 'Rest day removed. Back to work.'

export const REST_ENTRY_NOTE = 'Muscles rebuild while you sit. Science says so.'

export const PROGRESS_HINT = 'Lift it again to see a line.'

export const EMPTY_MONTH = ['A blank month. Bold choice.', 'Nothing logged this month. Yet.']
