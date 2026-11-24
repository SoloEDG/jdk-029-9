import type { CoverageLabel, EvidenceKind } from '../model/types'

export const KIND_LABEL: Record<EvidenceKind, string> = {
  mine: '确实有我',
  bleed: '主要是串音',
  unclear: '无法判断',
  quiet: '只有底噪',
}

export const KIND_SHORT: Record<EvidenceKind, string> = {
  mine: '我',
  bleed: '串音',
  unclear: '存疑',
  quiet: '静音',
}

export const KIND_HINT: Record<EvidenceKind, string> = {
  mine: '导唱扣除后仍有能量，且落在我这一声部的音高上',
  bleed: '电平和已知的对方导唱轨同步，扣掉后几乎没有剩下',
  unclear: '双方同音或证据互相抵消，单靠角色时段无法归属',
  quiet: '轮到我，但麦克风接近底噪，没有听到开口',
}

export const COVERAGE_LABEL: Record<CoverageLabel, string> = {
  early: '抢拍',
  scheduled: '按入口',
  reentry: '循环内重入',
  late: '拖尾',
}

export const COVERAGE_HINT: Record<CoverageLabel, string> = {
  early: '在入口之前已经唱出，原声保留，单独一行',
  scheduled: '落在写好的入口之内',
  reentry: '停过一段又进，另记一段覆盖',
  late: '越过句尾仍在唱',
}

export function seconds(value: number): string {
  return `${value.toFixed(2)}s`
}
