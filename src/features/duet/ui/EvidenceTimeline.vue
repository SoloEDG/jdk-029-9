<script setup lang="ts">
import { computed } from 'vue'
import type { DuetExercise, DuetLine, EvidenceSnapshot } from '../model/types'
import { COVERAGE_LABEL, KIND_HINT, KIND_LABEL } from '../lib/labels'
import { clockLabel } from '../../../shared/time'

const props = defineProps<{
  exercise: DuetExercise
  line: DuetLine
  evidence: EvidenceSnapshot
  playhead: number | null
}>()

const emit = defineEmits<{ seek: [number] }>()

const span = computed(() => Math.max(0.01, props.evidence.clip.end - props.evidence.clip.start))
const pct = (time: number) => Math.max(0, Math.min(100, (time - props.evidence.clip.start) / span.value * 100))
const playheadPct = computed(() => props.playhead === null ? null : pct(props.playhead))
const entryPct = computed(() => pct(props.evidence.scheduled.start))
const otherRole = computed(() => props.line.role === 'a' ? 'b' : 'a')
const mineNotes = computed(() => props.exercise.parts[props.line.role]
  .filter(note => note.end > props.evidence.clip.start && note.start < props.evidence.clip.end))
const otherNotes = computed(() => props.exercise.parts[otherRole.value]
  .filter(note => note.end > props.evidence.clip.start && note.start < props.evidence.clip.end))

function style(range: { start: number; end: number }) {
  return { left: `${pct(range.start)}%`, width: `${Math.max(0.6, pct(range.end) - pct(range.start))}%` }
}
</script>

<template>
  <div class="duet-timeline" role="group" aria-label="证据时间线">
    <div class="timeline-ruler mono">
      <span>{{ clockLabel(evidence.clip.start, true) }}</span>
      <span>{{ clockLabel(evidence.clip.end, true) }}</span>
    </div>
    <div class="wave-lane">
      <div class="wave-peaks" aria-hidden="true">
        <i v-for="(peak, index) in evidence.waveform" :key="index" :style="{ height: `${Math.max(2, peak * 100)}%` }"></i>
      </div>
      <div v-if="playheadPct !== null" class="timeline-playhead" :style="{ left: `${playheadPct}%` }"></div>
      <div class="entry-marker" :style="{ left: `${entryPct}%` }" title="入口"></div>
    </div>
    <div class="segment-lane">
      <button v-for="(segment, index) in evidence.segments" :key="`${segment.start}-${index}`"
        class="timeline-segment" :class="segment.kind" :style="style(segment)"
        :title="`${KIND_LABEL[segment.kind]} · ${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s · ${KIND_HINT[segment.kind]} · ${segment.reason}`"
        :aria-label="`${KIND_LABEL[segment.kind]} ${segment.start.toFixed(2)} 到 ${segment.end.toFixed(2)} 秒`"
        @click="emit('seek', segment.start)"></button>
      <span v-if="playheadPct !== null" class="timeline-playhead" :style="{ left: `${playheadPct}%` }"></span>
    </div>
    <div class="coverage-lane" aria-label="实际覆盖">
      <button v-for="(piece, index) in evidence.coverage" :key="`cov-${piece.start}-${index}`"
        class="coverage-piece" :class="piece.label" :style="style(piece)"
        :title="`${COVERAGE_LABEL[piece.label]} ${piece.start.toFixed(2)}–${piece.end.toFixed(2)}s`"
        @click="emit('seek', piece.start)">
        <span>{{ COVERAGE_LABEL[piece.label] }}</span>
      </button>
      <span v-if="!evidence.coverage.length" class="coverage-empty">没有确认的开口段</span>
    </div>
    <div class="note-lane mine" aria-hidden="true">
      <i v-for="(note, index) in mineNotes" :key="`m-${index}`" class="note-chip"
        :class="{ scheduled: note.start >= evidence.scheduled.start - 0.02 }" :style="style(note)"></i>
    </div>
    <div class="note-lane other" aria-hidden="true">
      <i v-for="(note, index) in otherNotes" :key="`o-${index}`" class="note-chip" :style="style(note)"></i>
    </div>
    <div class="timeline-key">
      <span><i class="swatch mine"></i>确实有我</span>
      <span><i class="swatch bleed"></i>主要是串音</span>
      <span><i class="swatch unclear"></i>无法判断</span>
      <span><i class="swatch quiet"></i>只有底噪</span>
      <span class="key-gap"><i class="swatch entry"></i>入口</span>
    </div>
  </div>
</template>
