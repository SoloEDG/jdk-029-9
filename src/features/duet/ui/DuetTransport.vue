<script setup lang="ts">
import { Mic, Pause, Play, Repeat2, Square, Volume2, VolumeX } from '@lucide/vue'
import { clockLabel } from '../../../shared/time'
import type { DuetExercise } from '../model/types'

defineProps<{
  exercise: DuetExercise
  position: number
  playing: boolean
  loop: boolean
  guideVolume: number
  recording: boolean
  processing: boolean
  issue: string
}>()
const emit = defineEmits<{
  toggle: []; loop: []; seek: [number]; record: []; guideVolume: [number]
}>()
</script>

<template>
  <section class="transport duet-transport" aria-label="导唱与录音控制">
    <div class="transport-controls">
      <button class="play-button" :aria-label="playing ? '暂停' : '播放导唱'" @click="emit('toggle')">
        <Pause v-if="playing" :size="19" fill="currentColor" /><Play v-else :size="19" fill="currentColor" />
      </button>
    </div>
    <div class="scrubber">
      <span class="mono">{{ clockLabel(position, true) }}</span>
      <input aria-label="练习进度" type="range" min="0" :max="exercise.duration" step="0.01" :value="position"
        :style="{ '--fill': `${100 * position / exercise.duration}%` }"
        @input="emit('seek', Number(($event.target as HTMLInputElement).value))" />
      <span class="mono subdued">{{ clockLabel(exercise.duration) }}</span>
    </div>
    <button class="loop-button" :class="{ enabled: loop }" :aria-pressed="loop" @click="emit('loop')">
      <Repeat2 :size="17" /> <span>接头循环</span>
    </button>
    <div class="volume-control">
      <button class="icon-button" :aria-label="guideVolume ? '静音对方导唱' : '恢复对方导唱'" @click="emit('guideVolume', guideVolume ? 0 : 0.65)">
        <Volume2 v-if="guideVolume" :size="18" /><VolumeX v-else :size="18" />
      </button>
      <input aria-label="对方导唱音量" type="range" min="0" max="1" step="0.01" :value="guideVolume"
        :style="{ '--fill': `${100 * guideVolume}%` }"
        @input="emit('guideVolume', Number(($event.target as HTMLInputElement).value))" />
    </div>
    <button class="record-button" :class="{ recording }" :disabled="processing" @click="emit('record')">
      <Square v-if="recording" :size="15" fill="currentColor" /><Mic v-else :size="16" />
      {{ recording ? '停止并判定' : processing ? '分析中' : '录这一接头' }}
    </button>
    <p v-if="issue" class="inline-error" role="alert">{{ issue }}</p>
  </section>
</template>
