import type { PitchPoint, TimeRange } from '../../../shared/document'
import type {
  CoveragePiece, DuetExercise, DuetLine, EvidenceKind,
  EvidenceSegment, EvidenceSnapshot, RoleId,
} from '../model/types'
import {
  FRAME_SECONDS, HOP_SECONDS, MIN_CONFIDENT, MIN_VOICED_SECONDS, NOISE_MARGIN_DB, PREROLL,
  WINDOW_LAG, WINDOW_LEAD,
} from '../model/constants'
import { autocorrelationPitch, clamp, dbfs, directPitch, downsample, noteAffinity, percentile, rms, waveformPeaks } from './dsp'

const RATE = 16000

export interface AnalysisInput {
  clip: Float32Array
  sampleRate: number
  guide: Float32Array
  guideRate: number
  exercise: DuetExercise
  line: DuetLine
  role: RoleId
  /** Song time of the clip's first sample. */
  clipStart: number
  guideVolume: number
  /** Optional pre-computed display pitch (the capture path supplies it). */
  pitch?: readonly PitchPoint[]
}

export interface AnalysisResult {
  evidence: EvidenceSnapshot
  /** Display-only F0 track, kept as-is for the pitch panel. */
  pitch: PitchPoint[]
  /** The known guide's own pitch, for the review overlay. */
  guideTrace: PitchPoint[]
}

interface Coupling { delaySeconds: number; gain: number; confidence: number }

/**
 * Slide the known guide against the microphone to recover delay + coupling.
 *
 * Frame *energy* correlation is not usable here: once the singer is also
 * singing, the microphone is loud wherever anyone sings, so almost any shift
 * looks plausible.  A normalised waveform cross-correlation is not fooled the
 * same way — only the true shift aligns the bleed's actual waveform.
 */
export function estimateCoupling(
  clip: Float32Array, rate: number, guide: Float32Array, guideRate: number,
  clipStart: number, search: TimeRange,
): Coupling {
  const local = downsample(clip, rate, RATE)
  const reference = downsample(guide, guideRate, RATE)
  const toOffset = (time: number) => Math.round((time - clipStart) * RATE)
  const first = Math.max(0, toOffset(search.start))
  const last = Math.min(local.length, toOffset(search.end))
  if (last - first < RATE * 0.1) return { delaySeconds: 0, gain: 0, confidence: 0 }

  const step = 2
  let bestDelay = 0
  let bestScore = 0
  for (let delay = -0.03; delay <= 0.5 + 1e-9; delay += 0.002) {
    const shift = Math.round(delay * RATE)
    let dot = 0
    let localEnergy = 0
    let referenceEnergy = 0
    for (let offset = first; offset + shift < last; offset += step) {
      const guideIndex = offset - shift
      if (guideIndex < 0 || guideIndex >= reference.length) continue
      dot += local[offset] * reference[guideIndex]
      localEnergy += local[offset] * local[offset]
      referenceEnergy += reference[guideIndex] * reference[guideIndex]
    }
    const score = localEnergy > 0 && referenceEnergy > 0
      ? dot / Math.sqrt(localEnergy * referenceEnergy) : 0
    if (score > bestScore) { bestScore = score; bestDelay = delay }
  }
  // Least-squares coupling at the chosen delay: microphone ≈ gain * guide.
  const shift = Math.round(bestDelay * RATE)
  let dot = 0
  let energy = 0
  let localEnergy = 0
  for (let offset = first; offset + shift < last; offset += step) {
    const guideIndex = offset - shift
    if (guideIndex < 0 || guideIndex >= reference.length) continue
    dot += local[offset] * reference[guideIndex]
    energy += reference[guideIndex] * reference[guideIndex]
    localEnergy += local[offset] * local[offset]
  }
  const gain = energy > 0 ? clamp(dot / energy, 0, 6) : 0
  // How much of the microphone's loudness the guide explains (0..1).  A guide
  // that is silent through the clip cannot support a judgement and reports low.
  const explained = localEnergy > 0 ? clamp(gain * gain * energy / localEnergy, 0, 1) : 0
  return { delaySeconds: bestDelay, gain, confidence: explained }
}

function clamp01(value: number) { return clamp(value, 0, 1) }

type FrameKind = EvidenceKind | 'pause'

interface Frame {
  start: number
  end: number
  kind: FrameKind
  confidence: number
  octave: -12 | 0 | 12
  residualDb: number
  bleedDb: number
  midi: number | null
  otherMidi: number | null
  mineMidi: number | null
}

