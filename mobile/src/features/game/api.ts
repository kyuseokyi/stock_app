// trading_game REST(createHttpClient) + 일봉 GraphQL(stock_api). Decimal 문자열은 여기서 number 로 변환해
// 화면/스토어는 number 만 다룬다. (web api/game.ts + api/stock.ts 와 같은 계약)
// createHttpClient 는 lib/api/index 에서 export 되지 않으므로(인스턴스만 노출) 모듈에서 직접 가져온다.
import { stockRequest } from '@/lib/api/graphql';
import { createHttpClient, type HttpClient } from '@/lib/api/http';
import { ENV } from '@/lib/env';

import { toNum, toNumOrNull } from './lib/decimal';
import { kstDateString } from './lib/format';
import { normalizeRewardConfig } from './lib/ranking-period';
import type {
  AcademyQuiz,
  AcademySubmitResult,
  Account,
  ClaimResult,
  Coach,
  DailyCandle,
  HallOfFameRow,
  LeaderboardRow,
  MonthlyBoard,
  MonthlyMyRank,
  MonthlyResultMonth,
  MyRank,
  OrderRequest,
  OrderResult,
  Position,
  Quest,
  QuestList,
  QuizCandle,
  QuizChoice,
  QuizQuestion,
  QuizResult,
  RawAccount,
  RawClaimResult,
  RawCoachMessage,
  RawCoachToday,
  RawOrderResult,
  RawPosition,
  RawQuest,
  RawQuestList,
  RawQuizQuestion,
  RawQuizResult,
  RawStreakClaimResult,
  RewardConfig,
  Season,
  Streak,
  StreakClaimResult,
  WeeklyBoard,
  WeeklyMyRank,
  WeeklyResultWeek,
  WeeklyReward,
} from './types';

/** 게임 서버 미설정(production 에 EXPO_PUBLIC_GAME_API_URL 없음)이면 null → 화면 "준비 중" */
const gameHttp: HttpClient | null = ENV.gameApiUrl ? createHttpClient(ENV.gameApiUrl) : null;

export const isGameConfigured = (): boolean => gameHttp !== null;

function client(): HttpClient {
  if (!gameHttp) throw new Error('GAME_API_URL 미설정');
  return gameHttp;
}

const toPosition = (r: RawPosition): Position => ({
  id: r.id,
  side: r.side,
  entry_price: toNum(r.entry_price),
  size_amount: toNum(r.size_amount),
  leverage: r.leverage,
  stop_loss_price: toNumOrNull(r.stop_loss_price),
  take_profit_price: toNumOrNull(r.take_profit_price),
  status: r.status,
  roi_pct: toNumOrNull(r.roi_pct),
  pnl_amount: toNumOrNull(r.pnl_amount),
});

const toAccount = (r: RawAccount): Account => ({
  season_id: r.season_id,
  cash_balance: toNum(r.cash_balance),
  total_asset: toNum(r.total_asset),
  current_roi: toNum(r.current_roi),
  total_trades: r.total_trades,
  win_trades: r.win_trades,
});

const toCoach = (m: RawCoachMessage): Coach => ({
  season_id: m.season_id,
  coach_type: m.coach_type,
  title: m.title,
  summary_nudge: m.summary_nudge,
  content_md: m.content_md,
  support_price: toNumOrNull(m.support_price),
  resistance_price: toNumOrNull(m.resistance_price),
});

const toOrderResult = (r: RawOrderResult): OrderResult => ({ position: toPosition(r), nudges: r.nudges });

const toQuest = (r: RawQuest): Quest => ({ ...r, reward_cash: toNumOrNull(r.reward_cash) });

/** 스키마 없는 dict → 캔들. OHLC 중 하나라도 숫자가 아니면 그 캔들은 버린다(차트 예외 방지) */
const toQuizCandles = (raw: Record<string, unknown>[]): QuizCandle[] => {
  const out: QuizCandle[] = [];
  for (const c of raw) {
    const open = toNumOrNull(c.open);
    const high = toNumOrNull(c.high);
    const low = toNumOrNull(c.low);
    const close = toNumOrNull(c.close);
    if (open === null || high === null || low === null || close === null) continue;
    const volume = toNumOrNull(c.volume);
    out.push(volume === null ? { open, high, low, close } : { open, high, low, close, volume });
  }
  return out;
};

