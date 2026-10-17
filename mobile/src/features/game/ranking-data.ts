// 주간·월간 랭킹 탭 데이터 로드(API 호출 + 공통 형태 정규화). UI 는 PeriodRankingData 만 다룬다.
import {
  getMonthlyLeaderboard,
  getMonthlyMyRank,
  getMonthlyResults,
  getWeeklyLeaderboard,
  getWeeklyMyRank,
  getWeeklyResults,
} from './api';
import {
  fromMonthlyBoard,
  fromMonthlyMyRank,
  fromMonthlyResult,
  fromWeeklyBoard,
  fromWeeklyMyRank,
  fromWeeklyResult,
  type PeriodBoard,
  type PeriodMyRank,
  type PeriodResult,
  type RankingPeriod,
} from './lib/ranking-period';

export interface PeriodRankingData {
  board: PeriodBoard;
  me: PeriodMyRank | null;
  last: PeriodResult | null;
}

/**
 * 현재 기간 목록·내 순위·직전 기간 Top 3. 내 순위·직전 기간은 실패해도 목록은 표시(목록 실패만 throw).
 * keepLast 를 주면(조용한 갱신) 직전 기간 Top 3 는 다시 받지 않고 그대로 쓴다 — 확정 결과라 바뀌지 않음.
 */
export async function loadPeriodRanking(
  period: RankingPeriod,
  seasonId: number,
  loggedIn: boolean,
  keepLast?: PeriodResult | null,
): Promise<PeriodRankingData> {
  const reuse = keepLast !== undefined;
  if (period === 'month') {
    const [board, me, results] = await Promise.all([
      getMonthlyLeaderboard(seasonId),
      loggedIn ? getMonthlyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      reuse ? Promise.resolve([]) : getMonthlyResults(seasonId, 1).catch(() => []),
    ]);
    return {
      board: fromMonthlyBoard(board),
      me: me ? fromMonthlyMyRank(me) : null,
      last: keepLast !== undefined ? keepLast : results[0] ? fromMonthlyResult(results[0]) : null,
    };
  }
  const [board, me, results] = await Promise.all([
    getWeeklyLeaderboard(seasonId),
    loggedIn ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
    reuse ? Promise.resolve([]) : getWeeklyResults(seasonId, 1).catch(() => []),
  ]);
  return {
    board: fromWeeklyBoard(board),
    me: me ? fromWeeklyMyRank(me) : null,
    last: keepLast !== undefined ? keepLast : results[0] ? fromWeeklyResult(results[0]) : null,
  };
}
