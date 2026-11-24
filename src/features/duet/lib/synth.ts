// Synthesised "proof" takes for the built-in validation scenario.
//
// These are generated on demand, never shipped as audio files.  Each one is a
// microphone signal the analysis is expected to unpick, so the review panel can
// demonstrate — on a machine with no microphone — what "mine / bleed /
// unclear" look like at the same joint.

import type { PcmFrame } from '../../../shared/document'
import { toWave } from '../../capture/lib/wave'
import type { DuetExercise, DuetNote, DuetTake, RoleId } from '../model/types'
import { analyseJoint } from './evidence'
import { downsample } from './dsp'

const RATE = 24000
const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

function renderNotes(
  target: Float32Array, notes: readonly DuetNote[], gain: number, offset: number, octave = 0,
) {
  for (const note of notes) {
    const first = Math.max(0, Math.floor((note.start - offset) * RATE))
    const last = Math.min(target.length, Math.ceil((note.end - offset) * RATE))
    for (let index = first; index < last; index++) {
      const t = index / RATE + offset
      const local = t - note.start
      const length = note.end - note.start
      if (local < 0 || local > length) continue
      const gate = Math.max(0, Math.min(1, local / 0.04) * Math.min(1, (length - local) / 0.07))
        * (0.78 + 0.22 * Math.sin(Math.PI * Math.min(1, local / 0.1)))
      const phase = 2 * Math.PI * midiHz(note.midi + octave) * t
      target[index] += gain * gate * (Math.sin(phase) + 0.25 * Math.sin(2 * phase + 0.3))
    }
  }
}

function addRoomNoise(target: Float32Array, gain: number, seed: number) {
  let state = seed >>> 0
  for (let index = 0; index < target.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0
    target[index] += gain * ((state / 0xffffffff) * 2 - 1)
  }
}

export interface SynthOptions {
  exercise: DuetExercise
  role: RoleId
  lineId: string
  /** Coupling from the speaker into the microphone, 0..1.2. */
  bleed: number
  ownOverride?: readonly DuetNote[]
  extra?: readonly DuetNote[]
  ownGain?: number
  octave?: number
  delay?: number
  guideVolume: number
  createdAt?: number
  id: string
  label: string
}

export interface SynthTake extends DuetTake { label: string }

/**
 * Build a take exactly as the recorder would: render the microphone signal,
 * encode WAV, then run the *same* analysis the capture path uses.
 */
export function synthesiseTake(options: SynthOptions): SynthTake {
  const { exercise, role, bleed, guideVolume } = options
  const line = exercise.lines.find(entry => entry.id === options.lineId)!
  const otherRole: RoleId = role === 'a' ? 'b' : 'a'
  const delay = options.delay ?? 0.014
  const clipStart = Math.max(0, line.start - 1.45)
  const seconds = line.end - clipStart + 0.5
  const length = Math.ceil(seconds * RATE)

  // The player would hand over the guide track at its own sample rate.  Build
  // it truthfully from the score so the analyser's coupling estimate is real.
  const guide = new Float32Array(Math.ceil((exercise.duration + 1) * RATE))
  renderNotes(guide, exercise.parts[otherRole], 0.2, 0)

  // The microphone hears the speaker `delay` seconds after the guide emits it.
  const clip = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const at = Math.round((clipStart + index / RATE - delay) * RATE)
    clip[index] = at >= 0 && at < guide.length ? guide[at] * bleed : 0
  }
  const own = options.ownOverride
    ?? exercise.parts[role].filter(note => note.end > clipStart && note.start < line.end + 0.5)
  renderNotes(clip, own, options.ownGain ?? 0.2, clipStart, options.octave ?? 0)
  if (options.extra) renderNotes(clip, options.extra, options.ownGain ?? 0.2, clipStart, options.octave ?? 0)
  addRoomNoise(clip, 0.0035, 11 + Math.round(bleed * 100))

  const frames: PcmFrame[] = []
  for (let offset = 0; offset < clip.length; offset += 2048) {
    frames.push({ inputTime: offset / RATE, samples: clip.slice(offset, Math.min(clip.length, offset + 2048)) })
  }
  const audio = toWave(frames, 0, clip.length / RATE, RATE)
  const guideClip = downsample(
    guide.subarray(Math.round(clipStart * RATE), Math.round(clipStart * RATE) + length),
    RATE, RATE,
  )
  const analysis = analyseJoint({
    clip, sampleRate: RATE, guide: guideClip, guideRate: RATE,
    exercise, line, role, clipStart, guideVolume,
  })
  const pitch = analysis.pitch.length
    ? analysis.pitch
    : Array.from({ length: Math.floor(seconds / 0.05) }, (_, index) => ({ time: clipStart + index * 0.05, midi: null }))
  return {
    id: options.id,
    exerciseId: exercise.id,
    role,
    lineId: line.id,
    createdAt: options.createdAt ?? Date.now(),
    audio,
    pitch,
    start: clipStart,
    end: clipStart + seconds,
    evidence: analysis.evidence,
    guideVolume,
    guidePitch: analysis.guideTrace,
    demo: true,
    label: options.label,
  }
}
