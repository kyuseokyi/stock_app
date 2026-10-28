// trading_game REST(createHttpClient) + 일봉 GraphQL(stock_api). Decimal 문자열은 여기서 number 로 변환해
// 화면/스토어는 number 만 다룬다. (web api/game.ts + api/stock.ts 와 같은 계약)
// createHttpClient 는 lib/api/index 에서 export 되지 않으므로(인스턴스만 노출) 모듈에서 직접 가져온다.
import { stockRequest } from '@/lib/api/graphql';
import { createHttpClient, type HttpClient } from '@/lib/api/http';
import { ENV } from '@/lib/env';

import { toNum, toNumOrNull } from './lib/decimal';
import { kstDateString } from './lib/format';
import { normalizeIntradayCandles } from './lib/intraday';
import { normalizeRewardConfig } from './lib/ranking-period';
import { normalizeGameRules } from './lib/rules';
import { toMarketStatus } from './lib/ws';
import type {
  MarketStatus,
  AcademyQuiz,
  AcademySubmitResult,
  Account,
  ClaimResult,
  Coach,
  DailyCandle,
  GameRules,
  HallOfFameRow,
  IntradayCandle,
  IntradayInterval,
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
  QuizOption,
  QuizQuestion,
  QuizType,
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

const toQuizOptions = (raw: RawQuizQuestion['choices']): QuizOption[] =>
  (Array.isArray(raw) ? raw : []).flatMap((c) =>
    typeof c?.code === 'string' && typeof c?.label === 'string' ? [{ code: c.code, label: c.label }] : [],
  );

const toQuizResult = ({ future_snapshot, outcome, ...r }: RawQuizResult): QuizResult => ({
  ...r,
  actual_change: toNum(r.actual_change),
  future_snapshot: Array.isArray(future_snapshot) ? toQuizCandles(future_snapshot) : [],
  outcome: typeof outcome === 'string' && outcome !== '' ? outcome : null,
});

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

/** 게임 규칙(공개·인증 불필요) — 규칙 시트·주문 패널 안내용 */
export async function getGameRules(): Promise<GameRules> {
  return normalizeGameRules(await client().get<unknown>('/api/game/rules'));
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
  // horizons·types — 이 앱이 표시할 수 있는 예측 기간·4지선다 유형(안 보내면 서버는 5일 2지선다만 낸다)
  const data = await client().get<RawQuizQuestion>('/api/game/quiz/random', {
    horizons: '3,5,10',
    types: 'RANGE,PATTERN',
  });
  const choices = toQuizOptions(data.choices);
  const known = data.quiz_type === 'RANGE' || data.quiz_type === 'PATTERN';
  return {
    id: data.id,
    chart_snapshot: toQuizCandles(data.chart_snapshot),
    time_limit_sec: data.time_limit_sec,
    horizon_bars: data.horizon_bars ?? 5,
    // 보기가 비면 그릴 수 없으므로 2지선다로 — 서버가 422 로 거절해 오답 처리되지 않는다
    quiz_type: known && choices.length > 0 ? (data.quiz_type as QuizType) : 'DIRECTION',
    choices: known ? choices : [],
  };
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

// ---------------------------------------------------------------- 분봉(trading_game REST, 공개)

/** 활성 시즌 종목 분봉(t 오름차순). 데이터가 없으면 [](빈 상태 문구), 네트워크/서버 오류는 throw */
export async function getGameCandles(interval: IntradayInterval): Promise<IntradayCandle[]> {
  return normalizeIntradayCandles(await client().get<unknown>('/api/game/candles', { interval }));
}

type RawSessionBar = { ticker?: string | null; bar?: Record<string, unknown> | null };

/** 공개 — 장운영 상태(VI·거래정지·서킷브레이크·사이드카). 형식이 틀리면 null, 오류는 throw */
export async function getMarketStatus(): Promise<MarketStatus | null> {
  const st = toMarketStatus(await client().get<unknown>('/api/game/market-status'));
  if (!st) return null;
  const { type: _type, ...rest } = st;
  return rest;
}

/** 분봉으로 만든 활성 시즌 종목의 최근 거래일 하루 봉(일봉 차트 오늘 봉). 없으면 bar: null, 오류는 throw */
export async function getSessionBar(): Promise<{ ticker: string; bar: DailyCandle | null }> {
  const data = await client().get<RawSessionBar>('/api/game/candles/session');
  const b = data?.bar;
  return {
    ticker: data?.ticker ?? '',
    bar:
      b && typeof b.date === 'string'
        ? { date: b.date, open: toNum(b.open), high: toNum(b.high), low: toNum(b.low), close: toNum(b.close) }
        : null,
  };
}

// ---------------------------------------------------------------- 일봉(stock_api GraphQL)

const DAILY_QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close volume }
  }
}`;

// 차트 왼쪽 스크롤로 과거를 이어 받을 때 — realOnly: 저장된 기간보다 과거면 가짜 대신 빈 candles(= 더 없음). 웹과 같은 쿼리
export const DAILY_HISTORY_QUERY = `query DailyHistory($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate, realOnly: true) {
    candles { date open high low close volume }
  }
}`;

/** 과거 이어 받기 한 번에 요청하는 달력일 수(약 250거래일) */
export const HISTORY_PAGE_DAYS = 365;

// 첫 화면은 180일(chart-bridge DAILY_VISIBLE_DAYS) — 앞쪽 100일(약 70거래일)은 60일선·볼린저 워밍업. 웹 api/stock.ts 와 같은 값
const LOOKBACK_DAYS = 280;
const DAY_MS = 86_400_000;

/** beforeDate(YYYY-MM-DD, 제외) 직전 days 달력일의 일봉. 저장된 기간보다 과거면 []. 오류면 throw */
export async function getDailyCandlesBefore(
  ticker: string,
  beforeDate: string,
  days: number = HISTORY_PAGE_DAYS,
): Promise<DailyCandle[]> {
  const end = Date.parse(`${beforeDate}T00:00:00Z`) - DAY_MS;
  const data = await stockRequest<DailyResponse, DailyVars>(DAILY_HISTORY_QUERY, {
    symbol: ticker,
    startDate: new Date(end - days * DAY_MS).toISOString().slice(0, 10),
    endDate: new Date(end).toISOString().slice(0, 10),
  });
  return (data.getChartData?.candles ?? []).filter((c) => c.date < beforeDate);
}

type DailyVars = { symbol: string; startDate: string; endDate: string };
type DailyResponse = { getChartData: { candles: DailyCandle[] } | null };

/** 최근 약 280일 일봉(지표 워밍업 포함, lookbackDays 로 늘릴 수 있음 — 종목 상세는 1년 + 50일선 워밍업). GraphQL 오류·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(
  ticker: string,
  now: Date = new Date(),
  lookbackDays: number = LOOKBACK_DAYS,
): Promise<DailyCandle[]> {
  const data = await stockRequest<DailyResponse, DailyVars>(DAILY_QUERY, {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - lookbackDays * DAY_MS)),
    endDate: kstDateString(now),
  });
  const candles = data.getChartData?.candles;
  if (!candles || candles.length === 0) throw new Error('일봉 데이터 없음');
  return candles;
}
