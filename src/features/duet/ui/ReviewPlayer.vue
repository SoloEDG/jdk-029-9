<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, CircleCheck, Headphones, Play, Square, Volume2, VolumeX } from '@lucide/vue'
import type { DuetExercise, DuetTake } from '../model/types'
import type { ReviewMode } from '../model/useDuetReview'
import EvidenceCard from './EvidenceCard.vue'

const props = defineProps<{
  take: DuetTake | null
  exercise: DuetExercise
  mode: ReviewMode
  guideVolume: number
  playing: boolean
  playhead: number | null
  issue: string
}>()
const emit = defineEmits<{
  listen: [DuetTake]
  seek: [number]
  range: [{ start: number; end: number }]
  guideVolume: [number]
  toggleGuide: []
}>()

const line = computed(() => props.take
  ? props.exercise.lines.find(entry => entry.id === props.take!.lineId) ?? null
  : null)
const guideMuted = computed(() => props.mode.guide === false || props.guideVolume === 0)
</script>

<template>
  <section class="review-player" aria-labelledby="player-heading">
    <div class="player-head">
      <h2 id="player-heading" class="panel-heading"><Headphones :size="17" /> 原始复听与对照</h2>
      <span v-if="take?.demo" class="demo-tag">验证样本</span>
    </div>

    <div v-if="!take || !line" class="empty-takes">
      <Headphones :size="23" />
      <span>还没有这一接头的录音。录一条，或用下方验证样本演示。</span>
    </div>

    <template v-else>
      <div class="player-strip">
        <button class="play-button small" :aria-label="playing ? '停止复听' : '复听这一条'"
          @click="emit('listen', take)">
          <Square v-if="playing" :size="15" fill="currentColor" /><Play v-else :size="15" fill="currentColor" />
        </button>
        <div class="player-copy">
          <strong>{{ take.demo ? take.label : '原始复听' }}</strong>
          <small class="mono">{{ take.start.toFixed(2) }}–{{ take.end.toFixed(2) }}s ·
            {{ line.role === 'a' ? '低声部' : '高声部' }} · 录于 {{ new Date(take.createdAt).toLocaleTimeString('zh-CN') }}</small>
        </div>
        <div class="guide-mix">
          <button class="icon-button" :aria-label="guideMuted ? '加入对方导唱' : '静音对方导唱'" @click="emit('toggleGuide')">
            <VolumeX v-if="guideMuted" :size="16" /><Volume2 v-else :size="16" />
          </button>
          <label class="mix-slider">
            <span class="mono">导唱 {{ Math.round(guideVolume * 100) }}%</span>
            <input aria-label="复听时叠加的对方导唱音量" type="range" min="0" max="1" step="0.01"
              :value="guideVolume" :style="{ '--fill': `${guideVolume * 100}%` }"
              @input="emit('guideVolume', Number(($event.target as HTMLInputElement).value))" />
          </label>
        </div>
      </div>

      <p class="player-note">
        <CircleCheck :size="14" />
        原始录音不含任何处理；导唱只是叠加在复听上，改动音量不会改写下面冻结的证据。
      </p>

      <EvidenceCard :take="take" :exercise="exercise" :line="line" :playhead="playhead"
        :live-guide-volume="guideVolume" @seek="emit('seek', $event)" @range="emit('range', $event)" />
    </template>

    <p v-if="issue" class="inline-error" role="alert"><CircleAlert :size="14" /> {{ issue }}</p>
  </section>
</template>
