<script setup lang="ts">
import { AudioWaveform, Sparkles, Trash2 } from '@lucide/vue'
import type { DuetExercise, DuetTake } from '../model/types'
import { clockLabel } from '../../../shared/time'
import { COVERAGE_LABEL } from '../lib/labels'

defineProps<{
  takes: DuetTake[]
  exercise: DuetExercise
  selectedId: string | null
  playingId: string | null
  demoOn: boolean
}>()
const emit = defineEmits<{ choose: [DuetTake]; remove: [string]; demos: []; clearDemos: [] }>()

const lineText = (exercise: DuetExercise, id: string) =>
  exercise.lines.find(line => line.id === id)?.text ?? '—'
</script>

<template>
  <section class="take-list" aria-labelledby="take-list-heading">
    <h2 class="rail-title" id="take-list-heading"><AudioWaveform :size="17" /> 本接头录音 <span class="mono">{{ takes.length }}</span></h2>
    <ol>
      <li v-for="take in takes" :key="take.id">
        <button class="take-entry" :class="{ chosen: take.id === selectedId, playing: take.id === playingId }"
          :aria-pressed="take.id === selectedId" @click="emit('choose', take)">
          <span class="take-line">{{ take.demo ? take.label : lineText(exercise, take.lineId) }}</span>
          <span class="mono take-meta">{{ clockLabel(take.start, true) }} ·
            {{ take.role === 'a' ? '低' : '高' }} · {{ take.evidence.note }}</span>
          <span class="take-tags">
            <i v-for="label in [...new Set(take.evidence.coverage.map(piece => piece.label))]" :key="label"
              class="tag" :class="label">{{ COVERAGE_LABEL[label] }}</i>
            <i v-if="take.evidence.summary.unclear > 0.12" class="tag unclear">存疑</i>
            <i v-if="take.evidence.summary.bleed > 0.12" class="tag bleed">串音</i>
          </span>
        </button>
        <button v-if="!take.demo" class="icon-button remove" aria-label="删除这条录音"
          @click="emit('remove', take.id)"><Trash2 :size="13" /></button>
      </li>
    </ol>
    <div class="demo-actions">
      <button class="ghost-button" @click="emit('demos')">
        <Sparkles :size="15" /> {{ demoOn ? '重新生成验证样本' : '载入验证样本' }}
      </button>
      <button v-if="demoOn" class="ghost-button quiet" @click="emit('clearDemos')">移除样本</button>
    </div>
  </section>
</template>
