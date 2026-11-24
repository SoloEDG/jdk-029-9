import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { jointFor, otherRole, tailAcross } from '../src/features/duet/lib/joint'
import type { DuetExercise } from '../src/features/duet/model/types'

const book = JSON.parse(readFileSync(new URL('../src/features/duet/model/duet-books.json', import.meta.url), 'utf8'))
const exercises = book.exercises as DuetExercise[]

test('both exercises have two overlapping parts with crossed entrances', () => {
  for (const exercise of exercises) {
    const overlap = Math.min(
      Math.max(...exercise.parts.a.map(note => note.end)),
      Math.max(...exercise.parts.b.map(note => note.end)),
    ) - Math.max(
      Math.min(...exercise.parts.a.map(note => note.start)),
      Math.min(...exercise.parts.b.map(note => note.start)),
    )
    assert.ok(overlap > 4, `${exercise.id} parts overlap only ${overlap}s`)
    const crossings = exercise.lines.filter(line => tailAcross(exercise, line) !== null)
    assert.ok(crossings.length >= 2, `${exercise.id} has ${crossings.length} crossed entrances`)
  }
})

test('joint window includes the pre-roll and the tail', () => {
  for (const exercise of exercises) {
    for (const line of exercise.lines) {
      const joint = jointFor(exercise, line)
      assert.ok(joint.window.start <= line.start - 0.8)
      assert.ok(joint.window.end >= line.end)
      assert.equal(joint.tailCrossesEntrance, joint.overlapSeconds > 0)
    }
  }
})

test('other role alternates', () => {
  assert.equal(otherRole('a'), 'b')
  assert.equal(otherRole('b'), 'a')
})
