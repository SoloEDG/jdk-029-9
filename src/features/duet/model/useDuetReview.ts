import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from 'vue'
import type { DuetExercise, DuetTake, RoleId } from './types'
import { deleteDuetTake, readDuetTakes, writeDuetTake } from '../lib/archive'
import { buildDemoTakes, type SynthTake } from '../lib/demo'

export interface ReviewMode {
  /** Mix the known guide under the clip at the *current* live volume. */
  guide: boolean
}

/**
 * Review model: which take is loaded, which one is audible, and how the guide
 * is mixed on top of a historical clip.
 *
 * Two things are kept strictly apart:
 *   * the take's own audio + frozen evidence (never touched by volume changes),
 *   * a live guide playback layer, mixed at the volume slider's *current* value.
 * The evidence badge always reports the volume the judgement was made at.
 */
export function useDuetReview(exercise: Ref<DuetExercise>) {
  const takes = shallowRef<DuetTake[]>([])
  const selectedId = ref<string | null>(null)
  const playingId = ref<string | null>(null)
  const position = ref<number | null>(null)
  const issue = ref('')
  const loading = ref(false)
  const demo = ref(false)
  const guideVolume = ref(0.65)
  const mode = ref<ReviewMode>({ guide: true })
  const player = new Audio()
  const guideAudio = new Audio()
  let source: string | null = null
  let current: DuetTake | null = null
  let frame = 0

  const visible = computed(() => takes.value
    .filter(take => take.exerciseId === exercise.value.id)
    .sort((left, right) => right.createdAt - left.createdAt))
  const selected = computed(() => visible.value.find(take => take.id === selectedId.value) ?? visible.value[0] ?? null)

  function stop() {
    player.pause()
    guideAudio.pause()
    cancelAnimationFrame(frame)
    if (source) {
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(source)
      source = null
    }
    current = null
    playingId.value = null
    position.value = null
    // The mixed guide layer is disposable: it is re-armed from the take's own
    // start time whenever playback begins, at whatever volume is current then.
    if (guideAudio.src) {
      guideAudio.removeAttribute('src')
      guideAudio.load()
    }
  }

  function tick() {
    if (!current || player.paused) return
    position.value = Math.min(current.end, current.start + player.currentTime)
    frame = requestAnimationFrame(tick)
  }

  /** Point the guide layer at the other role's track at the right offset. */
  async function armGuide(take: DuetTake, offset = 0) {
    const otherRole: RoleId = take.role === 'a' ? 'b' : 'a'
    const wanted = new URL(exercise.value.tracks[otherRole], location.href).href
    if (guideAudio.src !== wanted) {
      guideAudio.src = exercise.value.tracks[otherRole]
      await once(guideAudio, 'loadedmetadata')
    }
    guideAudio.currentTime = take.start + offset
    guideAudio.volume = mode.value.guide ? guideVolume.value : 0
  }

  async function once(audio: HTMLAudioElement, event: string) {
    if (audio.readyState >= 1) return
    await new Promise<void>(resolve => {
      const done = () => { audio.removeEventListener(event, done); resolve() }
      audio.addEventListener(event, done)
      window.setTimeout(done, 800)
    })
  }

  /** Restart the current take from an absolute song time (evidence clicks). */
  async function listenFrom(take: DuetTake, offset: number) {
    await startAt(take, offset)
  }

  async function listen(take: DuetTake) {
    const replay = playingId.value !== take.id
    stop()
    selectedId.value = take.id
    if (!replay) return
    await startAt(take, 0)
  }

  /** Start (or restart) the selected take at an offset from its own start. */
  async function startAt(take: DuetTake, offset: number) {
    stop()
    selectedId.value = take.id
    const clamped = Math.max(0, Math.min(take.end - take.start - 0.05, offset))
    issue.value = ''
    current = take
    playingId.value = take.id
    position.value = take.start + clamped
    source = URL.createObjectURL(take.audio)
    const own = source
    player.src = source
    await once(player, 'loadedmetadata')
    if (source !== own) return
    player.currentTime = clamped
    await armGuide(take, clamped)
    if (source !== own) return
    try {
      await player.play()
      if (source !== own) return
      if (mode.value.guide) void guideAudio.play().catch(() => undefined)
      tick()
    } catch {
      if (source !== own) return
      stop()
      issue.value = '无法播放这条录音。'
    }
  }

  function setGuideVolume(value: number) {
    guideVolume.value = Math.min(1, Math.max(0, value))
    if (mode.value.guide && playingId.value) guideAudio.volume = guideVolume.value
  }

  /** Volume the currently selected take was judged at (frozen with its evidence). */
  const judgedVolume = computed(() => selected.value?.evidence.recordedGuideVolume ?? null)

  function toggleGuide() {
    mode.value = { ...mode.value, guide: !mode.value.guide }
    if (!mode.value.guide) guideAudio.pause()
    else if (playingId.value && !player.paused) {
      guideAudio.volume = guideVolume.value
      guideAudio.currentTime = (position.value ?? 0)
      void guideAudio.play().catch(() => undefined)
    }
  }

  async function load(demoToo = demo.value) {
    loading.value = true
    try {
      const stored = await readDuetTakes()
      takes.value = stored
    } catch {
      issue.value = '无法读取本机练习记录。'
    } finally {
      loading.value = false
    }
    if (demoToo) loadDemos()
  }

  function loadDemos() {
    demo.value = true
    // Replace old samples so a regenerated set records the *current* guide
    // volume; real takes are never touched.
    const real = takes.value.filter(take => !take.demo)
    const samples: SynthTake[] = buildDemoTakes(exercise.value, guideVolume.value)
    takes.value = [...samples, ...real]
    const first = samples[0]
    if (first) selectedId.value = first.id
  }

  function clearDemos() {
    demo.value = false
    takes.value = takes.value.filter(take => !take.demo)
  }

  async function save(take: DuetTake) {
    selectedId.value = take.id
    await writeDuetTake(take)
    takes.value = [take, ...takes.value.filter(item => item.id !== take.id)]
  }

  function forget(id: string) {
    const take = takes.value.find(item => item.id === id)
    if (selectedId.value === id) stop()
    takes.value = takes.value.filter(item => item.id !== id)
    if (selectedId.value === id) selectedId.value = null
    if (take && !take.demo) void deleteDuetTake(id).catch(() => undefined)
  }

  onMounted(() => { void load(false) })
  player.addEventListener('ended', stop)
  player.addEventListener('error', () => { stop(); issue.value = '这条录音无法播放。' })
  onBeforeUnmount(() => {
    player.removeEventListener('ended', stop)
    guideAudio.pause()
    stop()
  })

  return {
    takes, visible, selected, selectedId, playingId, position, issue, loading, demo, mode,
    guideVolume, judgedVolume, listen, listenFrom, stop, setGuideVolume, toggleGuide,
    load, loadDemos, clearDemos, save, forget,
  }
}
