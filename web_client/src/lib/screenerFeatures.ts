import type { ScreenerFeatures } from '../api/screenerFeatures'

// 관리자 스위치 → 스크리너(주도주·조건검색·패턴) 노출 판정. 순수 함수(vitest 로 검사).
// features === null 은 "아직 답을 못 받음"(로딩) — 메뉴는 숨기고, 라우트는 아무것도 그리지 않고 기다린다.

export type StockTab = 'leaders' | 'finder' | 'patterns'

/** 상단 스크리너 메뉴를 보일지 — 종목 찾기 스위치가 확실히 켜졌을 때만(꺼짐·로딩·오류는 숨김) */
export function screenerMenuVisible(features: ScreenerFeatures | null): boolean {
  return features?.stockFinder === true
}

/** 스크리너 탭을 보일지 — STOCK_FINDER 가 꺼지면 모두 숨김, 켜지면 주도주는 항상·조건검색·패턴은 각자 스위치대로 */
export function stockTabVisible(features: ScreenerFeatures | null, tab: StockTab): boolean {
  if (!screenerMenuVisible(features)) return false
  if (tab === 'finder') return features?.finder === true
  if (tab === 'patterns') return features?.patterns === true
  return true
}

/** 주소로 바로 들어왔을 때 — 'wait'(답 기다림) · 'ok' · 보낼 주소(스크리너 전체가 꺼졌으면 마켓, 탭만 꺼졌으면 주도주) */
export function stockTabGate(features: ScreenerFeatures | null, tab: StockTab): 'wait' | 'ok' | '/market' | '/screener/leaders' {
  if (features === null) return 'wait'
  if (stockTabVisible(features, tab)) return 'ok'
  return features.stockFinder ? '/screener/leaders' : '/market'
}

/** 종목 상세를 직접 열어 뒤로 갈 곳이 없을 때 — 스크리너가 보일 때만 스크리너, 그 밖(로딩·오류 포함)은 마켓 */
export function stockBackPath(features: ScreenerFeatures | null): '/screener' | '/market' {
  return screenerMenuVisible(features) ? '/screener' : '/market'
}
