import type { PitchPoint, TimeRange } from '../../../shared/document'

export type RoleId = 'a' | 'b'
export type EvidenceKind = 'mine' | 'bleed' | 'unclear' | 'quiet'
export type CoverageLabel = 'early' | 'scheduled' | 'reentry' | 'late'

export interface DuetNote extends TimeRange { midi: number }

export interface DuetLine extends TimeRange {
  id: string
  role: RoleId
  text: string
}

export interface DuetRole {
  label: string
  range: string
}

export interface DuetExercise {
  id: string
  title: string
  bpm: number
  key: string
  duration: number
  cover: string
  leadIn: number
  roles: Record<RoleId, DuetRole>
  tracks: Record<RoleId, string>
  lines: DuetLine[]
  parts: Record<RoleId, DuetNote[]>
}

export interface EvidenceSegment extends TimeRange {
  kind: EvidenceKind
  /** 0–1, how strongly the microphone supports this reading. */
  confidence: number
  reason: string
  /** Semitone offset between the detected voice and the expected part (0, -12, +12). */
  octave: -12 | 0 | 12
  /** True when the segment falls outside the scheduled line window. */
  outside: boolean
  /** True when the segment starts before the scheduled entrance (抢拍). */
  early: boolean
  /** Seconds from the expected note onset; negative = early, positive = late. */
  shiftSeconds: number
}

export interface CoveragePiece extends TimeRange { label: CoverageLabel }

export interface EvidenceSnapshot {
  version: 1
  guideTrack: string
  /** The guide volume at the moment evidence was captured; later changes must not rewrite this. */
  recordedGuideVolume: number
  assessedAt: number
  sampleRate: number
  /** Delay from guide track emission to microphone, in seconds. */
  delaySeconds: number
  /** Least-squares acoustic coupling from the guide track into the microphone. */
  bleedGain: number
  noiseDb: number
  segments: EvidenceSegment[]
  /** Contiguous stretches where the voice was actually found, trimmed at the scheduled boundaries. */
  coverage: CoveragePiece[]
  /** The subset of coverage that starts before the entrance. */
  early: TimeRange[]
  summary: Record<EvidenceKind, number>
  scheduled: TimeRange
  /** Raw microphone clip, including the pre-roll that protects an early entrance. */
  clip: TimeRange
  note: string
  /** Coarse peak envelope of the clip, frozen with the evidence. */
  waveform: number[]
}

export interface DuetTake extends TimeRange {
  id: string
  exerciseId: string
  role: RoleId
  lineId: string
  createdAt: number
  audio: Blob
  pitch: PitchPoint[]
  evidence: EvidenceSnapshot
  /** Frozen at the top level too, so the review header is honest even if evidence is old. */
  guideVolume: number
  /** Synthesised validation sample rather than a live recording. */
  demo?: boolean
  /** The other role's known pitch over the clip, so the review can draw it. */
  guidePitch?: PitchPoint[]
  /** Presentation label, only used by validation samples. */
  label?: string
}

export interface PracticeJoint {
  myLine: DuetLine
  otherLine: DuetLine | null
  window: TimeRange
  scheduled: TimeRange
  overlapSeconds: number
  tailCrossesEntrance: boolean
}
