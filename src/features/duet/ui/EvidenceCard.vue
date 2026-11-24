<script setup lang="ts">
import { computed } from 'vue'
import { AudioWaveform, CircleDashed, Ear, ShieldQuestion, Volume2 } from '@lucide/vue'
import type { DuetExercise, DuetLine, DuetTake } from '../model/types'
import { COVERAGE_HINT, COVERAGE_LABEL, KIND_HINT, KIND_LABEL } from '../lib/labels'
import { clockLabel } from '../../../shared/time'
import EvidenceTimeline from './EvidenceTimeline.vue'

const props = defineProps<{
  take: DuetTake
  exercise: DuetExercise
  line: DuetLine
  playhead: number | null
  liveGuideVolume: number
}>()
const emit = defineEmits<{ seek: [number]; range: [{ start: number; end: number }] }>()

const evidence = computed(() => props.take.evidence)
const volumeAtCapture = computed(() => Math.round(evidence.value.recordedGuideVolume * 100))
const volumeNow = computed(() => Math.round(props.liveGuideVolume * 100))
const coverage = computed(() => evidence.value.coverage)
const early = computed(() => coverage.value.filter(piece => piece.label === 'early'))
const reentry = computed(() => coverage.value.filter(piece => piece.label === 'reentry'))
const totalMine = computed(() => evidence.value.summary.mine)
const totalBleed = computed(() => evidence.value.summary.bleed)
const totalUnclear = computed(() => evidence.value.summary.unclear)
const hasOldVolume = computed(() => Math.abs(volumeAtCapture.value - volumeNow.value) >= 1)

const notes = computed(() => [
  `串音耦合 ${(evidence.value.bleedGain * 100).toFixed(0)}%，延迟 ${(evidence.value.delaySeconds * 1000).toFixed(0)} ms`,
  `底噪 ${evidence.value.noiseDb.toFixed(0)} dBFS`,
  `证据冻结于 ${new Date(evidence.value.assessedAt).toLocaleString('zh-CN')}`,
])
</script>

<template>
  <article class="evidence-card" aria-labelledby="evidence-heading">
    <header class="evidence-head">
      <div>
        <p class="evidence-kicker"><Ear :size="14" /> 对照证据 · {{ line.text }}</p>
        <h3 id="evidence-heading">{{ take.demo ? take.label : '这一条录音' }}</h3>
      </div>
      <span class="evidence-note">{{ evidence.note }}</span>
    </header>

    <div class="evidence-badges">
      <span class="badge mine"><i></i>确实有我 {{ totalMine.toFixed(2) }}s</span>
      <span class="badge bleed"><i></i>串音 {{ totalBleed.toFixed(2) }}s</span>
      <span class="badge unclear"><ShieldQuestion :size="13" />无法判断 {{ totalUnclear.toFixed(2) }}s</span>
      <span v-if="early.length" class="badge early"><i></i>抢拍 {{ early.length }} 段</span>
      <span v-if="reentry.length" class="badge reentry"><i></i>重入 {{ reentry.length }} 段</span>
    </div>

    <EvidenceTimeline :exercise="exercise" :line="line" :evidence="evidence" :playhead="playhead"
      @seek="emit('seek', $event)" />

    <div class="coverage-table">
      <div class="coverage-row coverage-head">
        <span>实际覆盖</span><span>区间</span><span>说明</span>
      </div>
      <div v-if="!coverage.length" class="coverage-row empty">
        <span>—</span><span>—</span><span>这一条没有可确认的开口</span>
      </div>
      <button v-for="(piece, index) in coverage" :key="`${piece.start}-${index}`" class="coverage-row" :class="piece.label"
        :title="`从 ${piece.start.toFixed(2)} 秒开始复听`" @click="emit('range', piece)">
        <span class="coverage-tag">{{ COVERAGE_LABEL[piece.label] }}</span>
        <span class="mono">{{ clockLabel(piece.start, true) }}–{{ clockLabel(piece.end, true) }}</span>
        <span>{{ COVERAGE_HINT[piece.label] }}</span>
      </button>
    </div>

    <details class="evidence-details">
      <summary>逐段判断</summary>
      <ul>
        <li v-for="(segment, index) in evidence.segments" :key="`${segment.start}-${index}`">
          <span class="segment-kind" :class="segment.kind">{{ KIND_LABEL[segment.kind] }}</span>
          <span class="mono">{{ segment.start.toFixed(2) }}–{{ segment.end.toFixed(2) }}s</span>
          <span>
            {{ KIND_HINT[segment.kind] }}。{{ segment.reason }}
            <em class="segment-confidence mono">可信度 {{ Math.round(segment.confidence * 100) }}%</em>
          </span>
        </li>
      </ul>
    </details>

    <footer class="evidence-foot">
      <span><CircleDashed :size="13" /> 证据记录时的导唱音量 <strong class="mono">{{ volumeAtCapture }}%</strong></span>
      <span v-if="hasOldVolume" class="volume-shift"><Volume2 :size="13" /> 现在 {{ volumeNow }}%，旧证据不随之改写</span>
      <span v-else><AudioWaveform :size="13" /> 串音与延迟已按已知导唱轨扣除</span>
    </footer>
    <p class="evidence-protocol">
      判定只看已知对方导唱扣除后的残差与音高，不按角色时段推断；同音重叠且串音能解释电平，一律标为无法判断。
      抢拍的原声保留在原始复听中，并在此按实际覆盖单列。
    </p>
    <p class="evidence-meta mono">{{ notes.join(' · ') }}</p>
  </article>
</template>
