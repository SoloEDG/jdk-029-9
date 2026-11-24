// Role/joint geometry for the duet window: which lines overlap at a joint, where
// the selected singer's entrance sits, and which windows may be recorded.

import type { DuetExercise, DuetLine, DuetNote, PracticeJoint, RoleId } from '../model/types'
import { WINDOW_LAG, WINDOW_LEAD } from '../model/constants'

export const otherRole = (role: RoleId): RoleId => role === 'a' ? 'b' : 'a'

export function notesOf(exercise: DuetExercise, role: RoleId): DuetNote[] {
  return exercise.parts[role] ?? []
}

export function lineNotes(exercise: DuetExercise, line: DuetLine): DuetNote[] {
  return notesOf(exercise, line.role).filter(note => note.end > line.start && note.start < line.end)
}

/** The last note of `next`'s role that still sounds at `next.start`, if any. */
export function tailAcross(exercise: DuetExercise, next: DuetLine, lookBack = 1.5): DuetNote | null {
  const previous = exercise.lines
    .filter(line => line.role !== next.role && line.start < next.start)
    .sort((left, right) => right.start - left.start)[0]
  if (!previous) return null
  const tail = notesOf(exercise, previous.role)
    .filter(note => note.end > next.start - lookBack && note.start < next.start)
    .sort((left, right) => right.end - left.end)[0]
  return tail ?? null
}

export function jointFor(exercise: DuetExercise, line: DuetLine): PracticeJoint {
  const tail = tailAcross(exercise, line)
  const otherLine = tail
    ? exercise.lines.find(entry => entry.role !== line.role && notesOf(exercise, entry.role).includes(tail)) ?? null
    : null
  const scheduled = { start: line.start, end: line.end }
  const window = {
    start: Math.max(0, line.start - WINDOW_LEAD),
    end: Math.min(exercise.duration, line.end + WINDOW_LAG),
  }
  const overlap = tail ? Math.max(0, tail.end - line.start) : 0
  return {
    myLine: line,
    otherLine,
    window,
    scheduled,
    overlapSeconds: overlap,
    tailCrossesEntrance: overlap > 0,
  }
}
