<script setup lang="ts">
import { AudioLines, MicVocal, Music4 } from '@lucide/vue'
import { ref } from 'vue'
import SoloWorkspace from './SoloWorkspace.vue'
import { DuetWorkbench } from '../features/duet'

type Mode = 'duet' | 'solo'
const mode = ref<Mode>('duet')
</script>

<template>
  <header class="app-header">
    <div class="app-header-inner">
      <span class="brand-mark"><AudioLines :size="22" :stroke-width="2.1" /></span>
      <div class="brand-name"><strong>夜航练习室</strong><span>NIGHT SESSION</span></div>
      <nav class="mode-switch" aria-label="练习模式">
        <button :class="{ chosen: mode === 'duet' }" :aria-pressed="mode === 'duet'" @click="mode = 'duet'">
          <MicVocal :size="16" /> 双声部接唱
        </button>
        <button :class="{ chosen: mode === 'solo' }" :aria-pressed="mode === 'solo'" @click="mode = 'solo'">
          <Music4 :size="16" /> 单声部跟唱
        </button>
      </nav>
    </div>
  </header>
  <DuetWorkbench v-if="mode === 'duet'" />
  <SoloWorkspace v-else />
</template>
