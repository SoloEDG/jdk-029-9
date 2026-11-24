<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, CircleAlert, Disc3, FileAudio } from '@lucide/vue'
import { duetExercises } from '../model/catalog'
import { useDuet } from '../model/useDuet'
import { useDuetCapture } from '../model/useDuetCapture'
import { useDuetReview } from '../model/useDuetReview'
import { jointFor } from '../lib/joint'
import { PREROLL } from '../model/constants'
import { autocorrelationPitch } from '../lib/dsp'
import type { DuetTake, RoleId } from '../model/types'
import DuetScore from './DuetScore.vue'
import DuetPitch from './DuetPitch.vue'
import DuetTransport from './DuetTransport.vue'
import ReviewPlayer from './ReviewPlayer.vue'
import TakeList from './TakeList.vue'

const duet = useDuet()
const review = useDuetReview(duet.exercise)
const issue = ref('')
const livePitch = ref<{ time: number; midi: number | null }[]>([])
const liveLabel = ref<string | null>(null)
const guideBuffer = ref<AudioBuffer | null>(null)

const exercise = duet.exercise
const line = duet.selected
const joint = computed(() => line.value ? jointFor(exercise.value, line.value) : null)
const otherRole = computed<RoleId>(() => duet.role.value === 'a' ? 'b' : 'a')

const capture = useDuetCapture({
  onFrame: (time, samples, rate) => {
    const pitch = autocorrelationPitch(samples, rate)
    livePitch.value = [...livePitch.value.slice(-180), { time, midi: pitch?.midi ?? null }]
    liveLabel.value = pitch ? noteLabel(pitch.midi) : liveLabel.value
  },
  preparePlayback: async () => {
    if (!line.value) return false
    // Always start the joint exactly PREROLL seconds early, so the clip has
    // room for an early (抢拍) entrance.
    duet.seek(Math.max(0, line.value.start - PREROLL))
    const ready = await duet.play()
    if (!ready) issue.value = duet.issue.value
    return ready
  },
  onComplete: async take => {
    await review.save(take)
  },
})

const graphRange = computed(() => {
  if (review.position.value !== null && review.selected.value) {
    return { start: review.selected.value.start, end: review.selected.value.end }
  }
  return joint.value?.window ?? { start: 0, end: exercise.value.duration }
})
const graphPosition = computed(() => review.position.value ?? duet.position.value)
const reviewedLine = computed(() => {
  const take = review.selected.value
  if (!take) return line.value
  return exercise.value.lines.find(entry => entry.id === take.lineId) ?? line.value
})
const isRecording = computed(() => capture.status.value === 'recording')
const isProcessing = computed(() => capture.status.value === 'processing' || capture.status.value === 'requesting')

function noteLabel(midi: number) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  const rounded = Math.round(midi)
  return names[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1)
}

async function decodeGuide() {
  try {
    const response = await fetch(exercise.value.tracks[otherRole.value])
    const data = await response.arrayBuffer()
    const context = new AudioContext()
    guideBuffer.value = await context.decodeAudioData(data)
    void context.close()
  } catch {
    // Without the known guide there is no way to separate bleed honestly; be
    // explicit rather than letting the take look clean.
    guideBuffer.value = null
    issue.value = '无法解码对方导唱轨，这一条只能保留原声，不能可靠判定。'
  }
}

watch([() => exercise.value.id, () => duet.role.value], () => { guideBuffer.value = null; void decodeGuide() }, { immediate: true })
watch(() => duet.selected.value?.id, () => {
  review.stop()
  livePitch.value = []
  liveLabel.value = null
})

// The review's guide overlay follows the live speaker volume.  It is only a
// playback mix: the evidence badge keeps reporting the volume it was frozen at.
watch(() => duet.guideVolume.value, value => review.setGuideVolume(value))
onMounted(() => review.setGuideVolume(duet.guideVolume.value))

// Stop the take automatically after the line, and also when a loop wrap jumps
// the playhead back (the clip would otherwise run into the next pass).
let lastPosition = 0
watch(() => duet.position.value, position => {
  const wrapped = position < lastPosition - 0.5
  lastPosition = position
  if (capture.status.value !== 'recording' || !line.value) return
  if (position >= line.value.end + 0.35 || wrapped) void toggleRecord()
})

function selectLine(id: string) {
  if (isRecording.value) return
  duet.select(id)
}

function setExercise(id: string) {
  const next = duetExercises.find(entry => entry.id === id)
  if (!next || isRecording.value) return
  review.stop()
  duet.setExercise(next)
}

async function toggleRecord() {
  if (capture.status.value === 'recording') {
    if (!line.value) return
    await capture.stop({
      exercise: exercise.value,
      line: line.value,
      role: duet.role.value,
      guideBuffer: guideBuffer.value,
      guideVolume: duet.guideVolume.value,
      read: () => duet.readPosition(),
    }, duet.readPosition())
    duet.pause()
    return
  }
  if (capture.status.value === 'requesting') { capture.cancel(); return }
  if (!line.value || capture.status.value !== 'idle') return
  review.stop()
  duet.pause()
  livePitch.value = []
  if (!guideBuffer.value) await decodeGuide()
  if (!guideBuffer.value) {
    issue.value = '缺少对方导唱轨，无法开始判定录音。请检查练习音频是否可读。'
    return
  }
  await capture.start({
    exercise: exercise.value,
    line: line.value,
    role: duet.role.value,
    guideBuffer: guideBuffer.value,
    guideVolume: duet.guideVolume.value,
    read: () => duet.readPosition(),
  })
}

