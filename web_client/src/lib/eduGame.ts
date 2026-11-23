import axios from 'axios'
import { withErrorCode } from './errorCode'
import { formatPrice } from './format'
import { roundToTick } from './krxTick'
import type { EduAction, EduActionType, EduCandle, EduSide, EduState } from '../types/eduGame'

// 교육용 합성 종가 게임 표시 규칙 — 순수 함수(vitest). 서버 계산(edu_game_service)과 같은 규칙만 미리보기로 흉내 낸다.

/** 의사결정 패널 상태 — 비로그인 / 오늘 제출 완료 / 보유 중 / 미보유 */
export type EduPanelMode = 'login' | 'submitted' | 'holding' | 'flat'

export function eduPanelMode(state: Pick<EduState, 'logged_in' | 'today_submitted' | 'account'>): EduPanelMode {
  if (!state.logged_in) return 'login'
  if (state.today_submitted) return 'submitted'
  // 로그인했어도 첫 제출 전에는 계좌가 없다(account=null) — 미보유로 본다
  return state.account?.position ? 'holding' : 'flat'
}

/** 진입가 기준 손절·익절 예상가(호가 단위 반올림) — 서버 stop_take_prices 와 같은 식 */
export function stopTakePreview(side: EduSide, entry: number, slPct: number, tpPct: number): { stop: number; take: number } {
  if (side === 'LONG') {
    return { stop: roundToTick(entry * (1 - slPct / 100)), take: roundToTick(entry * (1 + tpPct / 100)) }
  }
  return { stop: roundToTick(entry * (1 + slPct / 100)), take: roundToTick(entry * (1 - tpPct / 100)) }
}

/**
 * 포지션 유지(KEEP_POS) 때 손절·익절 재설정 미리보기. 고르지 않은 쪽(null)은 지금 값 그대로.
 * valid=false 면 오늘 종가 기준으로 바로 체결되는 값(서버 INVALID_LEVELS) — 제출 버튼을 막는다.
 */
export function keepLevelsPreview(
  side: EduSide,
  entry: number,
  current: { stop: number | null; take: number | null },
  close: number,
  slPct: number | null,
  tpPct: number | null,
): { stop: number | null; take: number | null; valid: boolean } {
  const stop = slPct === null ? current.stop : stopTakePreview(side, entry, slPct, 5).stop
  const take = tpPct === null ? current.take : stopTakePreview(side, entry, 3, tpPct).take
  if (slPct === null && tpPct === null) return { stop, take, valid: true } // 바꾸지 않으면 검사 없음(서버와 같음)
  if (stop === null || take === null) return { stop, take, valid: false }
  const valid = side === 'LONG' ? stop < close && close < take : take < close && close < stop
  return { stop, take, valid }
}

const MIN_MS = 60_000

/** 다음 정산까지 남은 시간 문구 — '2시간 5분 남음' / '12분 남음' / '곧 정산돼요'. 시각이 없으면 null */
export function remainingText(nextIso: string | null | undefined, now: Date = new Date()): string | null {
  if (!nextIso) return null
  const at = new Date(nextIso).getTime()
  if (Number.isNaN(at)) return null
  const diff = at - now.getTime()
  if (diff <= MIN_MS) return '곧 정산돼요'
  const totalMin = Math.floor(diff / MIN_MS)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}일 ${h}시간 남음`
  if (h > 0) return `${h}시간 ${m}분 남음`
  return `${m}분 남음`
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const KST_OFFSET_MS = 9 * 3_600_000

/** 정산 시각 표시 — '11/24(화) 20:00'(KST). 시각이 없거나 잘못되면 null */
export function settlementLabel(nextIso: string | null | undefined): string | null {
  if (!nextIso) return null
  const t = new Date(nextIso).getTime()
  if (Number.isNaN(t)) return null
  const k = new Date(t + KST_OFFSET_MS)
  const hh = String(k.getUTCHours()).padStart(2, '0')
  const mm = String(k.getUTCMinutes()).padStart(2, '0')
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${WEEKDAY[k.getUTCDay()]}) ${hh}:${mm}`
}

