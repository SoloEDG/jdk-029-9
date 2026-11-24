// Offline generator for the duet exercise material.
//
// Builds two public-domain practice guides (synthesised, no external assets):
//   public/media/duet/echo-a.wav / echo-b.wav  – "回声练习", 72 BPM
//   public/media/duet/braid-a.wav / braid-b.wav – "交叠练习", 60 BPM
//
// Each file is one role's part, mono 16-bit.  The player plays the *other*
// role's file through the speaker; the selected role is what the singer
// performs.  Keeping the two roles in separate files is what lets a listener
// mix the guide at any volume after a take, without touching the take itself.
//
// The generator also writes src/features/duet/model/duet-books.json, the only
// description of the exercises the app needs.  Nothing at runtime imports this
// script; it exists so the fixture can be rebuilt with:
//   node scripts/generate-duet-guides.mjs
//
// Both exercises deliberately contain:
//   * two parts that overlap, phrase after phrase,
//   * entrances crossed by the other part's tail,
//   * a region where both parts hold the same pitch.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const rate = 22050

const midiHz = midi => 440 * 2 ** ((midi - 69) / 12)

function speechGate(t, note) {
  const local = t - note.start
  const length = note.end - note.start
  if (local < 0 || local > length) return 0
  const attack = Math.min(1, local / 0.045)
  const release = Math.min(1, (length - local) / 0.09)
  const wobble = 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, local / 0.11))
  return Math.max(0, attack * release * wobble)
}

function renderPart(notes, { gain, timbre, duration }) {
  const buffer = new Float32Array(Math.ceil(duration * rate))
  for (const note of notes) {
    const first = Math.floor(note.start * rate)
    const last = Math.min(buffer.length, Math.ceil(note.end * rate))
    const frequency = midiHz(note.midi)
    for (let index = first; index < last; index++) {
      const t = index / rate
      const gate = speechGate(t, note)
      if (gate <= 0) continue
      const phase = 2 * Math.PI * frequency * t
      const fundamental = Math.sin(phase)
      const second = timbre.second * Math.sin(2 * phase + 0.4)
      const third = timbre.third * Math.sin(3 * phase + 0.9)
      buffer[index] += gain * gate * (fundamental + second + third)
    }
  }
  return buffer
}

function writeMonoWav(path, samples) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples.length * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    data.writeInt16LE(Math.round(value * 32767), 44 + index * 2)
  }
  writeFileSync(path, data)
}

const exercises = [
  {
    id: 'echo',
    title: '回声练习',
    bpm: 72,
    key: 'C 大调',
    duration: 16,
    cover: '/media/tide.jpg',
    leadIn: 2.4,
    roles: {
      a: { label: '低声部', range: 'C4–A4' },
      b: { label: '高声部', range: 'A4–D5' },
    },
    lines: [
      { id: 'echo-1', role: 'a', text: '风把回声留给你', start: 2.4, end: 6.4 },
      { id: 'echo-2', role: 'b', text: '我在下一句等你', start: 5.8, end: 9.8 },
      { id: 'echo-3', role: 'a', text: '尾音还没有落地', start: 9.6, end: 13.4 },
      { id: 'echo-4', role: 'b', text: '你先别急着换气', start: 11.4, end: 15.4 },
    ],
    parts: {
      a: [
        { start: 2.4, end: 3.2, midi: 64 },
        { start: 3.4, end: 4.1, midi: 67 },
        { start: 4.3, end: 6.2, midi: 69 },
        { start: 9.6, end: 10.4, midi: 67 },
        { start: 10.6, end: 11.4, midi: 69 },
        { start: 11.6, end: 12.8, midi: 69 },
      ],
      b: [
        { start: 5.8, end: 6.6, midi: 72 },
        { start: 6.8, end: 7.5, midi: 74 },
        { start: 7.7, end: 9.9, midi: 71 },
        { start: 11.4, end: 12.2, midi: 69 },
        { start: 12.4, end: 13.1, midi: 67 },
        { start: 13.3, end: 14.6, midi: 64 },
      ],
    },
  },
  {
    id: 'braid',
    title: '交叠练习',
    bpm: 60,
    key: 'D 小调',
    duration: 16,
    cover: '/media/dawn.jpg',
    leadIn: 2.4,
    roles: {
      a: { label: '低声部', range: 'B3–G4' },
      b: { label: '高声部', range: 'A4–C5' },
    },
    lines: [
      { id: 'braid-1', role: 'a', text: '先把第一声递出', start: 2.0, end: 6.0 },
      { id: 'braid-2', role: 'b', text: '尾音还没落你就进', start: 4.8, end: 9.0 },
      { id: 'braid-3', role: 'a', text: '交错着把话说完', start: 8.6, end: 12.6 },
      { id: 'braid-4', role: 'b', text: '留半拍给我收尾', start: 11.2, end: 15.2 },
    ],
    parts: {
      a: [
        { start: 2.0, end: 3.0, midi: 62 },
        { start: 3.2, end: 4.0, midi: 64 },
        { start: 4.2, end: 5.6, midi: 67 },
        { start: 8.6, end: 9.4, midi: 65 },
        { start: 9.6, end: 10.4, midi: 62 },
        { start: 10.6, end: 11.9, midi: 60 },
      ],
      b: [
        { start: 4.8, end: 5.6, midi: 72 },
        { start: 5.8, end: 6.6, midi: 69 },
        { start: 6.8, end: 8.9, midi: 67 },
        { start: 11.2, end: 12.0, midi: 60 },
        { start: 12.2, end: 13.0, midi: 64 },
        { start: 13.2, end: 14.5, midi: 67 },
      ],
    },
  },
]

const timbres = {
  a: { second: 0.2, third: 0.07 },
  b: { second: 0.24, third: 0.09 },
}
const gains = { a: 0.2, b: 0.18 }

const book = {
  generatedBy: 'scripts/generate-duet-guides.mjs',
  sampleRate: rate,
  exercises: exercises.map(exercise => ({
    id: exercise.id,
    title: exercise.title,
    bpm: exercise.bpm,
    key: exercise.key,
    duration: exercise.duration,
    cover: exercise.cover,
    leadIn: exercise.leadIn,
    roles: exercise.roles,
    tracks: {
      a: `/media/duet/${exercise.id}-a.wav`,
      b: `/media/duet/${exercise.id}-b.wav`,
    },
    lines: exercise.lines,
    parts: exercise.parts,
  })),
}

mkdirSync(resolve(root, 'public/media/duet'), { recursive: true })
mkdirSync(resolve(root, 'src/features/duet/model'), { recursive: true })

for (const exercise of exercises) {
  for (const role of ['a', 'b']) {
    const samples = renderPart(exercise.parts[role], {
      gain: gains[role], timbre: timbres[role], duration: exercise.duration,
    })
    writeMonoWav(resolve(root, 'public/media/duet', `${exercise.id}-${role}.wav`), samples)
  }
  console.log('built', exercise.id)
}

writeFileSync(
  resolve(root, 'src/features/duet/model/duet-books.json'),
  JSON.stringify(book, null, 2) + '\n',
)
console.log('wrote duet-books.json')
