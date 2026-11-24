// Synthetic scenarios for the duet evidence analysis.
//
// The point of these tests is not to check pretty UI, but to pin down the
// decisions the exercise depends on:
//   * separate my voice from the other role's bleed at several bleed strengths,
//   * never award a unison stretch on the role window alone,
//   * keep an early (抢拍) entrance and label it separately,
//   * mark a quiet octave double as a weaker reading rather than a confident one,
//   * keep the same evidence when the guide volume is changed after the take,
//   * handle a re-entry inside one loop as its own coverage piece.

import assert from 'node:assert/strict'
import test from 'node:test'
import { analyseJoint } from '../src/features/duet/lib/evidence'
import type { DuetExercise, DuetLine, DuetNote, RoleId } from '../src/features/duet/model/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 16000

const book = JSON.parse(readFileSync(new URL('../src/features/duet/model/duet-books.json', import.meta.url), 'utf8'))
const echo = book.exercises.find((entry: DuetExercise) => entry.id === 'echo') as DuetExercise

const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** A simple voiced tone with vibrato and two harmonics. */
function tone(samples: Float32Array, rate: number, note: DuetNote, gain: number, offsetSeconds = 0) {
  const first = Math.max(0, Math.floor((note.start - offsetSeconds) * rate))
  const last = Math.min(samples.length, Math.ceil((note.end - offsetSeconds) * rate))
  for (let index = first; index < last; index++) {
    const t = index / rate + offsetSeconds
    const local = t - note.start
    const length = note.end - note.start
    const attack = Math.min(1, local / 0.04)
    const release = Math.min(1, (length - local) / 0.06)
    const gate = Math.max(0, attack * release) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, local / 0.1)))
    const phase = 2 * Math.PI * midiHz(note.midi) * t
    samples[index] += gain * gate * (Math.sin(phase) + 0.25 * Math.sin(2 * phase + 0.3))
  }
}

function noise(samples: Float32Array, rate: number, gain: number, seed = 7) {
  let state = seed
  for (let index = 0; index < samples.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0
    samples[index] += gain * ((state / 0xffffffff) * 2 - 1)
  }
}

interface Scenario {
  line: DuetLine
  role: RoleId
  clipStart: number
  seconds: number
  bleedGain: number
  bleedDelay?: number
  /** Extra notes to add to "my" performance, independent of the score. */
  own?: DuetNote[]
  ownGain?: number
  guideVolume?: number
  noiseGain?: number
}

/**
 * Build a microphone clip = known guide bleed + my own singing.
 * My part is the exercise's score for the role; `own` adds/replaces phrases.
 */
function microphone(input: Scenario) {
  const { line, role, clipStart, seconds, bleedGain } = input
  const exercise = echo
  const otherRole: RoleId = role === 'a' ? 'b' : 'a'
  const delay = input.bleedDelay ?? 0.012
  const guide = new Float32Array(Math.ceil(seconds * RATE))
  const shiftedGuide = new Float32Array(Math.ceil(seconds * RATE))
  for (const note of exercise.parts[otherRole]) {
    tone(shiftedGuide, RATE, note, 0.2, clipStart - delay)
  }
  const clip = new Float32Array(Math.ceil(seconds * RATE))
  for (let index = 0; index < clip.length; index++) clip[index] = shiftedGuide[index] * bleedGain
  const own = input.own ?? exercise.parts[role]
  for (const note of own) tone(clip, RATE, note, input.ownGain ?? 0.2, clipStart)
  noise(clip, RATE, input.noiseGain ?? 0.003)
  return {
    clip,
    guide,
    clipStart,
    exercise,
    line,
    role,
    guideVolume: input.guideVolume ?? 0.7,
    sampleRate: RATE,
    guideRate: RATE,
  }
}

const line2 = echo.lines[1] // 高声部 entrance at 5.8, low voice tail runs to 6.2
const clipStart = Math.max(0, line2.start - 0.85 - 0.6)

function kinds(segments: { start: number; end: number; kind: string }[]) {
  return segments.map(segment => `${segment.kind}@${segment.start.toFixed(2)}-${segment.end.toFixed(2)}`)
}

test('my part is found while the other part bleeds at moderate strength', () => {
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.4, bleedGain: 0.35,
  }))
  const mine = result.evidence.segments.filter(segment => segment.kind === 'mine')
  assert.ok(mine.length >= 2, `expected my sung notes, got ${kinds(result.evidence.segments)}`)
  const first = mine[0]
  assert.ok(first.start <= line2.start + 0.12 && first.start >= line2.start - 0.1, `entrance at ${first.start}`)
  assert.ok(result.evidence.early.length === 0)
  assert.ok(result.evidence.summary.mine > 1.5)
})

