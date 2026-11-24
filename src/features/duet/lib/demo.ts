import type { DuetExercise, DuetNote, RoleId } from '../model/types'
import { synthesiseTake, type SynthTake } from './synth'

export interface DemoPreset {
  id: string
  name: string
  summary: string
  role: RoleId
  lineId: string
  bleed: number
  extra?: DuetNote[]
  ownOverride?: DuetNote[]
  ownGain?: number
  octave?: number
}

/**
 * The validation set the user asked for, pinned to one joint per exercise:
 *   * the same joint at weak and strong bleed,
 *   * a quiet octave double,
 *   * an early entry kept as its own row,
 *   * a re-entry after a break within the same loop,
 *   * a unison overlap that cannot be judged from the role windows.
 */
export function demoPresets(exercise: DuetExercise): DemoPreset[] {
  const mineLine = exercise.lines[1]
  const mine = exercise.parts[mineLine.role]
  const entrance = mine[0]
  const second = mine[1]
  // The unison moment: both roles hold one pitch, found from the parts.
  const otherNotes = exercise.parts[mineLine.role === 'a' ? 'b' : 'a']
  const collide = mine.flatMap(note => otherNotes
    .filter(entry => entry.midi === note.midi && entry.end > note.start + 0.05 && entry.start < note.end - 0.05)
    .map(entry => ({ start: Math.max(note.start, entry.start), end: Math.min(note.end, entry.end), midi: note.midi })))
  const collision = collide.sort((left, right) => right.end - right.start - (left.end - left.start))[0] ?? null
  const collisionLine = collision
    ? mineLine.role === mineLine.role
      ? exercise.lines.find(line => line.role === mineLine.role && line.start <= collision.start + 0.01 && line.end > collision.start) ?? mineLine
      : mineLine
    : mineLine
  return [
    {
      id: `${exercise.id}-demo-weak`,
      name: '轻串音',
      summary: '对方尾音压过入口，但能分出我的两句',
      role: mineLine.role,
      lineId: mineLine.id,
      bleed: 0.18,
      ownGain: 0.2,
    },
    {
      id: `${exercise.id}-demo-strong`,
      name: '强串音',
      summary: '扬声器很响，靠已知导唱轨扣除串音',
      role: mineLine.role,
      lineId: mineLine.id,
      bleed: 0.8,
      ownGain: 0.2,
    },
    {
      id: `${exercise.id}-demo-octave`,
      name: '高八度轻唱',
      summary: '只在另一个八度轻唱，证据偏弱',
      role: mineLine.role,
      lineId: mineLine.id,
      bleed: 0.45,
      ownGain: 0.15,
      octave: 12,
    },
    {
      id: `${exercise.id}-demo-early`,
      name: '抢拍进入',
      summary: '入口前 0.42 秒已经开口，原声保留并单列',
      role: mineLine.role,
      lineId: mineLine.id,
      bleed: 0.35,
      extra: [{ start: entrance.start - 0.42, end: entrance.start - 0.05, midi: entrance.midi }],
    },
    {
      id: `${exercise.id}-demo-reentry`,
      name: '循环内重入',
      summary: '唱一句就停，隔一段再进，两个覆盖区间分开记',
      role: mineLine.role,
      lineId: mineLine.id,
      bleed: 0.35,
      ownOverride: [
        mine[0],
        second,
        { start: second.end + 0.6, end: second.end + 1.25, midi: second.midi },
      ],
    },
    {
      id: `${exercise.id}-demo-unison`,
      name: '同音重叠',
      summary: '双方同时同音，单靠时段无法判断，标为存疑',
      role: collision ? collisionLine.role : mineLine.role,
      lineId: collision ? collisionLine.id : mineLine.id,
      bleed: 0.6,
      ownGain: 0.12,
      ownOverride: collision ? [{ start: collision.start, end: collision.end, midi: collision.midi }] : [],
    },
  ]
}

/** Render a preset as an actual take (same analysis path as live capture). */
export function buildDemoTakes(
  exercise: DuetExercise, guideVolume: number, now = Date.now(),
): SynthTake[] {
  const presets = demoPresets(exercise)
  return presets.map((preset, index) => synthesiseTake({
    exercise,
    role: preset.role,
    lineId: preset.lineId,
    bleed: preset.bleed,
    ownOverride: preset.ownOverride,
    extra: preset.extra,
    ownGain: preset.ownGain,
    octave: preset.octave,
    guideVolume,
    createdAt: now - (presets.length - index) * 60_000,
    id: preset.id,
    label: preset.name,
  }))
}

export type { SynthTake }
