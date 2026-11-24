<script setup lang="ts">
import { Music2, MicVocal, Users } from '@lucide/vue'
import type { DuetExercise, DuetLine, RoleId } from '../model/types'

defineProps<{
  exercise: DuetExercise
  role: RoleId
  selected: DuetLine | null
  position: number
  guideMuted: boolean
}>()
const emit = defineEmits<{ select: [string] }>()

const otherOf = (role: RoleId): RoleId => role === 'a' ? 'b' : 'a'
</script>

<template>
  <section class="duet-score" aria-label="双声部歌词">
    <div class="score-head">
      <span><Music2 :size="16" /> 双方词口同屏</span>
      <span class="mono">{{ exercise.bpm }} BPM · {{ exercise.key }}</span>
    </div>
    <ol class="score-lines">
      <li v-for="line in exercise.lines" :key="line.id"
        :class="{ mine: line.role === role, other: line.role !== role, chosen: selected?.id === line.id,
          sounding: position >= line.start && position < line.end }">
        <button class="score-line" :aria-pressed="selected?.id === line.id" @click="emit('select', line.id)">
          <span class="score-role" :class="line.role">
            <MicVocal v-if="line.role === role" :size="13" />
            <Users v-else :size="13" />
            {{ line.role === role ? '我' : `对方 · ${exercise.roles[line.role].label}` }}
          </span>
          <span class="score-text">{{ line.text }}</span>
          <span class="score-window mono">{{ line.start.toFixed(2) }}–{{ line.end.toFixed(2) }}</span>
          <span class="score-tag mono">{{ line.role === role ? '接' : '导' }}</span>
        </button>
      </li>
    </ol>
    <p class="score-hint">
      对方声部 <span class="mono">{{ exercise.roles[otherOf(role)].label }} · {{ exercise.roles[otherOf(role)].range }}</span>
      在扬声器里播放<template v-if="guideMuted">（当前为 0，仍可回看旧证据）</template>；
      我唱 <span class="mono">{{ exercise.roles[role].label }} · {{ exercise.roles[role].range }}</span>。
      选句或开循环都会把重录锁在同一个接头上。
    </p>
  </section>
</template>