/** 정산 시각이 지났는지(지나고 grace 만큼 더 기다린 뒤 state 를 다시 묻는다 — 서버 정산이 끝날 시간) */
export function settlementPassed(nextIso: string | null | undefined, now: Date = new Date(), graceMs = 60_000): boolean {
  if (!nextIso) return false
  const t = new Date(nextIso).getTime()
  return !Number.isNaN(t) && now.getTime() >= t + graceMs
}

export const ACTION_LABEL: Record<EduActionType, string> = {
  ENTER_LONG: '📈 상승 진입',
  ENTER_SHORT: '📉 하락 진입',
  HOLD_WATCH: '👀 오늘 관망',
  KEEP_POS: '🔒 포지션 유지',
  PARTIAL_CLOSE: '💰 50% 부분 청산',
  FULL_CLOSE: '🚪 전량 청산',
}

export function actionLabel(type: string): string {
  return (ACTION_LABEL as Record<string, string>)[type] ?? type
}

/** 제출한 결정 한 줄 요약 — '📈 상승 진입 · 비중 50% · 2배 · 손절 47,500 / 익절 55,000' */
export function actionSummary(a: Pick<EduAction, 'action_type' | 'ratio' | 'leverage' | 'stop_loss_price' | 'take_profit_price'>): string {
  const parts = [actionLabel(a.action_type)]
  const entering = a.action_type === 'ENTER_LONG' || a.action_type === 'ENTER_SHORT'
  if (entering && a.ratio !== null) parts.push(`비중 ${Math.round(a.ratio * 100)}%`)
  if (entering && a.leverage > 1) parts.push(`${a.leverage}배`)
  if (a.action_type !== 'HOLD_WATCH' && a.action_type !== 'FULL_CLOSE' && (a.stop_loss_price !== null || a.take_profit_price !== null)) {
    const sl = a.stop_loss_price === null ? '-' : formatPrice(a.stop_loss_price)
    const tp = a.take_profit_price === null ? '-' : formatPrice(a.take_profit_price)
    parts.push(`손절 ${sl} / 익절 ${tp}`)
  }
  return parts.join(' · ')
}

export const sideLabel = (side: string | null | undefined): string =>
  side === 'LONG' ? '상승' : side === 'SHORT' ? '하락' : '없음'

/** 캔들 날짜 오름차순 + 같은 날짜 중복 제거(차트 라이브러리는 엄격 오름차순 요구) */
export function sortedCandles(rows: readonly EduCandle[]): EduCandle[] {
  const byDate = new Map<string, EduCandle>()
  for (const c of rows) byDate.set(c.date, c)
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** 서버 오류 → 화면 문구. {detail:{code,message}} 는 message 그대로, 꺼짐('edu_game_disabled')은 안내, 나머지는 진단 코드 */
export function eduErrorMessage(err: unknown, fallback = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'): string {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown } | undefined)?.detail
    if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
      return (detail as { message: string }).message
    }
    if (detail === 'edu_game_disabled') return '교육용 종가 게임이 지금은 닫혀 있어요.'
    if (typeof detail === 'string' && /[가-힣]/.test(detail)) return detail
  }
  return withErrorCode(fallback, err)
}

/** 서버 오류 코드({detail:{code}}) — 없으면 null */
export function eduErrorCode(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null
  const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail
  if (detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string') {
    return (detail as { code: string }).code
  }
  return null
}

/** 제출 실패 뒤 state 를 다시 받아야 하는 오류(이미 참가·상태 불일치·시즌 바뀜·새 종가 봉 열림 STALE_DAY) */
export function shouldReloadAfterError(code: string | null): boolean {
  return code === 'STALE_DAY' || code === 'ALREADY_PARTICIPATED_TODAY' || code === 'ACTION_NOT_ALLOWED' || code === 'SEASON_CONFLICT' || code === 'NO_ACTIVE_SEASON'
}

/** 비율(0.25) → '25%' */
export const ratioLabel = (r: number): string => `${Math.round(r * 100)}%`