test('strong bleed is not mistaken for my voice in stretches I do not sing', () => {
  const exercise = echo
  // Sing only the first two notes of the line; leave the rest silent.
  const own = exercise.parts.b.slice(0, 2)
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.2,
    bleedGain: 0.95, own,
  }))
  const late = result.evidence.segments.filter(segment =>
    segment.kind === 'mine' && segment.start > 8.1)
  assert.equal(late.length, 0, `silent stretch awarded to me: ${kinds(late)}`)
  assert.ok(result.evidence.summary.bleed > 0.3, 'bleed should be visible')
  assert.match(result.evidence.note, /串音/)
})

test('quiet octave double is reported as mine but with weak evidence', () => {
  const own = echo.parts.b.map(note => ({ ...note, midi: note.midi + 12 }))
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.2,
    bleedGain: 0.3, own, ownGain: 0.09,
  }))
  const octaves = result.evidence.segments.filter(segment => segment.octave !== 0)
  assert.ok(octaves.length > 0, `expected octave segments, got ${JSON.stringify(result.evidence.segments.map(s => s.octave))}`)
  for (const segment of octaves) assert.ok(segment.confidence < 0.7, 'octave reading must not look confident')
})

test('unison overlap where bleed explains the level stays unclear', () => {
  // The b line ends on A4 (69) while a's third phrase starts on A4 too.
  const line4 = echo.lines[3] // b line 11.4-15.4, a sings 11.6-12.8 on 69
  const start = Math.max(0, line4.start - 0.85 - 0.6)
  const own: DuetNote[] = [{ start: 11.45, end: 12.55, midi: 69 }]
  const result = analyseJoint(microphone({
    line: line4, role: 'b', clipStart: start, seconds: line4.end - start + 0.2,
    bleedGain: 0.85, own, ownGain: 0.06,
  }))
  const overlapping = result.evidence.segments.filter(segment =>
    segment.start < 12.5 && segment.end > 11.6)
  assert.ok(overlapping.length > 0)
  const awarded = overlapping.filter(segment => segment.kind === 'mine')
  assert.ok(awarded.length === 0 || awarded.every(segment => segment.confidence < 0.7),
    `unison should not be confidently mine: ${JSON.stringify(overlapping)}`)
})

test('early entrance keeps its audio and is reported separately', () => {
  const own: DuetNote[] = [{ start: 5.25, end: 6.05, midi: 72 }, ...echo.parts.b.slice(1)]
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart: Math.max(0, 5.8 - 0.85 - 0.6),
    seconds: line2.end - 5.8 + 1.5, bleedGain: 0.25, own,
  }))
  assert.ok(result.evidence.early.length > 0, 'early entrance must be recorded')
  assert.ok(result.evidence.early[0].start < line2.start)
  const clipStartExpected = Math.max(0, line2.start - 0.85 - 0.6)
  assert.ok(result.evidence.clip.start <= result.evidence.early[0].start, 'clip must include the early entry')
  assert.equal(result.evidence.coverage[0].label, 'early')
  assert.ok(clipStartExpected <= result.evidence.clip.start)
  assert.match(result.evidence.note, /抢拍/)
})

test('re-entering inside one loop produces a separate coverage piece', () => {
  // b's own score has a gap between 7.5 and 7.7.  Sing through it once, then
  // re-enter inside the same loop at 8.7, before the next scheduled note.
  const own: DuetNote[] = [
    ...echo.parts.b.slice(0, 2),
    { start: 8.35, end: 9.15, midi: 71 },
  ]
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.3,
    bleedGain: 0.2, own,
  }))
  const pieces = result.evidence.coverage
  assert.ok(pieces.length >= 2, `expected a re-entry gap, got ${JSON.stringify(pieces)}`)
  assert.ok(pieces.some(piece => piece.start >= 8.0), 're-entry should be its own piece')
})

test('evidence is frozen: a later guide-volume change does not alter it', () => {
  const first = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.3,
    bleedGain: 0.4, guideVolume: 0.7,
  }))
  const second = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.3,
    bleedGain: 0.4, guideVolume: 0.1,
  }))
  assert.equal(first.evidence.recordedGuideVolume, 0.7)
  assert.equal(second.evidence.recordedGuideVolume, 0.1)
  assert.deepEqual(
    first.evidence.segments.map(segment => [segment.kind, segment.start.toFixed(2), segment.end.toFixed(2)]),
    second.evidence.segments.map(segment => [segment.kind, segment.start.toFixed(2), segment.end.toFixed(2)]),
  )
  // The snapshot must remember what level it was captured at; the UI replays at
  // the *current* volume and merely labels the old evidence's level.
  assert.notEqual(first.evidence.recordedGuideVolume, second.evidence.recordedGuideVolume)
})

test('benign prompt with only a bleed track is not awarded to me', () => {
  const result = analyseJoint(microphone({
    line: line2, role: 'b', clipStart, seconds: line2.end - clipStart + 0.2,
    bleedGain: 0.45, own: [],
  }))
  assert.equal(result.evidence.summary.mine, 0, kinds(result.evidence.segments))
})

void join
