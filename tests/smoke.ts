// SSR smoke render: catches template/wiring errors without a browser.
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Workspace from '../src/app/Workspace.vue'
import SoloWorkspace from '../src/app/SoloWorkspace.vue'
import ReviewPlayer from '../src/features/duet/ui/ReviewPlayer.vue'
import TakeList from '../src/features/duet/ui/TakeList.vue'
import EvidenceCard from '../src/features/duet/ui/EvidenceCard.vue'
import { duetExercises } from '../src/features/duet/model/catalog'
import { buildDemoTakes } from '../src/features/duet/lib/demo'

;(globalThis as unknown as { Audio: unknown }).Audio = class {
  volume = 1; preload = ''; src = ''; currentTime = 0; paused = true; seeking = false; readyState = 4
  play() { return Promise.resolve() }
  pause() {}
  load() {}
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
}
;(globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
  sampleRate = 24000; currentTime = 0; state = 'running'
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
  createMediaStreamSource() { return { connect: () => ({ connect: () => ({ connect: () => undefined }) }) } }
}

export default async function run() {
  const checks: Record<string, boolean> = {}
  const html = await renderToString(createSSRApp(Workspace))
  checks['shell renders'] = html.length > 4000
  checks['duet vocabulary'] = ['双声部接唱', '双方词口同屏', '对方声部', '我唱低声部'].every(word => html.includes(word))
  checks['no raw placeholders'] = !html.includes('undefined') && !html.includes('[object Object]')

  const solo = await renderToString(createSSRApp(SoloWorkspace))
  checks['solo mode still renders'] = solo.includes('逐句歌词') && solo.includes('音高轨迹')

  const exercise = duetExercises[0]
  const takes = buildDemoTakes(exercise, 0.65, 1)
  for (const suffix of ['weak', 'strong', 'octave', 'early', 'reentry', 'unison']) {
    checks[`demo ${suffix} present`] = takes.some(take => take.id.endsWith(suffix))
  }
  const take = takes.find(entry => entry.id.endsWith('early'))!
  const line = exercise.lines.find(entry => entry.id === take.lineId)!

  const player = await renderToString(createSSRApp({
    render: () => h(ReviewPlayer, {
      take, exercise, mode: { guide: true }, guideVolume: 0.4,
      playing: false, playhead: take.start + 0.5, issue: '',
    }),
  }))
  checks['player renders evidence'] = player.includes('对照证据') && player.includes('原始录音不含任何处理')
  checks['old volume is labelled'] = player.includes('证据记录时的导唱音量') && player.includes('旧证据不随之改写')

  const card = await renderToString(createSSRApp({
    render: () => h(EvidenceCard, { take, exercise, line, playhead: null, liveGuideVolume: 0.9 }),
  }))
  checks['coverage rows exist'] = card.includes('实际覆盖') && card.includes('抢拍')
  checks['protocol text'] = card.includes('不按角色时段推断') && card.includes('一律标为无法判断')

  const list = await renderToString(createSSRApp({
    render: () => h(TakeList, {
      takes, exercise, selectedId: take.id, playingId: null, demoOn: true,
    }),
  }))
  checks['take list renders all demos'] = takes.every(entry => list.includes(entry.label!))

  const broken = await renderToString(createSSRApp({
    render: () => h(ReviewPlayer, {
      take: null, exercise, mode: { guide: true }, guideVolume: 0.4,
      playing: false, playhead: null, issue: '麦克风权限未开启。',
    }),
  }))
  checks['empty state and errors render'] = broken.includes('还没有这一接头的录音') && broken.includes('麦克风权限未开启')

  let failed = 0
  for (const [name, pass] of Object.entries(checks)) {
    console.log(pass ? 'ok  ' : 'FAIL', name)
    if (!pass) failed++
  }
  if (failed) throw new Error(`${failed} smoke checks failed`)
}
