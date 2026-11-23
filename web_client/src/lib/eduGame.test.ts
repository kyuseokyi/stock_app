import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import {
  actionSummary, eduErrorCode, eduErrorMessage, eduPanelMode, keepLevelsPreview, remainingText, settlementLabel,
  settlementPassed, shouldReloadAfterError, sortedCandles, stopTakePreview,
} from './eduGame'
import type { EduCandle } from '../types/eduGame'

const axiosErr = (status: number, data: unknown) =>
  new AxiosError('fail', 'ERR', { headers: new AxiosHeaders() }, null, {
    status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() },
  })

describe('eduPanelMode (의사결정 패널 3상태 + 비로그인)', () => {
  const pos = { position: { side: 'LONG' } } as never
  it('비로그인이면 login', () => {
    expect(eduPanelMode({ logged_in: false, today_submitted: false, account: null })).toBe('login')
  })
  it('오늘 제출했으면 보유 여부와 무관하게 submitted', () => {
    expect(eduPanelMode({ logged_in: true, today_submitted: true, account: pos })).toBe('submitted')
  })
  it('보유 중이면 holding, 계좌가 아직 없거나 포지션이 없으면 flat', () => {
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: pos })).toBe('holding')
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: null })).toBe('flat')
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: { position: null } as never })).toBe('flat')
  })
})

describe('stopTakePreview (서버 stop_take_prices 와 같은 식·호가 반올림)', () => {
  it('상승: 손절은 아래, 익절은 위', () => {
    expect(stopTakePreview('LONG', 50_000, 5, 10)).toEqual({ stop: 47_500, take: 55_000 })
  })
  it('하락: 손절은 위, 익절은 아래', () => {
    expect(stopTakePreview('SHORT', 50_000, 3, 5)).toEqual({ stop: 51_500, take: 47_500 })
  })
  it('호가 단위로 반올림(5만 원 미만 50원 단위)', () => {
    // 49,950 × 0.97 = 48,451.5 → 48,450 / 49,950 × 1.15 = 57,442.5 → 57,400(10만 원대 100원 단위)
    expect(stopTakePreview('LONG', 49_950, 3, 15)).toEqual({ stop: 48_450, take: 57_400 })
  })
})

describe('keepLevelsPreview (포지션 유지 시 손절·익절 재설정)', () => {
  const cur = { stop: 47_500, take: 55_000 }
  it('아무것도 바꾸지 않으면 지금 값 그대로·검사 없이 통과', () => {
    expect(keepLevelsPreview('LONG', 50_000, cur, 50_000, null, null)).toEqual({ ...cur, valid: true })
  })
  it('한쪽만 바꾸면 다른 쪽은 지금 값 유지', () => {
    expect(keepLevelsPreview('LONG', 50_000, cur, 50_000, 3, null)).toEqual({ stop: 48_500, take: 55_000, valid: true })
  })
  it('오늘 종가로 바로 체결되는 값이면 valid=false(서버 INVALID_LEVELS)', () => {
    // 진입 50,000·종가 48,000 → 손절 -3%(48,500)는 이미 종가 위
    expect(keepLevelsPreview('LONG', 50_000, cur, 48_000, 3, null).valid).toBe(false)
    // 하락: 종가 52,000 → 손절 +3%(51,500)는 이미 종가 아래
    expect(keepLevelsPreview('SHORT', 50_000, { stop: 53_500, take: 45_000 }, 52_000, 3, null).valid).toBe(false)
  })
})

