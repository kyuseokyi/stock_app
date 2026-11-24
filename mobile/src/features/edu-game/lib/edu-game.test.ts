import type { EduAction, EduCandle } from '../types';
import {
  actionSummary,
  crowdVisible,
  eduChartRows,
  eduErrorInfo,
  eduPanelMode,
  eduRoundTick,
  entryAmount,
  keepPreview,
  remainingText,
  settleClock,
  statusChipLabel,
  stopTakePreview,
} from './edu-game';

const pos = { side: 'LONG' as const, entry_price: 50_000, size_amount: 1, leverage: 1, stop_loss_price: 47_500, take_profit_price: 55_000, opened_day_index: 1, unrealized_pnl: 0, roi_pct: 0 };
const account = (position: typeof pos | null) => ({
  cash_balance: 0, bonus_cash: 0, total_asset: 0, current_roi: 0, max_roi: 0, total_trades: 0, win_trades: 0,
  participation_days: 0, last_action_day_index: null, position,
});

describe('eduPanelMode — 상태별 패널', () => {
  it('비로그인 → guest(제출 여부와 무관)', () => {
    expect(eduPanelMode({ logged_in: false, today_submitted: true, account: null })).toBe('guest');
  });
  it('오늘 제출 완료 → submitted(보유 중이어도)', () => {
    expect(eduPanelMode({ logged_in: true, today_submitted: true, account: account(pos) })).toBe('submitted');
  });
  it('보유 중 → holding, 미보유·계좌 없음 → flat', () => {
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: account(pos) })).toBe('holding');
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: account(null) })).toBe('flat');
    expect(eduPanelMode({ logged_in: true, today_submitted: false, account: null })).toBe('flat');
  });
  it('참여자 비율은 제출 뒤·비로그인만 공개', () => {
    expect(crowdVisible('submitted')).toBe(true);
    expect(crowdVisible('guest')).toBe(true);
    expect(crowdVisible('flat')).toBe(false);
    expect(crowdVisible('holding')).toBe(false);
  });
});

describe('손절·익절 미리보기 — 서버 stop_take_prices·round_tick 과 같은 값', () => {
  it('호가 단위 반올림(0.5 올림, 최소 1틱)', () => {
    expect(eduRoundTick(47_520)).toBe(47_500); // 50 단위
    expect(eduRoundTick(47_525)).toBe(47_550);
    expect(eduRoundTick(52_549)).toBe(52_500); // 100 단위
    expect(eduRoundTick(52_550)).toBe(52_600);
    expect(eduRoundTick(0)).toBe(1);
    expect(eduRoundTick(-5)).toBe(1);
  });
  it('상승: 손절 아래·익절 위', () => {
    expect(stopTakePreview('LONG', 50_000, 5, 10)).toEqual({ stopLoss: 47_500, takeProfit: 55_000 });
    expect(stopTakePreview('LONG', 50_000, 3, 15)).toEqual({ stopLoss: 48_500, takeProfit: 57_500 });
  });
  it('하락: 손절 위·익절 아래', () => {
    expect(stopTakePreview('SHORT', 50_000, 5, 10)).toEqual({ stopLoss: 52_500, takeProfit: 45_000 });
  });
  it('부동소수 오차가 있어도 같은 틱(50,300 × 0.93)', () => {
    // 50300*0.93 = 46779 → 50 단위 → 46,800
    expect(stopTakePreview('LONG', 50_300, 7, 5).stopLoss).toBe(46_800);
  });
  it('유지 재설정: null 은 지금 값 그대로, 오늘 종가에 바로 닿으면 invalid', () => {
    expect(keepPreview(pos, 50_000, null, null)).toEqual({ stopLoss: 47_500, takeProfit: 55_000, valid: true });
    expect(keepPreview(pos, 50_000, 3, null)).toEqual({ stopLoss: 48_500, takeProfit: 55_000, valid: true });
    // 종가가 이미 52,000 → 새 익절 +5%(52,500) 는 괜찮고, 종가 56,000 이면 익절 55,000 에 이미 닿음
    expect(keepPreview(pos, 52_000, null, 5).valid).toBe(true);
    expect(keepPreview(pos, 56_000, null, 10).valid).toBe(false);
    expect(keepPreview({ ...pos, side: 'SHORT', stop_loss_price: 52_500, take_profit_price: 45_000 }, 53_000, 3, null).valid).toBe(false);
  });
  it('진입 금액 = 현금 × 비중(원 미만 버림)', () => {
    expect(entryAmount(10_000_000, 0.25)).toBe(2_500_000);
    expect(entryAmount(1_234.56, 0.5)).toBe(617);
  });
});

