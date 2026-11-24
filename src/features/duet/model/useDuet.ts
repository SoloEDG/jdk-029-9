import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { Song, TimeRange } from '../../../shared/document'
import type { DuetExercise, DuetLine, RoleId } from './types'
import { duetExercises, linesFor } from './catalog'
import { otherRole } from '../lib/joint'
import { PREROLL } from './constants'

/**
 * Duet session state: exercise, which role *I* sing, which line is selected and
 * a single transport shared by both roles' tracks.
 *
 * The guide track is the *other* role's part.  Its volume is a live playback
 * setting only: takes keep the volume they were recorded against, so an old
 * piece of evidence is never rewritten by moving this slider.
 */
export function useDuet() {
  const exercise = shallowRef<DuetExercise>(duetExercises[0])
  const role = ref<RoleId>('a')
  const selectedId = ref(linesFor(duetExercises[0], 'a')[0]?.id ?? '')
  const position = ref(0)
  const playing = ref(false)
  const guideVolume = ref(0.65)
  const loop = ref(false)
  const issue = ref('')
  const tracks: Record<RoleId, HTMLAudioElement> = {
    a: makeAudio(exercise.value.tracks.a),
    b: makeAudio(exercise.value.tracks.b),
  }
  let frame = 0
  let operation = 0

  function makeAudio(src: string) {
    const audio = new Audio(src)
    audio.preload = 'auto'
    return audio
  }

  const selected = computed<DuetLine | null>(() =>
    exercise.value.lines.find(line => line.id === selectedId.value) ?? null)
  const myLines = computed(() => linesFor(exercise.value, role.value))
  const ownAudio = computed(() => tracks[role.value])
  const joint = computed(() => {
    const line = selected.value
    if (!line) return null
    const lead = PREROLL
    const lag = 0.45
    return {
      start: Math.max(0, line.start - lead),
      end: Math.min(exercise.value.duration, line.end + lag),
    } satisfies TimeRange
  })

  function sync() {
    const audio = ownAudio.value
    if (audio.seeking) return
    const next = audio.currentTime
    const range = joint.value
    if (playing.value && loop.value && range && next >= range.end - 0.02) {
      seek(range.start)
      void startPlayback()
      return
    }
    position.value = next
    if (!audio.paused) frame = requestAnimationFrame(sync)
  }

  /** Start both tracks at the current position without the "already playing" guard. */
  async function startPlayback() {
    const current = ++operation
    applyVolumes()
    try {
      await Promise.all([tracks.a.play(), tracks.b.play()])
      if (current !== operation) return false
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
      return true
    } catch {
      if (current === operation) issue.value = '导唱播放失败，请再点一次播放。'
      pause()
      return false
    }
  }

  // The guide you hear while practising is always the *other* role.  Your own
  // track runs silently as the shared clock, so both stay sample-aligned.
  function applyVolumes() {
    tracks[role.value].volume = 0
    tracks[otherRole(role.value)].volume = guideVolume.value
  }

  /** Exact audio clock, used to align a recording with the guide. */
  function readPosition() {
    return ownAudio.value.currentTime
  }

  function seek(seconds: number) {
    const time = Math.max(0, Math.min(seconds, exercise.value.duration))
    for (const id of ['a', 'b'] as const) tracks[id].currentTime = time
    position.value = time
  }

  async function play() {
    if (playing.value) return true
    issue.value = ''
    const range = joint.value
    if (range && (position.value < range.start || position.value >= range.end - 0.02)) seek(range.start)
    const started = await startPlayback()
    if (started) playing.value = true
    return started
  }

  function pause() {
    operation++
    for (const id of ['a', 'b'] as const) tracks[id].pause()
    playing.value = false
    cancelAnimationFrame(frame)
    if (joint.value) position.value = ownAudio.value.currentTime
  }

  /**
   * Select the joint for a line.  The line you click may belong to either part;
   * the joint is always the same pair, and "我唱" does not silently change.
   */
  function select(id: string) {
    const clicked = exercise.value.lines.find(entry => entry.id === id)
    if (!clicked) return
    pause()
    const line = clicked.role === role.value ? clicked : jointLine(clicked)
    selectedId.value = line.id
    seek(Math.max(0, line.start - 0.85))
  }

  /** Which of my lines shares the joint with a line from the other part. */
  function jointLine(other: DuetLine): DuetLine {
    const mine = myLines.value
    const overlapping = mine
      .map(line => ({ line, overlap: Math.min(line.end, other.end) - Math.max(line.start, other.start) }))
      .sort((left, right) => right.overlap - left.overlap)[0]
    if (overlapping && overlapping.overlap > 0.2) return overlapping.line
    return mine.find(line => line.start >= other.start) ?? mine[mine.length - 1] ?? other
  }

  function setRole(next: RoleId) {
    if (next === role.value) return
    pause()
    role.value = next
    // Stay at the same joint: pick my line in the new role that overlaps the
    // current moment, so switching roles does not throw away the selected spot.
    const current = selected.value
    const options = linesFor(exercise.value, next)
    const keep = current
      ? options.find(line => line.start <= current.start + 0.3 && line.end >= current.start - 0.3) ?? options[0]
      : options[0]
    if (keep) selectedId.value = keep.id
    applyVolumes()
    if (keep) seek(Math.max(0, keep.start - 0.9))
  }

  /** Loop the currently selected joint; selecting it again re-seeks the start. */
  function toggleLoop() {
    loop.value = !loop.value
    const line = selected.value
    if (loop.value && line) seek(Math.max(0, line.start - PREROLL))
  }

  function adjacent(direction: -1 | 1) {
    const lines = myLines.value
    const index = lines.findIndex(line => line.id === selectedId.value)
    const line = lines[Math.min(lines.length - 1, Math.max(0, index + direction))]
    if (line) select(line.id)
  }

  function setExercise(next: DuetExercise) {
    pause()
    for (const id of ['a', 'b'] as const) {
      tracks[id].pause()
      tracks[id].removeAttribute('src')
      tracks[id].src = next.tracks[id]
      tracks[id].load()
    }
    exercise.value = next
    const first = linesFor(next, role.value)[0] ?? next.lines[0]
    selectedId.value = first?.id ?? ''
    position.value = 0
    applyVolumes()
  }

  function setGuideVolume(value: number) {
    guideVolume.value = Math.min(1, Math.max(0, value))
    applyVolumes()
  }

  applyVolumes()
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    for (const id of ['a', 'b'] as const) {
      tracks[id].pause()
      tracks[id].removeAttribute('src')
      tracks[id].load()
    }
  })

  return {
    exercise, role, selected, myLines, position, playing, guideVolume, loop, issue,
    joint, ownAudio,
    play, pause, seek, readPosition, select, setRole, adjacent, setExercise, setGuideVolume,
    toggleLoop, syncPosition: sync,
  }
}

export type DuetSession = ReturnType<typeof useDuet>
export type { Song, DuetExercise }