/** Majority filter over three frames, so one noisy frame cannot invent an entrance. */
function smoothKinds(frames: Frame[]) {
  if (frames.length < 3) return
  const original = frames.map(frame => ({ kind: frame.kind, confidence: frame.confidence, octave: frame.octave }))
  for (let index = 1; index < frames.length - 1; index++) {
    const left = original[index - 1]
    const middle = original[index]
    const right = original[index + 1]
    // Only override a lone disagreement between two identical neighbours.
    if (left.kind === right.kind && middle.kind !== left.kind) {
      frames[index].kind = left.kind
      frames[index].confidence = (left.confidence + right.confidence) / 2
      frames[index].octave = left.octave === right.octave ? left.octave : 0
    }
  }
}

function mergeFrames(frames: readonly Frame[], scheduled: TimeRange): EvidenceSegment[] {
  const merged: EvidenceSegment[] = []
  for (const frame of frames) {
    const last = merged.at(-1)
    if (
      last && frame.kind !== 'pause' && last.kind === frame.kind && last.octave === frame.octave
      && frame.start - last.end <= HOP_SECONDS * 1.6
    ) {
      last.end = frame.end
      last.confidence = Math.max(last.confidence, frame.confidence)
      continue
    }
    if (frame.kind === 'pause') continue
    merged.push({
      start: frame.start, end: frame.end, kind: frame.kind, confidence: frame.confidence,
      reason: '', octave: frame.octave, outside: false, early: false, shiftSeconds: 0,
    })
  }
  for (const segment of merged) {
    segment.outside = segment.end <= scheduled.start + 0.001 || segment.start >= scheduled.end - 0.001
    segment.early = segment.start < scheduled.start - 0.04
    // Signed distance from the entrance: negative means the singer came in early.
    segment.shiftSeconds = segment.start - scheduled.start
  }
  return merged
}

/**
 * Group confident "mine" segments into contiguous stretches of singing, then
 * label each stretch:
 *   scheduled — inside the entrance as written
 *   early     — starts before the entrance (抢拍); split at the entrance so the
 *               early sound keeps its own row and its own extent
 *   reentry   — resumes after a real break inside the same loop
 *   late      — continues clearly past the scheduled end
 * Short dips (breaths, one dropped frame) do not split a stretch.
 */
function splitCoverage(segments: readonly EvidenceSegment[], scheduled: TimeRange): CoveragePiece[] {
  // Build stretches from *all* "mine" readings first: a weakly-supported frame
  // between two confident ones (an octave flavour, a soft vowel) must not cut
  // the phrase in half.  A stretch is kept only if some part of it is confident.
  const stretches: (CoveragePiece & { confident: boolean })[] = []
  for (const segment of segments) {
    if (segment.kind !== 'mine') continue
    const last = stretches.at(-1)
    if (last && segment.start - last.end <= 0.32) {
      last.end = Math.max(last.end, segment.end)
      last.confident ||= segment.confidence >= MIN_CONFIDENT
      continue
    }
    stretches.push({
      start: segment.start, end: segment.end, label: 'scheduled',
      confident: segment.confidence >= MIN_CONFIDENT,
    })
  }
  const kept = stretches
    .filter(piece => piece.confident && piece.end - piece.start >= MIN_VOICED_SECONDS)
    .map(({ start, end, label }) => ({ start, end, label }))
  // An early entry is real singing: keep its full sound, but show the pre-
  // entrance part as its own piece so "actual coverage" is explicit.
  const split: CoveragePiece[] = []
  for (const piece of kept) {
    if (piece.start < scheduled.start - 0.04 && piece.end > scheduled.start + 0.02) {
      split.push({ start: piece.start, end: scheduled.start, label: 'early' })
      split.push({ start: scheduled.start, end: piece.end, label: 'scheduled' })
      continue
    }
    split.push({ ...piece, label: piece.start < scheduled.start - 0.04 ? 'early' : 'scheduled' })
  }
  return split.map((piece, index) => {
    if (piece.label !== 'scheduled') return piece
    const previous = split[index - 1]
    if (previous && piece.start - previous.end >= 0.4 && piece.start > scheduled.start + 0.12) {
      return { ...piece, label: 'reentry' }
    }
    if (piece.end > scheduled.end + 0.3) return { ...piece, label: 'late' }
    return piece
  })
}

function reasonFor(frame: Frame, role: RoleId): string {
  const octave = frame.octave === 0 ? '' : frame.octave > 0 ? '（高八度轻唱）' : '（低八度轻唱）'
  const voice = role === 'a' ? '低声部' : '高声部'
  // Clamp the reported margin: with no bleed at all the model level is minus
  // infinity, and "161 dB" would read as precision we do not have.
  const margin = Math.round(Math.min(40, frame.residualDb - frame.bleedDb))
  switch (frame.kind) {
    case 'mine':
      return `残差比串音模型高 ${margin} dB，轨迹贴合${voice}${octave}`
    case 'bleed':
      return '电平随对方导唱同步落下，判为串音'
    case 'unclear':
      return frame.mineMidi !== null && frame.otherMidi !== null && Math.abs(frame.mineMidi - frame.otherMidi) < 0.5
        ? '双方同音且电平被串音解释，单靠角色时段无法判断'
        : '有声音，但轨迹无法稳定归属'
    case 'quiet':
      return '在入口内，但麦克风未高于底噪'
    default:
      return ''
  }
}