describe('남은 시간·정산 시각', () => {
  const now = new Date('2026-11-23T10:00:00+09:00')
  it('시간·분·일 단위 문구', () => {
    expect(remainingText('2026-11-23T20:00:00+09:00', now)).toBe('10시간 0분 남음')
    expect(remainingText('2026-11-23T10:12:30+09:00', now)).toBe('12분 남음')
    expect(remainingText('2026-11-25T20:00:00+09:00', now)).toBe('2일 10시간 남음')
  })
  it('1분 이내·지남은 곧 정산, 없음·잘못된 값은 null', () => {
    expect(remainingText('2026-11-23T10:00:30+09:00', now)).toBe('곧 정산돼요')
    expect(remainingText('2026-11-23T09:00:00+09:00', now)).toBe('곧 정산돼요')
    expect(remainingText(null, now)).toBeNull()
    expect(remainingText('nope', now)).toBeNull()
  })
  it('정산 시각은 KST 로 표시', () => {
    expect(settlementLabel('2026-11-24T20:00:00+09:00')).toBe('11/24(화) 20:00')
    expect(settlementLabel('2026-11-24T11:00:00Z')).toBe('11/24(화) 20:00')
    expect(settlementLabel(null)).toBeNull()
  })
  it('정산 시각 + 1분 유예가 지나야 다시 묻는다', () => {
    expect(settlementPassed('2026-11-23T09:59:30+09:00', now)).toBe(false)
    expect(settlementPassed('2026-11-23T09:58:00+09:00', now)).toBe(true)
    expect(settlementPassed(null, now)).toBe(false)
  })
})

describe('actionSummary (제출한 결정 요약)', () => {
  const base = { ratio: null, leverage: 1, stop_loss_price: null, take_profit_price: null }
  it('진입은 비중·배율·손절/익절', () => {
    expect(actionSummary({ ...base, action_type: 'ENTER_LONG', ratio: 0.5, leverage: 2, stop_loss_price: 47_500, take_profit_price: 55_000 }))
      .toBe('📈 상승 진입 · 비중 50% · 2배 · 손절 47,500 / 익절 55,000')
  })
  it('1배는 배율 생략, 관망·전량 청산은 행동만', () => {
    expect(actionSummary({ ...base, action_type: 'ENTER_SHORT', ratio: 1, stop_loss_price: 51_500, take_profit_price: 47_500 }))
      .toBe('📉 하락 진입 · 비중 100% · 손절 51,500 / 익절 47,500')
    expect(actionSummary({ ...base, action_type: 'HOLD_WATCH' })).toBe('👀 오늘 관망')
    expect(actionSummary({ ...base, action_type: 'FULL_CLOSE', stop_loss_price: 1, take_profit_price: 2 })).toBe('🚪 전량 청산')
  })
  it('모르는 행동은 원문', () => {
    expect(actionSummary({ ...base, action_type: 'LIQUIDATED' })).toBe('LIQUIDATED')
  })
})

describe('sortedCandles', () => {
  const c = (date: string, close: number) => ({ date, close }) as EduCandle
  it('날짜 오름차순 + 같은 날짜는 마지막 값', () => {
    expect(sortedCandles([c('2026-11-03', 3), c('2026-11-01', 1), c('2026-11-03', 4)]).map((x) => x.close)).toEqual([1, 4])
  })
})

describe('서버 오류 → 문구·코드', () => {
  it('{detail:{code,message}} 는 서버 message 그대로', () => {
    const e = axiosErr(409, { detail: { code: 'ALREADY_PARTICIPATED_TODAY', message: '오늘은 이미 게임에 참가했어요.' } })
    expect(eduErrorMessage(e)).toBe('오늘은 이미 게임에 참가했어요.')
    expect(eduErrorCode(e)).toBe('ALREADY_PARTICIPATED_TODAY')
    expect(shouldReloadAfterError(eduErrorCode(e))).toBe(true)
  })
  it('꺼짐(문자열 detail)은 한국어 안내', () => {
    const e = axiosErr(403, { detail: 'edu_game_disabled' })
    expect(eduErrorMessage(e)).toBe('교육용 종가 게임이 지금은 닫혀 있어요.')
    expect(eduErrorCode(e)).toBeNull()
  })
  it('그 밖에는 기본 문구 + 진단 코드', () => {
    expect(eduErrorMessage(axiosErr(500, {}), '실패')).toMatch(/^실패 \(오류: HTTP 500/)
    expect(shouldReloadAfterError('INSUFFICIENT_CASH')).toBe(false)
    expect(shouldReloadAfterError('STALE_DAY')).toBe(true) // 새 종가 봉이 열림 — 잠그지 않고 state 갱신
  })
})
