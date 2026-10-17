import {
  feeText,
  leverageExampleRows,
  leverageUnlockText,
  leveragesText,
  liquidationMovesText,
  normalizeGameRules,
  orderRulesHint,
  pctText,
  seasonPeriodText,
  slPreemptedText,
  streakRewardsText,
  tradingWindowsText,
} from './rules';

const RAW = {
  initial_cash: 10_000_000,
  min_order_amount: 100_000,
  max_open_positions: 1,
  trading_windows: [
    ['09:00', '15:30'],
    ['16:00', '20:00'],
  ],
  leverages: [1, 2, 5],
  leverage_unlock: { '5': 'academy' },
  fee_roundtrip_pct: 0.03,
  margin_call_roi_pct: -80,
  sentiment_interval_sec: 5,
  rewards: { weekly: [500_000, 300_000, 200_000], monthly: [1, 2, 3], streak: { '3': 100_000 } },
};

describe('normalizeGameRules', () => {
  test('차트 기본 단위 — 있으면 반영, 모르는 값은 버림, 없으면 undefined', () => {
    const r = normalizeGameRules({ ...RAW, chart_interval_default: '5m', chart_intervals: ['day', '5m', '30m'] });
    expect(r.chart_interval_default).toBe('5m');
    expect(r.chart_intervals).toEqual(['day', '5m']);
    expect(normalizeGameRules({ ...RAW, chart_interval_default: '30m' }).chart_interval_default).toBeUndefined();
    expect(normalizeGameRules(RAW).chart_interval_default).toBeUndefined();
  });
  test('정상 응답 그대로', () => {
    const r = normalizeGameRules(RAW);
    expect(r.initial_cash).toBe(10_000_000);
    expect(r.trading_windows).toEqual([
      ['09:00', '15:30'],
      ['16:00', '20:00'],
    ]);
    expect(r.leverages).toEqual([1, 2, 5]);
    expect(r.leverage_unlock).toEqual({ '5': 'academy' });
    expect(r.rewards.weekly).toEqual([500_000, 300_000, 200_000]);
    expect(r.rewards.monthly).toEqual([1, 2, 3]);
  });
  test('핵심 숫자 누락이면 throw', () => {
    expect(() => normalizeGameRules({ ...RAW, fee_roundtrip_pct: 'x' })).toThrow();
    expect(() => normalizeGameRules({ ...RAW, leverages: [] })).toThrow();
    expect(() => normalizeGameRules(null)).toThrow();
  });
  test('잘못된 거래 시간 항목은 버린다', () => {
    expect(normalizeGameRules({ ...RAW, trading_windows: [['9시', '10시'], ['09:00', '15:30']] }).trading_windows).toEqual([
      ['09:00', '15:30'],
    ]);
  });
});

describe('규칙 문구', () => {
  test('pctText — 끝의 0 제거·음수는 −', () => {
    expect(pctText(0.03)).toBe('0.03');
    expect(pctText(-16)).toBe('−16');
    expect(pctText(-26.666)).toBe('−26.67');
    expect(pctText(0)).toBe('0');
  });
  test('수수료·주문 패널 안내', () => {
    expect(feeText({ fee_roundtrip_pct: 0.03 })).toBe('0.03%');
    expect(orderRulesHint({ fee_roundtrip_pct: 0.03 })).toBe('수수료 0.03% 포함 · 규칙 보기');
    expect(orderRulesHint(null)).toBe('규칙 보기');
  });
  test('거래 시간', () => {
    expect(
      tradingWindowsText([
        ['09:00', '15:30'],
        ['16:00', '20:00'],
      ]),
    ).toBe('평일 09:00~15:30 · 16:00~20:00 (공휴일·대체공휴일·연말 휴장 제외)');
    expect(tradingWindowsText([])).toBe('—');
  });
  test('배율별 자동 청산 주가 변동 = 자동 청산 수익률 / 배율', () => {
    expect(liquidationMovesText({ leverages: [1, 2, 5], margin_call_roi_pct: -80 })).toBe(
      '1배 약 −80% · 2배 −40% · 5배 −16%',
    );
  });
  test('배율 예시 표·배율 목록·해금 안내', () => {
    expect(leverageExampleRows([1, 2, 5], 1)).toEqual([
      { leverage: 1, pnl: '+1%' },
      { leverage: 2, pnl: '+2%' },
      { leverage: 5, pnl: '+5%' },
    ]);
    expect(leverageExampleRows([1, 2, 5], -1).map((r) => r.pnl)).toEqual(['−1%', '−2%', '−5%']);
    expect(leveragesText([1, 2, 5])).toBe('1배·2배·5배');
    expect(leverageUnlockText({ '5': 'academy' })).toBe('5배는 아카데미 통과 후 쓸 수 있어요');
    expect(leverageUnlockText({})).toBeNull();
  });
});

describe('규칙 문구 — 손절·시즌·출석', () => {
  test('자동 청산이 먼저인 손절 조합', () => {
    expect(slPreemptedText({ leverages: [1, 2, 5], margin_call_roi_pct: -80 }, [0.03, 0.05, 0.1, 0.15, 0.2])).toBe(
      '5배 손절 −20%',
    );
    expect(slPreemptedText({ leverages: [1, 2], margin_call_roi_pct: -80 }, [0.2])).toBeNull();
  });
  test('시즌 기간', () => {
    expect(seasonPeriodText({ period: 'quarter', end_at: null })).toBe('분기 시즌(3개월)');
    expect(seasonPeriodText({ end_at: '2026-10-31T06:30:00Z' })).toBe('월간 시즌(1개월) · 10/31(토) 15:30 종료');
  });
  test('연속 출석 보상 — 일수 오름차순', () => {
    expect(streakRewardsText({ '7': 300_000, '3': 100_000, '30': 2_000_000, '14': 700_000 })).toBe(
      '3일 100,000원 · 7일 300,000원 · 14일 700,000원 · 30일 2,000,000원',
    );
  });
});