/**
 * Deterministic, side-effect free.  Same clip in, same evidence out — the UI
 * can re-open a take at any time and get the judgements that were recorded.
 */
export function analyseJoint(input: AnalysisInput): AnalysisResult {
  const { exercise, line, role, clipStart, guideVolume } = input
  const local = downsample(input.clip, input.sampleRate, RATE)
  const guide = downsample(input.guide, input.guideRate, RATE)
  const scheduled: TimeRange = { start: line.start, end: line.end }
  const window: TimeRange = {
    start: Math.max(0, line.start - WINDOW_LEAD),
    end: Math.min(exercise.duration, line.end + WINDOW_LAG),
  }

  const coupling = estimateCoupling(local, RATE, guide, RATE, clipStart, {
    start: clipStart + PREROLL + 0.05, end: window.end,
  })

  const mine = (exercise.parts[role] ?? []).filter(note => note.end > window.start && note.start < window.end)
  const otherRole: RoleId = role === 'a' ? 'b' : 'a'
  const other = (exercise.parts[otherRole] ?? []).filter(note => note.end > window.start && note.start < window.end)

  const span = Math.round(FRAME_SECONDS * RATE)
  const hop = Math.max(1, Math.round(HOP_SECONDS * RATE))
  const offsets: number[] = []
  for (let offset = 0; offset + span <= local.length; offset += hop) offsets.push(offset)

  // First pass: level of the known bleed and the residual that remains after
  // removing it.  The noise floor is taken from the residual, never from the
  // raw microphone — otherwise a loud guide would raise the gate and hide the
  // singer behind it.
  interface Prepared {
    offset: number
    time: number
    end: number
    slice: Float32Array
    residual: number
    residualDb: number
    bleedDb: number
    guideSlice: Float32Array | null
    guideStart: number
  }
  const prepared: Prepared[] = []
  for (let index = 0; index < offsets.length; index++) {
    const offset = offsets[index]
    const time = clipStart + offset / RATE
    if (time < window.start - HOP_SECONDS || time >= window.end) continue
    const end = Math.min(window.end, time + span / RATE)
    const guideStart = Math.round((offset / RATE + coupling.delaySeconds) * RATE)
    const inGuide = guideStart >= 0 && guideStart + span <= guide.length
    const reference = inGuide ? rms(guide, guideStart, span) : 0
    const bleed = reference * coupling.gain
    const level = rms(local, offset, span)
    const residual = Math.sqrt(Math.max(0, level * level - bleed * bleed))
    prepared.push({
      offset, time, end, slice: local.slice(offset, offset + span),
      residual, residualDb: dbfs(residual), bleedDb: dbfs(bleed),
      guideSlice: inGuide ? guide.slice(guideStart, guideStart + span) : null,
      guideStart,
    })
  }

  const positive = prepared.map(frame => frame.residual).filter(value => value > 0)
  const floorDb = positive.length
    ? percentile(positive.map(value => dbfs(value)), 0.15)
    : -60
  // Do not let a single quiet sample push the gate below a sensible floor.
  const gate = Math.max(floorDb + NOISE_MARGIN_DB, -58)

  const frames: Frame[] = []
  const guideTrace: PitchPoint[] = []

  for (const frame of prepared) {
    const { time, end, slice, residualDb, bleedDb } = frame
    const midpoint = time + span / RATE / 2
    const mineHere = mine.find(note => note.start - 0.18 <= midpoint && midpoint < note.end + 0.18) ?? null
    const otherHere = other.find(note => note.start - 0.12 <= midpoint && midpoint < note.end + 0.12) ?? null
    const otherMidi = frame.guideSlice
      ? directPitch(frame.guideSlice, RATE, other.map(note => note.midi))
      : null
    if (otherMidi?.midi != null) guideTrace.push({ time: end, midi: otherMidi.midi })

    let kind: FrameKind = 'pause'
    let confidence = 0
    let octave: -12 | 0 | 12 = 0
    const above = residualDb > gate

    if (above) {
      const mineScore = mineHere ? noteAffinity(slice, RATE, mineHere.midi) : 0
      const otherScore = otherHere ? noteAffinity(slice, RATE, otherHere.midi) : 0
      const highScore = mineHere ? noteAffinity(slice, RATE, mineHere.midi + 12) : 0
      const lowScore = mineHere ? noteAffinity(slice, RATE, mineHere.midi - 12) : 0
      const samePitch = mineHere !== null && otherHere !== null && Math.abs(mineHere.midi - otherHere.midi) < 0.5
      // Unison: both parts hold one pitch.  Whatever the level, the known bleed
      // model and a second voice at the same pitch are indistinguishable — the
      // honest answer is "cannot judge", never a guess based on the role window.
      const unison = samePitch
      // Octave double: my part's fundamental is missing while its octave is
      // strong.  This is what a quiet octave take looks like — real, but weaker.
      const octaveDouble = mineHere !== null && mineScore < 0.45
        && Math.max(highScore, lowScore) >= 0.45
      const octaveOffset: 12 | -12 | 0 = octaveDouble ? (highScore >= lowScore ? 12 : -12) : 0
      const offScore = autocorrelationPitch(slice, RATE)

      if (unison) {
        kind = 'unclear'
        confidence = residualDb > bleedDb + 3 ? 0.42 : 0.3
      } else if (mineHere !== null && mineScore >= 0.45 && mineScore >= otherScore * 0.9) {
        kind = 'mine'
        confidence = clamp01(mineScore / 1.6)
      } else if (octaveDouble) {
        kind = 'mine'
        confidence = 0.55
        octave = octaveOffset
      } else if (otherHere !== null && otherScore >= 0.4 && otherScore >= mineScore * 1.1) {
        // Above the gate and explained by the other part.  At unison (or when my
        // own note is also sounding) the model cannot tell the two apart, so it
        // is bleed only when my part is not due at all.
        kind = mineHere === null ? 'bleed' : 'unclear'
        confidence = mineHere === null ? clamp01(otherScore / 1.6) : 0.3
      } else if (offScore && !otherHere) {
        // Something is sounding that neither the bleed model nor the other part
        // explains.  In this room that is the singer, even off the score.
        kind = 'mine'
        confidence = 0.6
        octave = 0
      } else {
        kind = 'unclear'
        confidence = 0.25
      }
    } else if (mineHere && time >= scheduled.start - HOP_SECONDS && time < scheduled.end) {
      const samePitch = otherHere !== null && Math.abs(mineHere.midi - otherHere.midi) < 0.5
      if (samePitch) {
        // My part is due and the other part holds the same pitch: even though
        // nothing rises above the bleed, the microphone cannot rule the singer
        // in or out.  That is exactly "cannot judge".
        kind = 'unclear'
        confidence = 0.28
      } else {
        kind = 'quiet'
        confidence = 0.2
      }
    }

    if (kind === 'pause') continue
    frames.push({
      start: time, end, kind, confidence, octave, residualDb, bleedDb,
      midi: mineHere?.midi ?? null,
      otherMidi: otherMidi?.midi ?? null,
      mineMidi: mineHere?.midi ?? null,
    })
  }

  smoothKinds(frames)
  const segments = mergeFrames(frames, scheduled)
  for (const segment of segments) {
    const representative = frames.find(frame => frame.start === segment.start)!
    segment.reason = reasonFor(representative, role)
  }
  const kept = segments.filter(segment =>
    segment.end - segment.start >= MIN_VOICED_SECONDS * 0.6 || segment.confidence >= 0.7)
  const coverage = splitCoverage(kept, scheduled)
  const early = coverage
    .filter(piece => piece.start < scheduled.start - 0.04)
    .map(piece => ({ start: piece.start, end: Math.min(piece.end, scheduled.start) }))
  const summary: Record<EvidenceKind, number> = { mine: 0, bleed: 0, unclear: 0, quiet: 0 }
  for (const segment of kept) summary[segment.kind] += segment.end - segment.start

  const evidence: EvidenceSnapshot = {
    version: 1,
    guideTrack: exercise.tracks[otherRole],
    recordedGuideVolume: guideVolume,
    assessedAt: Date.now(),
    sampleRate: input.sampleRate,
    delaySeconds: coupling.delaySeconds,
    bleedGain: coupling.gain,
    noiseDb: floorDb,
    segments: kept,
    coverage,
    early,
    summary,
    scheduled,
    clip: { start: clipStart, end: clipStart + input.clip.length / input.sampleRate },
    note: buildNote(summary, early, coupling),
    waveform: waveformPeaks(input.clip, 400),
  }
  return { evidence, pitch: [...(input.pitch ?? [])], guideTrace }
}

function buildNote(
  summary: Record<EvidenceKind, number>, early: readonly TimeRange[], coupling: Coupling,
): string {
  const parts: string[] = []
  if (summary.bleed > 0.12) parts.push('含对方导唱串音')
  if (summary.unclear > 0.12) parts.push('同音重叠段存疑')
  if (early.length) parts.push('入口前已有声音，按抢拍单列')
  if (summary.quiet > 0.25) parts.push('有一段只有底噪')
  if (coupling.gain > 0.6 || coupling.confidence > 0.55) parts.push('串音偏强，判断更保守')
  return parts.join('；') || '未发现串音，证据清楚'
}
