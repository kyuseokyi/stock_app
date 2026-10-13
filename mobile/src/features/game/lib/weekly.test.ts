import { formatKstShort, formatWeekRange, rewardToastMessage } from './weekly';

describe('weekly', () => {
  it('KST 짧은 표기', () => {
    expect(formatKstShort('2026-10-12T00:00:00+00:00')).toBe('10/12(월) 09:00');
    expect(formatKstShort('2026-10-31T20:00:00+09:00')).toBe('10/31(토) 20:00');
  });
  it('기간', () => {
    expect(formatWeekRange('2026-10-12T09:00:00+09:00', '2026-10-19T09:00:00+09:00')).toBe(
      '10/12(월) 09:00 ~ 10/19(월) 09:00',
    );
  });
  it('보상 토스트 문구', () => {
    expect(rewardToastMessage({ id: 1, week_start: '2026-10-12', rank: 1, reward_amount: 500000 })).toBe(
      '지난주 주간 랭킹 1위! 보상 500,000원이 지급됐어요',
    );
    expect(rewardToastMessage({ id: 2, week_start: '2026-10-12', rank: 3, reward_amount: 200000 })).toBe(
      '지난주 주간 랭킹 3위! 보상 200,000원이 지급됐어요',
    );
  });
});
