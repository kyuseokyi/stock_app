import {
  DEFAULT_REWARD_CONFIG,
  fromMonthlyBoard,
  fromMonthlyMyRank,
  fromMonthlyResult,
  fromWeeklyBoard,
  normalizeRewardConfig,
  rankingRuleText,
  rankingTabs,
} from './ranking-period';

describe('rankingTabs', () => {
  it('분기 시즌은 주간·월간·시즌·명예의 전당', () => {
    expect(rankingTabs('quarter').map((t) => t.label)).toEqual(['주간', '월간', '시즌', '명예의 전당']);
  });
  it('월간 시즌·period 없음은 기존 3탭', () => {
    const legacy = ['주간', '시즌 랭킹', '명예의 전당'];
    expect(rankingTabs('month').map((t) => t.label)).toEqual(legacy);
    expect(rankingTabs(undefined).map((t) => t.label)).toEqual(legacy);
    expect(rankingTabs('month').some((t) => t.key === 'monthly')).toBe(false);
  });
});

describe('정규화', () => {
  it('주간·월간 보드 → 공통 roi', () => {
    expect(
      fromWeeklyBoard({
        week_start: '2026-10-12',
        start_at: 'a',
        end_at: 'b',
        entries: [{ rank: 1, user_id: 7, nickname: 'x', weekly_roi: 3.2 }],
      }).entries[0].roi,
    ).toBe(3.2);
    expect(
      fromMonthlyBoard({
        month_start: '2026-11-01',
        start_at: 'a',
        end_at: 'b',
        entries: [{ rank: 1, user_id: 7, nickname: null, monthly_roi: -1.5 }],
      }).entries[0],
    ).toEqual({ rank: 1, user_id: 7, nickname: null, roi: -1.5 });
  });
  it('월간 시즌의 빈 월간 보드', () => {
    expect(fromMonthlyBoard({ month_start: null, start_at: null, end_at: null, entries: [] })).toEqual({
      start_at: null,
      end_at: null,
      entries: [],
    });
  });
  it('월간 내 순위·결과', () => {
    expect(fromMonthlyMyRank({ rank: 3, monthly_roi: 1, total: 10 })).toEqual({ rank: 3, roi: 1, total: 10 });
    expect(
      fromMonthlyResult({
        season_id: 1,
        month_start: '2026-10-01',
        entries: [{ rank: 1, nickname: 'a', monthly_roi: 9, reward_amount: 1500000 }],
      }).entries[0],
    ).toEqual({ rank: 1, nickname: 'a', roi: 9, reward_amount: 1500000 });
  });
});

describe('normalizeRewardConfig', () => {
  it('정상 응답은 그대로', () => {
    const raw = { weekly: [1, 2, 3], monthly: [4, 5, 6], streak: { '3': 7, '7': 8, '14': 9, '30': 10 } };
    expect(normalizeRewardConfig(raw)).toEqual(raw);
  });
  it('잘못된 응답·필드는 기본값', () => {
    expect(normalizeRewardConfig(null)).toEqual(DEFAULT_REWARD_CONFIG);
    expect(normalizeRewardConfig({ weekly: [1, 2], monthly: 'x', streak: { '3': -1 } })).toEqual(DEFAULT_REWARD_CONFIG);
  });
});

describe('rankingRuleText', () => {
  it('주간 기본 금액', () => {
    expect(rankingRuleText('week', DEFAULT_REWARD_CONFIG.weekly)).toBe(
      '1위 500,000원 · 2위 300,000원 · 3위 200,000원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만',
    );
  });
  it('월간 설정 금액', () => {
    expect(rankingRuleText('month', [2000000, 1000000, 500000])).toBe(
      '1위 2,000,000원 · 2위 1,000,000원 · 3위 500,000원 · 그 달 신규 주문 1회 이상 · 시즌 마지막 달은 기록만',
    );
  });
});
