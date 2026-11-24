// Session-level checks for the parts that do not need a browser: the guide
// volume shown to the user, the frozen volume inside a take, and the demo
// label that tells a validation sample from a real recording.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildDemoTakes } from '../src/features/duet/lib/demo'
import { KIND_HINT, KIND_LABEL, COVERAGE_LABEL } from '../src/features/duet/lib/labels'
import type { DuetExercise, EvidenceKind } from '../src/features/duet/model/types'

const book = JSON.parse(readFileSync(new URL('../src/features/duet/model/duet-books.json', import.meta.url), 'utf8'))
const echo = book.exercises[0] as DuetExercise

test('changing the live guide volume never edits a stored take', () => {
  const quietGuide = buildDemoTakes(echo, 0.2, 1_000)
  const loudGuide = buildDemoTakes(echo, 0.95, 1_000)
  assert.deepEqual(
    quietGuide.map(take => take.evidence.segments.map(segment => segment.kind)),
    loudGuide.map(take => take.evidence.segments.map(segment => segment.kind)),
  )
  assert.ok(quietGuide.every(take => take.evidence.recordedGuideVolume === 0.2))
  assert.ok(loudGuide.every(take => take.evidence.recordedGuideVolume === 0.95))
})

test('take snapshots survive a JSON round-trip of plain fields', () => {
  const take = buildDemoTakes(echo, 0.6, 2_000)[0]
  const plain = JSON.parse(JSON.stringify({
    ...take,
    audio: undefined,
  }))
  assert.equal(plain.evidence.recordedGuideVolume, 0.6)
  assert.ok(Array.isArray(plain.evidence.waveform) && plain.evidence.waveform.length > 10)
  assert.ok(Array.isArray(plain.evidence.segments))
  assert.equal(typeof plain.evidence.guideTrack, 'string')
})

test('every evidence kind and coverage label has user-facing copy', () => {
  for (const kind of ['mine', 'bleed', 'unclear', 'quiet'] as EvidenceKind[]) {
    assert.ok(KIND_LABEL[kind].length > 1)
    assert.ok(KIND_HINT[kind].length > 4)
  }
  for (const label of ['early', 'scheduled', 'reentry', 'late'] as const) {
    assert.ok(COVERAGE_LABEL[label].length > 1)
  }
  assert.equal(KIND_LABEL.unclear, '无法判断')
})
