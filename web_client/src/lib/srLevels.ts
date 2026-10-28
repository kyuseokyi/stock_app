// 차트 게임 지지·저항 목록 — 지표 5개(설계 2026-10-27 chart-game-sr-trendlines §8, 이전 §7 의 스윙 수평선 함수도 남겨 둠).
// 앱 features/game/lib/sr-levels.ts 와 같은 규칙.
import { roundToTick } from './krxTick'
import type { SrEventType } from './srWatch'
import type { IndicatorLevel } from './touchLevels'
import type { HLevel } from './trendLines'

/**
 * lvl:가격 = 스윙 수평선(§7), ind:지표 = 지표 레벨(§8). 어느 쪽이든 역할(저항↔지지)이 바뀌어도 키가 같아 감지기가 돌파를 놓치지 않는다.
 * 지표 값은 틱마다 조금 움직이지만 오차 안이면 같은 선으로 판정(sr-watch)
 */
export type SrKey = `lvl:${number}` | `ind:${string}`
export type SrRole = 'support' | 'resistance'

export interface SrLevel {
  key: SrKey
  price: number
  color: string
  role: SrRole
  /** 알림 문구 이름(지표 레벨만 — 예: 20일선). 없으면 역할 이름 */
  name?: string
}

/** 선 색은 역할로 고정(저항=주황, 지지=보라) */
export const TREND_HIGH_COLOR = '#f59e0b'
export const TREND_LOW_COLOR = '#8b5cf6'

/** 수평 레벨 → 지지·저항 목록(저항 먼저) */
export function srLevelsFromHorizontal(h: { resistance: HLevel | null; support: HLevel | null }): SrLevel[] {
  const out: SrLevel[] = []
  if (h.resistance !== null) out.push({ key: `lvl:${h.resistance.price}`, price: h.resistance.price, color: TREND_HIGH_COLOR, role: 'resistance' })
  if (h.support !== null) out.push({ key: `lvl:${h.support.price}`, price: h.support.price, color: TREND_LOW_COLOR, role: 'support' })
  return out
}

/** 감지용 — 후보 레벨 전체(그리는 2개와 별개). 키 lvl:가격, 가격 ≥ 현재가면 저항 */
export function srWatchLevels(candidates: HLevel[], lastPrice: number): SrLevel[] {
  return candidates.map((c) => {
    const resistance = c.price >= lastPrice
    return { key: `lvl:${c.price}` as SrKey, price: c.price, color: resistance ? TREND_HIGH_COLOR : TREND_LOW_COLOR, role: resistance ? 'resistance' : 'support' }
  })
}

/** 지표 레벨 → 지지·저항 목록(입력 순서). 키 ind:id(고정 가격 레벨은 lvl:가격), 가격 ≥ 현재가면 저항 */
export function srFromIndicators(levels: IndicatorLevel[], lastPrice: number): SrLevel[] {
  return levels.map((l) => {
    const resistance = l.price >= lastPrice
    const key: SrKey = l.byPrice === true ? `lvl:${l.price}` : `ind:${l.id}`
    return { key, price: l.price, color: resistance ? TREND_HIGH_COLOR : TREND_LOW_COLOR, role: resistance ? 'resistance' : 'support', name: l.name }
  })
}

/** 역할 이름 — 넓게: 저항선·지지선 / 좁게: 저항·지지 */
export function srRoleName(role: SrRole, short: boolean): string {
  if (role === 'resistance') return short ? '저항' : '저항선'
  return short ? '지지' : '지지선'
}

/** 이벤트 종류로 본 선 이름(RESISTANCE_* = 저항선, SUPPORT_* = 지지선) */
export function srEventName(type: SrEventType): string {
  return srRoleName(type.startsWith('RESISTANCE') ? 'resistance' : 'support', false)
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|')
}
