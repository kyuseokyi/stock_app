import type { ScreenerFeatures } from './api';

// 관리자 스위치 → 스크리너(종목 찾기) 노출 판정. RN 의존 없는 순수 함수(jest 로 검사).
// features === null 은 "아직 답을 못 받음"(로딩) — 탭은 숨기고, 화면은 리다이렉트 없이 기다린다.

export type ScreenerTab = 'leaders' | 'finder' | 'patterns';

/** 하단 탭에 스크리너를 보일지 — STOCK_FINDER 가 확실히 켜졌을 때만(로딩·오류는 숨김 쪽이 안전) */
export function screenerTabVisible(features: ScreenerFeatures | null): boolean {
  return features?.stockFinder === true;
}

/** 스크리너 화면 안의 칩 — STOCK_FINDER 가 켜져 있으면 주도주는 항상, 조건검색·패턴은 각자 스위치대로 */
export function screenerChipVisible(features: ScreenerFeatures | null, tab: ScreenerTab): boolean {
  if (!screenerTabVisible(features)) return false;
  if (tab === 'finder') return features?.finder === true;
  if (tab === 'patterns') return features?.patterns === true;
  return true;
}

/** /screener 로 직접 들어왔을 때 — 'wait'(답 기다림) · 'redirect'(시황으로) · 'show' */
export function screenerEntry(features: ScreenerFeatures | null): 'wait' | 'redirect' | 'show' {
  if (features === null) return 'wait';
  return screenerTabVisible(features) ? 'show' : 'redirect';
}

/** 종목 상세에서 돌아갈 곳(스택이 비었을 때) — 스크리너가 숨겨져 있으면(로딩 포함) 시황 탭 */
export function stockBackHref(features: ScreenerFeatures | null): '/screener' | '/market' {
  return screenerTabVisible(features) ? '/screener' : '/market';
}