function togglePlay() {
  if (isRecording.value) return
  review.stop()
  if (duet.playing.value) duet.pause()
  else void duet.play()
}

function seek(position: number) {
  if (isRecording.value) return
  review.stop()
  duet.seek(position)
}

function chooseTake(take: DuetTake) {
  if (isRecording.value) return
  review.stop()
  duet.pause()
  review.selectedId.value = take.id
  // Keep "我唱" as it is; move the shared playhead to this take's line.
  const entry = exercise.value.lines.find(item => item.id === take.lineId)
  if (entry && entry.id !== duet.selected.value?.id) duet.select(entry.id)
  duet.seek(take.start)
}

async function loadDemos() {
  review.stop()
  review.loadDemos()
  const sample = review.selected.value
  if (sample?.demo) chooseTake(sample)
}

function seekReview(position: number) {
  const take = review.selected.value
  if (!take) return
  // Restart the clip from the requested offset; the original audio is never
  // edited, this only moves the playhead.
  void review.listenFrom(take, position - take.start)
  duet.seek(position)
}

function chooseRange(piece: { start: number; end: number }) {
  const take = review.selected.value
  if (!take) return
  void review.listenFrom(take, piece.start - take.start)
}

onMounted(() => { document.addEventListener('visibilitychange', onVisibility) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))
function onVisibility() {
  if (!document.hidden) return
  if (capture.status.value === 'recording') void toggleRecord()
  duet.pause()
  review.stop()
}
</script>

<template>
  <div class="duet-workbench">
    <section class="duet-heading" aria-labelledby="duet-title">
      <div class="duet-selects">
        <label class="select-field">
          <span><Disc3 :size="14" /> 练习</span>
          <select :value="exercise.id" aria-label="选择双声部练习" :disabled="isRecording" @change="setExercise(($event.target as HTMLSelectElement).value)">
            <option v-for="entry in duetExercises" :key="entry.id" :value="entry.id">{{ entry.title }}</option>
          </select>
          <ChevronDown :size="14" class="select-caret" />
        </label>
        <div class="role-switch" role="group" aria-label="我唱哪个声部">
          <button v-for="id in (['a', 'b'] as const)" :key="id" :aria-pressed="duet.role.value === id"
            :disabled="isRecording" :class="{ chosen: duet.role.value === id }" @click="duet.setRole(id)">
            我唱{{ exercise.roles[id].label }}
          </button>
        </div>
      </div>
      <h1 id="duet-title">{{ exercise.title }}</h1>
      <p class="duet-sub">
        <span class="mono">{{ exercise.bpm }} BPM · {{ exercise.key }}</span>
        <span v-if="joint?.tailCrossesEntrance" class="joint-flag">
          <CircleAlert :size="13" /> 对方尾音越过入口 {{ joint.overlapSeconds.toFixed(2) }}s
        </span>
        <span v-else class="joint-flag calm">对方在入口前留白</span>
      </p>
    </section>

    <DuetScore :exercise="exercise" :role="duet.role.value" :selected="line" :position="duet.position.value" :guide-muted="duet.guideVolume.value === 0" @select="selectLine" />

    <DuetPitch :exercise="exercise" :line="reviewedLine!" :role="reviewedLine?.role ?? duet.role.value"
      :range="graphRange" :position="graphPosition"
      :my-pitch="review.selected.value?.pitch ?? []"
      :guide-pitch="review.selected.value?.guidePitch ?? []"
      :evidence="review.selected.value?.evidence.segments ?? []"
      :live="isRecording ? livePitch : []" :live-label="isRecording ? liveLabel : null" />

    <DuetTransport :exercise="exercise" :position="duet.position.value" :playing="duet.playing.value"
      :loop="duet.loop.value" :guide-volume="duet.guideVolume.value"
      :recording="capture.status.value === 'recording'" :processing="isProcessing"
      :issue="issue || duet.issue.value || capture.issue.value"
      @toggle="togglePlay" @loop="duet.toggleLoop" @seek="seek"
      @record="toggleRecord" @guide-volume="duet.setGuideVolume" />

    <div class="duet-columns">
      <ReviewPlayer :take="review.selected.value" :exercise="exercise" :mode="review.mode.value"
        :guide-volume="review.guideVolume.value" :playing="Boolean(review.playingId.value)"
        :playhead="review.position.value" :issue="review.issue.value"
        @listen="review.listen" @seek="seekReview" @range="chooseRange"
        @guide-volume="duet.setGuideVolume" @toggle-guide="review.toggleGuide" />
      <TakeList :takes="review.visible.value" :exercise="exercise" :selected-id="review.selected.value?.id ?? null"
        :playing-id="review.playingId.value" :demo-on="review.demo.value"
        @choose="chooseTake" @remove="review.forget" @demos="loadDemos" @clear-demos="review.clearDemos" />
    </div>

    <details class="duet-notes">
      <summary><FileAudio :size="14" /> 验证说明</summary>
      <p>
        验证样本由已知的两个声部合成：先后重叠的两条声部、不同强度的串音、循环内重入，
        以及只在另一个八度轻唱的试唱和双方同音的重叠。分析只使用麦克风与已知的对方导唱轨；
        角色时段从不单独作为判断依据。改变导唱音量只会影响复听时的叠加，不会改写已冻结的证据。
      </p>
    </details>
  </div>
</template>
