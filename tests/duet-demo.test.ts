// The built-in validation samples must exercise the decisions the user asked
// for.  These tests build the samples exactly as the UI does and inspect the
// resulting frozen evidence.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildDemoTakes } from '../src/features/duet/lib/demo'
import type { DuetExercise } from '../src/features/duet/model/types'

const book = JSON.parse(readFileSync(new URL('../src/features/duet/model/duet-books.json', import.meta.url), 'utf8'))
const echo = book.exercises.find((entry: DuetExercise) => entry.id === 'echo') as DuetExercise
const takes = buildDemoTakes(echo, 0.65, 1_700_000_000_000)
const byId = new Map(takes.map(take => [take.id, take]))

test('validation set covers weak/strong bleed, octave, early, re-entry and unison', () => {
  for (const suffix of ['weak', 'strong', 'octave', 'early', 'reentry', 'unison']) {
    assert.ok(byId.has(`echo-demo-${suffix}`), `missing ${suffix}`)
  }
})

test('weak and strong bleed both find the singer without calling bleed their voice', () => {
  for (const suffix of ['weak', 'strong']) {
    const take = byId.get(`echo-demo-${suffix}`)!
    assert.ok(take.evidence.summary.mine > 1.2, `${suffix}: ${JSON.stringify(take.evidence.summary)}`)
    // The other role's tail crosses the entrance; that stretch must not be
    // confidently awarded to the singer.
    const line = echo.lines.find(entry => entry.id === take.lineId)!
    const cross = take.evidence.segments.filter(segment =>
      segment.start < Math.min(line.start + 0.4, take.evidence.clip.start + 2))
    assert.ok(cross.every(segment => segment.kind !== 'mine' || segment.confidence >= 0.5))
  }
})

test('strong bleed records its strength and reads more cautiously', () => {
  const weak = byId.get('echo-demo-weak')!
  const strong = byId.get('echo-demo-strong')!
  assert.ok(strong.evidence.bleedGain > weak.evidence.bleedGain * 1.5,
    `${weak.evidence.bleedGain} vs ${strong.evidence.bleedGain}`)
  assert.ok(strong.evidence.summary.bleed >= weak.evidence.summary.bleed)
})

test('octave sample is kept but never presented as confident', () => {
  const take = byId.get('echo-demo-octave')!
  const octaveSegments = take.evidence.segments.filter(segment => segment.octave !== 0)
  assert.ok(octaveSegments.length > 0, JSON.stringify(take.evidence.segments))
  for (const segment of octaveSegments) assert.ok(segment.confidence < 0.72)
  assert.ok(take.evidence.coverage.every(piece => piece.label !== 'early'))
})

test('early sample keeps the pre-entrance sound and lists it as 抢拍', () => {
  const take = byId.get('echo-demo-early')!
  assert.ok(take.evidence.early.length > 0, JSON.stringify(take.evidence.coverage))
  assert.equal(take.evidence.coverage[0].label, 'early')
  assert.ok(take.evidence.clip.start < take.evidence.scheduled.start)
  assert.match(take.evidence.note, /抢拍/)
  // The raw clip must contain audio before the entrance.
  const peaks = take.evidence.waveform
  assert.ok(peaks.some((peak, index) => index < peaks.length / 3 && peak > 0.01))
})

test('re-entry sample produces a separate coverage piece', () => {
  const take = byId.get('echo-demo-reentry')!
  const labels = take.evidence.coverage.map(piece => piece.label)
  assert.ok(labels.includes('reentry'), JSON.stringify(take.evidence.coverage))
  const pieces = take.evidence.coverage
  assert.ok(pieces.length >= 2)
})

test('unison sample is not confidently awarded to either side', () => {
  const take = byId.get('echo-demo-unison')!
  const mineConfident = take.evidence.segments.filter(segment => segment.kind === 'mine' && segment.confidence >= 0.7)
  assert.equal(mineConfident.length, 0, JSON.stringify(take.evidence.segments))
  assert.ok(take.evidence.summary.unclear > 0 || take.evidence.summary.bleed > 0)
})

test('every sample freezes the volume it was assessed at', () => {
  for (const take of takes) {
    assert.equal(take.evidence.recordedGuideVolume, 0.65)
    assert.equal(take.guideVolume, 0.65)
    assert.ok(take.evidence.assessedAt >= 1_700_000_000_000)
  }
})
