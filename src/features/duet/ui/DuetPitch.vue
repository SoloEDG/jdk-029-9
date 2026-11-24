<script setup lang="ts">
import { Activity } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import type { GuideNote, PitchPoint, TimeRange } from '../../../shared/document'
import type { DuetExercise, DuetLine, RoleId } from '../model/types'
import { drawPitch as drawPlot } from '../../pitch/lib/plot'
import { clockLabel } from '../../../shared/time'

const props = defineProps<{
  exercise: DuetExercise
  line: DuetLine
  role: RoleId
  range: TimeRange
  position: number
  myPitch: PitchPoint[]
  guidePitch: PitchPoint[]
  evidence: { start: number; end: number; kind: 'mine' | 'bleed' | 'unclear' | 'quiet' }[]
  live: PitchPoint[]
  liveLabel: string | null
}>()

const BAND_COLORS = {
  mine: 'rgba(184, 220, 157, 0.12)',
  bleed: 'rgba(181, 143, 201, 0.14)',
  unclear: 'rgba(229, 189, 112, 0.13)',
  quiet: 'rgba(120, 128, 110, 0.08)',
} as const

const canvas = ref<HTMLCanvasElement | null>(null)
const size = ref({ width: 0, height: 0 })
let observer: ResizeObserver | undefined

function notesFor(id: RoleId): GuideNote[] {
  return props.exercise.parts[id].map(note => ({ start: note.start, end: note.end, midi: note.midi }))
}

function otherNotesFor(id: RoleId): PitchPoint[] {
  const points: PitchPoint[] = []
  for (const note of notesFor(id === 'a' ? 'b' : 'a')) {
    points.push({ time: note.start, midi: note.midi }, { time: note.end - 0.001, midi: note.midi })
    points.push({ time: note.end, midi: null })
  }
  return points
}

onMounted(() => {
  if (!canvas.value) return
  observer = new ResizeObserver(([entry]) => {
    size.value = { width: entry.contentRect.width, height: entry.contentRect.height }
  })
  observer.observe(canvas.value)
})
onBeforeUnmount(() => observer?.disconnect())

watchEffect(() => {
  const { width, height } = size.value
  if (!canvas.value || width < 80 || height < 80) return
  const mine = props.myPitch.filter(point => point.time >= props.range.start && point.time <= props.range.end)
  const guide = props.guidePitch.filter(point => point.time >= props.range.start && point.time <= props.range.end)
  drawPlot(canvas.value, width, height, {
    notes: notesFor(props.line.role),
    range: props.range,
    position: props.position,
    bands: props.evidence
      .filter(band => band.kind !== 'quiet')
      .map(band => ({ start: band.start, end: band.end, color: BAND_COLORS[band.kind] })),
    traces: [
      { points: otherNotesFor(props.line.role), color: '#9d86b8', width: 1 },
      { points: mine, color: '#85cbd5' },
      { points: guide, color: '#b58fc9' },
      { points: props.live, color: '#b8dc9d' },
    ],
  })
})
</script>

<template>
  <section class="pitch-panel duet-pitch" aria-labelledby="duet-pitch-title">
    <div class="pitch-heading">
      <h2 id="duet-pitch-title" class="panel-heading"><Activity :size="17" /> 音高对照</h2>
      <div class="pitch-legends">
        <span><i class="legend reference"></i>我的参考音</span>
        <span><i class="legend other"></i>对方声部</span>
        <span><i class="legend a"></i>我的录音</span>
        <span><i class="legend b"></i>已知导唱</span>
        <span v-if="live.length"><i class="legend live"></i>正在唱</span>
      </div>
    </div>
    <canvas ref="canvas" class="pitch-canvas" role="img"
      :aria-label="`双声部音高对照，当前音高 ${liveLabel ?? '未检测到'}`"></canvas>
    <div class="pitch-footer">
      <span>当前音高 <strong class="mono">{{ liveLabel ?? '—' }}</strong></span>
      <span class="mono">{{ clockLabel(range.start, true) }}–{{ clockLabel(range.end, true) }}</span>
    </div>
  </section>
</template>
