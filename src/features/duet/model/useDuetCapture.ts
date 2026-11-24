import { onBeforeUnmount, ref } from 'vue'
import type { DuetExercise, DuetLine, DuetTake, RoleId } from './types'
import { openInput } from '../../capture/lib/input'
import { toWave } from '../../capture/lib/wave'
import { analyseJoint } from '../lib/evidence'
import { autocorrelationPitch } from '../lib/dsp'
import { FRAME_SECONDS, HOP_SECONDS } from './constants'
import type { PitchPoint } from '../../../shared/document'

export interface CaptureInputs {
  exercise: DuetExercise
  line: DuetLine
  role: RoleId
  guideBuffer: AudioBuffer | null
  guideVolume: number
  /** Exact audio clock of the shared transport, in song seconds. */
  read: () => number
}

interface CaptureEvents {
  onFrame: (time: number, samples: Float32Array, rate: number) => void
  onComplete: (take: DuetTake) => Promise<void> | void
  preparePlayback: () => Promise<boolean>
}

interface ActiveCapture {
  inputStart: number
  songStart: number
  chunks: { inputTime: number; samples: Float32Array }[]
  stoppedAt: number | null
}

/**
 * A coarse F0 track for the review plot, computed from the saved clip at the
 * same 20 ms hop the evidence uses.  It is presentation only; nothing decides
 * anything from it.
 */
function pitchTrack(clip: Float32Array, rate: number, clipStart: number) {
  const span = Math.round(FRAME_SECONDS * rate)
  const hop = Math.round(HOP_SECONDS * rate)
  const points: PitchPoint[] = []
  for (let offset = 0; offset + span <= clip.length; offset += hop) {
    const pitch = autocorrelationPitch(clip.subarray(offset, offset + span), rate, 40, 90)
    points.push({ time: clipStart + offset / rate + FRAME_SECONDS / 2, midi: pitch?.midi ?? null })
  }
  return points
}

/**
 * Microphone capture for one joint.
 *
 * The clip deliberately begins PREROLL seconds before the scheduled entrance so
 * a 抢拍 take keeps the sound that actually left the singer's mouth.  The
 * recorder does not trim it; the analysis and the UI decide what is "early"
 * and show it as its own line.
 */
export function useDuetCapture(events: CaptureEvents) {
  const status = ref<'idle' | 'requesting' | 'recording' | 'processing'>('idle')
  const issue = ref('')
  const level = ref(0)
  let input: Awaited<ReturnType<typeof openInput>> | null = null
  let active: ActiveCapture | null = null
  let token = 0

  function receive(frame: { inputTime: number; samples: Float32Array }) {
    if (!active || !input || active.stoppedAt !== null) return
    active.chunks.push(frame)
    const rms = Math.sqrt(frame.samples.reduce((sum, value) => sum + value * value, 0) / frame.samples.length)
    level.value = Math.min(1, rms * 4)
    const time = active.songStart + frame.inputTime - active.inputStart
    events.onFrame(time, frame.samples, input.sampleRate)
  }

  async function start(inputs: CaptureInputs) {
    if (status.value !== 'idle') return
    const current = ++token
    status.value = 'requesting'
    issue.value = ''
    try {
      const stream = await openInput(receive, () => {
        issue.value = '麦克风已断开。'
        if (status.value === 'requesting') cancel()
        else void stop(inputs, inputs.read())
      })
      if (current !== token) { stream.close(); return }
      input = stream
      const ready = await events.preparePlayback()
      if (!ready || current !== token) {
        if (input === stream) cancel()
        return
      }
      // Align the clip with the guide's own clock rather than the UI's rAF
      // position: the coupling estimate then only has to absorb the room delay.
      const songStart = Math.max(0, inputs.read())
      active = { inputStart: stream.clock(), songStart, chunks: [], stoppedAt: null }
      status.value = 'recording'
    } catch (error) {
      if (current !== token) return
      cancel()
      issue.value = error instanceof DOMException && error.name === 'NotAllowedError'
        ? '麦克风权限未开启。' : '无法开启麦克风，请检查设备和访问权限。'
    }
  }

  function cancel() {
    token++
    input?.close()
    input = null
    active = null
    level.value = 0
    if (status.value !== 'processing') status.value = 'idle'
  }

  async function stop(inputs: CaptureInputs, endPosition: number) {
    if (status.value !== 'recording' || !active || !input) return
    status.value = 'processing'
    const recording = active
    const stream = input
    recording.stoppedAt = endPosition
    const songStart = recording.songStart
    const end = Math.max(songStart + 0.2, Math.min(endPosition, inputs.line.end + 0.45, inputs.exercise.duration))
    try {
      await stream.flush()
      const chunks = recording.chunks
      const duration = end - songStart
      const audio = toWave(chunks, recording.inputStart, duration, stream.sampleRate)
      const clip = mergeChunks(chunks, recording.inputStart, duration, stream.sampleRate)
      // The guide is handed over at the clip's own rate and extent so the
      // coupling estimate compares like with like.
      const guide = inputs.guideBuffer
        ? sliceAudioBuffer(inputs.guideBuffer, songStart, duration)
        : new Float32Array(Math.ceil(duration * stream.sampleRate))
      const result = analyseJoint({
        clip, sampleRate: stream.sampleRate,
        guide, guideRate: inputs.guideBuffer?.sampleRate ?? stream.sampleRate,
        exercise: inputs.exercise, line: inputs.line, role: inputs.role,
        clipStart: songStart, guideVolume: inputs.guideVolume,
        pitch: pitchTrack(clip, stream.sampleRate, songStart),
      })
      await events.onComplete({
        id: crypto.randomUUID(),
        exerciseId: inputs.exercise.id,
        role: inputs.role,
        lineId: inputs.line.id,
        createdAt: Date.now(),
        start: songStart,
        end,
        audio,
        pitch: result.pitch,
        evidence: result.evidence,
        guidePitch: result.guideTrace,
        guideVolume: inputs.guideVolume,
      })
    } catch {
      issue.value = '录音未能保存。'
    } finally {
      stream.close()
      input = null
      active = null
      level.value = 0
      status.value = 'idle'
    }
  }

  onBeforeUnmount(() => {
    token++
    if (status.value !== 'processing') input?.close()
    input = null
  })

  return { status, issue, level, start, stop, cancel }
}

function mergeChunks(chunks: readonly { inputTime: number; samples: Float32Array }[], inputStart: number, duration: number, rate: number) {
  const output = new Float32Array(Math.max(1, Math.round(duration * rate)))
  for (const chunk of chunks) {
    const offset = Math.round((chunk.inputTime - inputStart) * rate)
    for (let index = 0; index < chunk.samples.length; index++) {
      const target = offset + index
      if (target >= 0 && target < output.length) output[target] += chunk.samples[index]
    }
  }
  return output
}

export function sliceAudioBuffer(buffer: AudioBuffer, start: number, duration: number) {
  const rate = buffer.sampleRate
  const first = Math.max(0, Math.min(buffer.length, Math.round(start * rate)))
  const count = Math.max(1, Math.min(buffer.length - first, Math.round(duration * rate)))
  const output = new Float32Array(count)
  const channel = buffer.getChannelData(0)
  for (let index = 0; index < count; index++) output[index] = channel[first + index] ?? 0
  return output
}
