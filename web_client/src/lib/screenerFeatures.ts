import type { ScreenerFeatures } from '../api/screenerFeatures'

// 관리자 스위치 → 스크리너 '종목 찾기'(주도주·조건검색·패턴) 노출 판정. 순수 함수(vitest 로 검사).
// features === null 은 "아직 답을 못 받음"(로딩) — 메뉴는 숨기고, 라우트는 아무것도 그리지 않고 기다린다.

export type StockTab = 'leaders' | 'finder' | 'patterns'

/** 종목 찾기 탭을 보일지 — STOCK_FINDER 가 꺼지면 모두 숨김, 켜지면 주도주는 항상·조건검색·패턴은 각자 스위치대로 */
export function stockTabVisible(features: ScreenerFeatures | null, tab: StockTab): boolean {
  if (features?.stockFinder !== true) return false
  if (tab === 'finder') return features.finder === true
  if (tab === 'patterns') return features.patterns === true
  return true
}

/** 주소로 바로 들어왔을 때 — 'wait'(답 기다림) · 'ok' · 보낼 주소(종목 찾기 전체가 꺼졌으면 시장 개요, 탭만 꺼졌으면 주도주) */
export function stockTabGate(features: ScreenerFeatures | null, tab: StockTab): 'wait' | 'ok' | '/screener/market' | '/screener/leaders' {
  if (features === null) return 'wait'
  if (stockTabVisible(features, tab)) return 'ok'
  return features.stockFinder ? '/screener/leaders' : '/screener/market'
}