const toQuizResult = (r: RawQuizResult): QuizResult => ({ ...r, actual_change: toNum(r.actual_change) });

/** 공개 — 활성 시즌 없으면 null */
export function getActiveSeason(): Promise<Season | null> {
  return client().get<Season | null>('/api/game/seasons/active');
}

export async function getMyAccount(seasonId: number): Promise<Account> {
  return toAccount(await client().get<RawAccount>('/api/game/accounts/me', { season_id: seasonId }));
}

/** 보유 포지션(서버 규칙상 최대 1개) — 없으면 null */
export async function getActivePosition(seasonId: number): Promise<Position | null> {
  const rows = await client().get<RawPosition[]>('/api/game/positions/active', { season_id: seasonId });
  return rows.length > 0 ? toPosition(rows[0]) : null;
}

export function getMyRank(seasonId: number): Promise<MyRank> {
  return client().get<MyRank>(`/api/game/seasons/${seasonId}/my-rank`);
}

/** 오늘의 코치(evening 우선 active) — 없으면 null */
export async function getTodayCoach(): Promise<Coach | null> {
  const data = await client().get<RawCoachToday>('/api/game/coach/today');
  return data.active ? toCoach(data.active) : null;
}

/** 5배 레버리지 해금 여부만(loadPrivate 용). 문항까지 필요하면 getAcademyQuiz */
export async function getAcademyUnlocked(): Promise<boolean> {
  const data = await client().get<{ unlocked: boolean }>('/api/game/academy/quiz');
  return data.unlocked;
}

export async function placeOrder(body: OrderRequest): Promise<OrderResult> {
  // 손절/익절은 값이 있을 때만 전송(null·생략 → 키 제외)
  const { stop_loss_pct, take_profit_pct, ...base } = body;
  const payload = {
    ...base,
    ...(stop_loss_pct != null && { stop_loss_pct }),
    ...(take_profit_pct != null && { take_profit_pct }),
  };
  return toOrderResult(await client().post<RawOrderResult>('/api/game/orders', payload));
}

export async function closePosition(positionId: string): Promise<OrderResult> {
  return toOrderResult(await client().post<RawOrderResult>(`/api/game/positions/${encodeURIComponent(positionId)}/close`));
}

// ---------------------------------------------------------------- 6b: 모달

/** 공개 — 시즌 Top 100 */
export function getLeaderboard(seasonId: number): Promise<LeaderboardRow[]> {
  return client().get<LeaderboardRow[]>(`/api/game/seasons/${seasonId}/leaderboard`);
}

/** 공개 — 명예의 전당(시즌 desc · 순위 asc, 최대 300) */
export function getHallOfFame(): Promise<HallOfFameRow[]> {
  return client().get<HallOfFameRow[]>('/api/game/hall-of-fame');
}

/** 공개 — 이번 주 Top 100(월 09:00 시작, 시즌 경계로 잘림) */
export function getWeeklyLeaderboard(seasonId: number): Promise<WeeklyBoard> {
  return client().get<WeeklyBoard>(`/api/game/seasons/${seasonId}/weekly-leaderboard`);
}

export function getWeeklyMyRank(seasonId: number): Promise<WeeklyMyRank> {
  return client().get<WeeklyMyRank>(`/api/game/seasons/${seasonId}/weekly-my-rank`);
}

/** 공개 — 지난 주들의 Top 3(최신 주 먼저) */
export function getWeeklyResults(seasonId: number, limit = 1): Promise<WeeklyResultWeek[]> {
  return client().get<WeeklyResultWeek[]>('/api/game/weekly-results', { season_id: seasonId, limit });
}

export function getUnseenWeeklyRewards(): Promise<WeeklyReward[]> {
  return client().get<WeeklyReward[]>('/api/game/weekly-rewards/unseen');
}