describe('남은 시간·정산 시각 문구', () => {
  const at = '2026-11-23T20:00:00+09:00';
  const ms = Date.parse(at);
  it('시간·분', () => {
    expect(remainingText(at, ms - (3 * 60 + 12) * 60_000)).toBe('다음 정산까지 3시간 12분');
    expect(remainingText(at, ms - 2 * 3_600_000)).toBe('다음 정산까지 2시간');
    expect(remainingText(at, ms - 59_000)).toBe('다음 정산까지 1분');
  });
  it('하루 이상(주말)', () => {
    expect(remainingText(at, ms - (2 * 1440 + 5 * 60) * 60_000)).toBe('다음 정산까지 2일 5시간');
  });
  it('지났거나 없음', () => {
    expect(remainingText(at, ms + 1)).toBe('곧 새 종가 캔들이 열려요');
    expect(remainingText(null, ms)).toBe('다음 정산 시각을 확인하고 있어요');
    expect(remainingText('잘못된 값', ms)).toBe('다음 정산 시각을 확인하고 있어요');
  });
  it('정산 시각은 기기 시간대와 무관하게 KST', () => {
    expect(settleClock(at)).toBe('11/23 20:00');
    expect(settleClock('2026-11-23T11:00:00Z')).toBe('11/23 20:00');
    expect(settleClock(null)).toBeNull();
  });
  it('상태 칩', () => {
    expect(statusChipLabel('flat', at)).toBe('오늘 참가 가능 🟢');
    expect(statusChipLabel('holding', at)).toBe('오늘 참가 가능 🟢');
    expect(statusChipLabel('submitted', at)).toBe('오늘 참가 완료 ✅ (20:00 정산)');
    expect(statusChipLabel('submitted', null)).toBe('오늘 참가 완료 ✅');
    expect(statusChipLabel('guest', at)).toBe('로그인하고 참가');
  });
});

describe('오늘 결정 요약', () => {
  const base: EduAction = {
    day_index: 3, action_date: '2026-11-23', action_type: 'ENTER_LONG', side: 'LONG', ratio: 0.5, leverage: 2,
    stop_loss_price: 47_500, take_profit_price: 55_000, execution_price: 50_000, realized_pnl: null, settlement_note: null,
  };
  it('진입', () => {
    expect(actionSummary(base)).toBe('상승 · 비중 50% · 2배 · 50,000원 · 손절 47,500 / 익절 55,000');
    expect(actionSummary({ ...base, action_type: 'ENTER_SHORT' })).toContain('하락');
  });
  it('관망·유지·청산', () => {
    expect(actionSummary({ ...base, action_type: 'HOLD_WATCH', stop_loss_price: null, take_profit_price: null })).toBe('홀드');
    expect(actionSummary({ ...base, action_type: 'KEEP_POS' })).toBe('포지션 유지 · 손절 47,500 / 익절 55,000');
    expect(actionSummary({ ...base, action_type: 'PARTIAL_CLOSE', realized_pnl: 12_345 })).toBe('50% 부분 청산 · 50,000원 · 실현 +12,345원');
    expect(actionSummary({ ...base, action_type: 'FULL_CLOSE', realized_pnl: -500 })).toBe('전량 청산 · 50,000원 · 실현 -500원');
  });
});

describe('오류 → 화면 문구', () => {
  it('서버 detail.message 를 그대로, 409 는 상태 재조회', () => {
    const e = { status: 409, body: { detail: { code: 'ALREADY_PARTICIPATED_TODAY', message: '오늘은 이미 게임에 참가했어요.' } } };
    expect(eduErrorInfo(e)).toEqual({ message: '오늘은 이미 게임에 참가했어요.', disabled: false, stale: true, unauthorized: false });
  });
  it('STALE_DAY(새 캔들 열림)도 메시지 그대로 + 재조회', () => {
    const e = { status: 409, body: { detail: { code: 'STALE_DAY', message: '새 종가 캔들이 열렸어요.' } } };
    expect(eduErrorInfo(e)).toMatchObject({ message: '새 종가 캔들이 열렸어요.', stale: true });
  });
  it('400 검증 오류는 메시지만(재조회 없음)', () => {
    const e = { status: 400, body: { detail: { code: 'INVALID_LEVELS', message: '다른 폭을 골라 주세요.' } } };
    expect(eduErrorInfo(e)).toMatchObject({ message: '다른 폭을 골라 주세요.', stale: false });
  });
  it('꺼짐(403 문자열 detail)', () => {
    expect(eduErrorInfo({ status: 403, body: { detail: 'edu_game_disabled' } })).toMatchObject({ disabled: true, stale: true });
  });
  it('401·네트워크', () => {
    expect(eduErrorInfo({ status: 401, body: { detail: 'TOKEN_EXPIRED' } }).unauthorized).toBe(true);
    expect(eduErrorInfo(new Error('Network request failed')).message).toContain('연결할 수 없어요');
  });
});

describe('차트 행', () => {
  const c = (day_index: number, date: string, close: number): EduCandle => ({
    day_index, date, open: close, high: close, low: close, close, volume: 10, change_pct: 0, pattern_tag: null,
  });
  it('날짜 오름차순·같은 날짜는 뒤 봉으로 하나', () => {
    const rows = eduChartRows([c(2, '2026-11-24', 2), c(1, '2026-11-23', 1), c(3, '2026-11-24', 3)]);
    expect(rows.map((r) => [r.date, r.close])).toEqual([
      ['2026-11-23', 1],
      ['2026-11-24', 3],
    ]);
  });
});
