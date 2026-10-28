// 부분 익절·원금 회수(설계 2026-10-28 §1·§3) — 버튼 노출 여부와 현재가 기준 미리보기. 화면 표시만, 실제 금액은 서버가 체결 가격으로 정한다.
// 앱 mobile/src/features/game/lib/partial-close.ts 와 같은 코드.
import type { GameRules } from '../types/game'

/** POST /positions/{id}/close 본문 portion — all 은 본문 없이 보낸다(옛 서버 호환) */
export type ClosePortion = 'all' | 'half' | 'principal'

export interface PartialClosePreview {
  /** ½ 절반 익절 — returned: 현금으로 돌아올 돈, remain: 남는 원금 */
  half: { returned: number; remain: number }
  /** 원금 회수 — returned: 돌아올 돈(≈ 지금 원금), remainValue: 남는 포지션 평가금(≈ 수익금). 남길 원금이 없으면 null */
  principal: { returned: number; remainValue: number } | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * size = 지금 원금(size_amount), pnl = 수수료 뺀 평가손익(pnl_amount). 수익 상태(pnl > 0)가 아니면 null.
 * 서버 식: g = 1 + roi/100, 절반 close = round(size/2, 0.01), 원금 회수 close = round(size/g, 0.01), remain = size − close.
 */
export function partialClosePreview(size: number, pnl: number): PartialClosePreview | null {
  if (!(size > 0) || !(pnl > 0)) return null
  const g = 1 + pnl / size
  const halfClose = round2(size / 2)
  const principalClose = round2(size / g)
  const principalRemain = size - principalClose
  return {
    half: { returned: halfClose * g, remain: size - halfClose },
    principal: principalRemain > 0 ? { returned: principalClose * g, remainValue: principalRemain * g } : null,
  }
}

/** 부분 청산 버튼 노출 — 서버가 partial_close 를 알릴 때(옛 서버는 본문을 무시하고 전량 청산) + 수익 상태일 때만 */
export function canPartialClose(rules: Pick<GameRules, 'partial_close'> | null, pnl: number | null): boolean {
  return rules?.partial_close === true && pnl !== null && pnl > 0
}