/** 공개 — 이번 달 Top 100(분기 시즌 전용, 매월 1일 09:00 시작). 월간 시즌이면 기간 null + 빈 목록 */
export function getMonthlyLeaderboard(seasonId: number): Promise<MonthlyBoard> {
  return client().get<MonthlyBoard>(`/api/game/seasons/${seasonId}/monthly-leaderboard`);
}

export function getMonthlyMyRank(seasonId: number): Promise<MonthlyMyRank> {
  return client().get<MonthlyMyRank>(`/api/game/seasons/${seasonId}/monthly-my-rank`);
}

/** 공개 — 지난 달들의 Top 3(최신 달 먼저) */
export function getMonthlyResults(seasonId: number, limit = 1): Promise<MonthlyResultMonth[]> {
  return client().get<MonthlyResultMonth[]>('/api/game/monthly-results', { season_id: seasonId, limit });
}

/** 공개 — 랭킹·연속 출석 보상 금액(안내 문구용). 잘못된 필드는 기본값으로 정규화 */
export async function getRewardConfig(): Promise<RewardConfig> {
  return normalizeRewardConfig(await client().get<unknown>('/api/game/reward-config'));
}

/** 204 빈 응답 — http client 가 undefined 로 처리 */
export async function ackWeeklyReward(id: number): Promise<void> {
  await client().post<void>(`/api/game/weekly-rewards/${id}/ack`);
}

export async function getQuests(): Promise<QuestList> {
  const data = await client().get<RawQuestList>('/api/game/quests');
  return { quests: data.quests.map(toQuest), badges: data.badges };
}

export async function claimQuest(code: string): Promise<ClaimResult> {
  const data = await client().post<RawClaimResult>(`/api/game/quests/${encodeURIComponent(code)}/claim`);
  return { quest: toQuest(data.quest), cash_balance: toNumOrNull(data.cash_balance), badge: data.badge };
}

export function getAcademyQuiz(): Promise<AcademyQuiz> {
  return client().get<AcademyQuiz>('/api/game/academy/quiz');
}

/** answers: 문항 id → 선택 인덱스(0-based) */
export function submitAcademy(answers: Record<number, number>): Promise<AcademySubmitResult> {
  return client().post<AcademySubmitResult>('/api/game/academy/submit', { answers });
}

export async function getRandomQuiz(): Promise<QuizQuestion> {
  const data = await client().get<RawQuizQuestion>('/api/game/quiz/random');
  return { id: data.id, chart_snapshot: toQuizCandles(data.chart_snapshot), time_limit_sec: data.time_limit_sec };
}

export async function submitQuiz(quizId: number, choice: QuizChoice): Promise<QuizResult> {
  return toQuizResult(await client().post<RawQuizResult>(`/api/game/quiz/${quizId}/submit`, { choice }));
}

export function getMyStreak(): Promise<Streak> {
  return client().get<Streak>('/api/game/streak/my');
}

/** 연속 출석 마일스톤 보상 수령 — 갱신된 streak(rewards 포함)과 지급 후 현금 잔고 */
export async function claimStreakReward(milestone: number): Promise<StreakClaimResult> {
  const data = await client().post<RawStreakClaimResult>(`/api/game/streak/rewards/${milestone}/claim`);
  return { streak: data.streak, cash_balance: toNum(data.cash_balance) };
}

// ---------------------------------------------------------------- 일봉(stock_api GraphQL)

const DAILY_QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close }
  }
}`;

const LOOKBACK_DAYS = 180;
const DAY_MS = 86_400_000;

type DailyVars = { symbol: string; startDate: string; endDate: string };
type DailyResponse = { getChartData: { candles: DailyCandle[] } | null };

/** 최근 약 180일 일봉. GraphQL 오류(graphql-request 가 throw)·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(ticker: string, now: Date = new Date()): Promise<DailyCandle[]> {
  const data = await stockRequest<DailyResponse, DailyVars>(DAILY_QUERY, {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
    endDate: kstDateString(now),
  });
  const candles = data.getChartData?.candles;
  if (!candles || candles.length === 0) throw new Error('일봉 데이터 없음');
  return candles;
}
