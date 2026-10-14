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

/** 현재 기간 목록·내 순위·직전 기간 Top 3. 내 순위·직전 기간은 실패해도 목록은 표시(목록 실패만 throw) */
export async function loadPeriodRanking(
  period: RankingPeriod,
  seasonId: number,
  loggedIn: boolean,
): Promise<PeriodRankingData> {
  if (period === 'month') {
    const [board, me, results] = await Promise.all([
      getMonthlyLeaderboard(seasonId),
      loggedIn ? getMonthlyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      getMonthlyResults(seasonId, 1).catch(() => []),
    ]);
    return {
      board: fromMonthlyBoard(board),
      me: me ? fromMonthlyMyRank(me) : null,
      last: results[0] ? fromMonthlyResult(results[0]) : null,
    };
  }
  const [board, me, results] = await Promise.all([
    getWeeklyLeaderboard(seasonId),
    loggedIn ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
    getWeeklyResults(seasonId, 1).catch(() => []),
  ]);
  return {
    board: fromWeeklyBoard(board),
    me: me ? fromWeeklyMyRank(me) : null,
    last: results[0] ? fromWeeklyResult(results[0]) : null,
  };
}
