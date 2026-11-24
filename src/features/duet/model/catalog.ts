import type { DuetExercise, DuetLine, RoleId } from './types'
import books from './duet-books.json'

interface DuetBook {
  sampleRate: number
  exercises: DuetExercise[]
}

export const duetBook = books as DuetBook
export const duetExercises: DuetExercise[] = duetBook.exercises

export function exerciseById(id: string): DuetExercise {
  return duetExercises.find(entry => entry.id === id) ?? duetExercises[0]
}

export function linesFor(exercise: DuetExercise, role: RoleId): DuetLine[] {
  return exercise.lines.filter(line => line.role === role)
}
