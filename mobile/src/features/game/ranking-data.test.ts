import * as api from './api';
import { loadPeriodRanking } from './ranking-data';

jest.mock('./api');
const m = api as jest.Mocked<typeof api>;

const board = { week_start: '2026-10-12', start_at: 's', end_at: 'e', entries: [] };
const result = { week_start: '2026-10-05', entries: [{ rank: 1, nickname: '가', weekly_roi: 3, reward_amount: 500000 }] };

beforeEach(() => {
  jest.resetAllMocks();
  m.getWeeklyLeaderboard.mockResolvedValue(board as never);
  m.getWeeklyResults.mockResolvedValue([result] as never);
});

describe('loadPeriodRanking', () => {
  it('처음 로드는 직전 기간 Top 3 를 받는다', async () => {
    const data = await loadPeriodRanking('week', 1, false);
    expect(m.getWeeklyResults).toHaveBeenCalledTimes(1);
    expect(data.last).not.toBeNull();
  });

  it('조용한 갱신(keepLast)은 직전 기간을 다시 받지 않고 그대로 쓴다', async () => {
    const kept = { entries: [] } as never;
    const data = await loadPeriodRanking('week', 1, false, kept);
    expect(m.getWeeklyResults).not.toHaveBeenCalled();
    expect(m.getWeeklyLeaderboard).toHaveBeenCalledTimes(1);
    expect(data.last).toBe(kept);
    expect(await loadPeriodRanking('week', 1, false, null)).toMatchObject({ last: null });
    expect(m.getWeeklyResults).not.toHaveBeenCalled();
  });
});
