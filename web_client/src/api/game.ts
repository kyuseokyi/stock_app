import type { AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import { toNum, toNumOrNull } from '../lib/decimal'
import type {
  AcademyQuiz, AcademySubmitResult, Account, ClaimResult, Coach, HallOfFameRow, LeaderboardRow, MyRank,
  OrderRequest, OrderResult, Position, Quest, QuestList, QuizCandle, QuizChoice, QuizQuestion, QuizResult,
  RawAccount, RawClaimResult, RawCoachMessage, RawCoachToday, RawOrderResult, RawPosition, RawQuest,
  RawQuestList, RawQuizQuestion, RawQuizResult, RawStreakClaimResult, Season, Streak, StreakClaimResult,
  WeeklyBoard, WeeklyMyRank, WeeklyResultWeek, WeeklyReward,
  MonthlyBoard, MonthlyMyRank, MonthlyResultMonth, RewardConfig, GameRules,
  IntradayCandle, IntradayCandles, IntradayInterval,
} from '../types/game'

// trading_game REST. Decimal 문자열은 여기서 number 로 변환해 UI 는 number 만 다룬다.

function client(): AxiosInstance {
  if (!gameClient) throw new Error('GAME_API_URL 미설정')
  return gameClient
}

export const toPosition = (r: RawPosition): Position => ({
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
})

const toAccount = (r: RawAccount): Account => ({
  season_id: r.season_id,
  cash_balance: toNum(r.cash_balance),
  total_asset: toNum(r.total_asset),
  current_roi: toNum(r.current_roi),
  total_trades: r.total_trades,
  win_trades: r.win_trades,
})

const toCoach = (m: RawCoachMessage): Coach => ({
  season_id: m.season_id,
  coach_type: m.coach_type,
  title: m.title,
  summary_nudge: m.summary_nudge,
  content_md: m.content_md,
  support_price: toNumOrNull(m.support_price),
  resistance_price: toNumOrNull(m.resistance_price),
})

const toOrderResult = (r: RawOrderResult): OrderResult => ({ position: toPosition(r), nudges: r.nudges })

const toQuest = (r: RawQuest): Quest => ({ ...r, reward_cash: toNumOrNull(r.reward_cash) })

/** 스키마 없는 dict → 캔들. OHLC 중 하나라도 숫자가 아니면 그 캔들은 버린다(차트 예외 방지) */
const toQuizCandles = (raw: Record<string, unknown>[]): QuizCandle[] => {
  const out: QuizCandle[] = []
  for (const c of raw) {
    const open = toNumOrNull(c.open)
    const high = toNumOrNull(c.high)
    const low = toNumOrNull(c.low)
    const close = toNumOrNull(c.close)
    if (open === null || high === null || low === null || close === null) continue
    const volume = toNumOrNull(c.volume)
    out.push(volume === null ? { open, high, low, close } : { open, high, low, close, volume })
  }
  return out
}

const toQuizResult = (r: RawQuizResult): QuizResult => ({ ...r, actual_change: toNum(r.actual_change) })

/** 공개 — 활성 시즌 없으면 null */
export async function getActiveSeason(): Promise<Season | null> {
  const { data } = await client().get<Season | null>('/api/game/seasons/active')
  return data
}

export async function getMyAccount(seasonId: number): Promise<Account> {
  const { data } = await client().get<RawAccount>('/api/game/accounts/me', { params: { season_id: seasonId } })
  return toAccount(data)
}

/** 보유 포지션(서버 규칙상 최대 1개) — 없으면 null */
export async function getActivePosition(seasonId: number): Promise<Position | null> {
  const { data } = await client().get<RawPosition[]>('/api/game/positions/active', { params: { season_id: seasonId } })
  return data.length > 0 ? toPosition(data[0]) : null
}

export async function getMyRank(seasonId: number): Promise<MyRank> {
  const { data } = await client().get<MyRank>(`/api/game/seasons/${seasonId}/my-rank`)
  return data
}

/** 오늘의 코치(evening 우선 active) — 없으면 null */
export async function getTodayCoach(): Promise<Coach | null> {
  const { data } = await client().get<RawCoachToday>('/api/game/coach/today')
  return data.active ? toCoach(data.active) : null
}

/** 5배 레버리지 해금 여부만(loadPrivate 용). 문항까지 필요하면 getAcademyQuiz */
export async function getAcademyUnlocked(): Promise<boolean> {
  const { data } = await client().get<{ unlocked: boolean }>('/api/game/academy/quiz')
  return data.unlocked
}

export async function placeOrder(body: OrderRequest): Promise<OrderResult> {
  // 손절/익절은 값이 있을 때만 전송(null·생략 → 키 제외)
  const { stop_loss_pct, take_profit_pct, ...base } = body
  const payload = {
    ...base,
    ...(stop_loss_pct != null && { stop_loss_pct }),
    ...(take_profit_pct != null && { take_profit_pct }),
  }
  const { data } = await client().post<RawOrderResult>('/api/game/orders', payload)
  return toOrderResult(data)
}

export async function closePosition(positionId: string): Promise<OrderResult> {
  const { data } = await client().post<RawOrderResult>(`/api/game/positions/${positionId}/close`)
  return toOrderResult(data)
}

// ---------------------------------------------------------------- 6b: 모달

/** 공개 — 시즌 Top 100 */
export async function getLeaderboard(seasonId: number): Promise<LeaderboardRow[]> {
  const { data } = await client().get<LeaderboardRow[]>(`/api/game/seasons/${seasonId}/leaderboard`)
  return data
}

/** 공개 — 명예의 전당(시즌 desc · 순위 asc, 최대 300) */
export async function getHallOfFame(): Promise<HallOfFameRow[]> {
  const { data } = await client().get<HallOfFameRow[]>('/api/game/hall-of-fame')
  return data
}

/** 공개 — 이번 주 Top 100(월 09:00 시작, 시즌 경계로 잘림) */
export async function getWeeklyLeaderboard(seasonId: number): Promise<WeeklyBoard> {
  const { data } = await client().get<WeeklyBoard>(`/api/game/seasons/${seasonId}/weekly-leaderboard`)
  return data
}

export async function getWeeklyMyRank(seasonId: number): Promise<WeeklyMyRank> {
  const { data } = await client().get<WeeklyMyRank>(`/api/game/seasons/${seasonId}/weekly-my-rank`)
  return data
}

/** 공개 — 지난 주들의 Top 3(최신 주 먼저) */
export async function getWeeklyResults(seasonId: number, limit = 1): Promise<WeeklyResultWeek[]> {
  const { data } = await client().get<WeeklyResultWeek[]>('/api/game/weekly-results', {
    params: { season_id: seasonId, limit },
  })
  return data
}

/** 공개 — 이번 달 Top 100(분기 시즌 전용, 월간 시즌이면 빈 결과) */
export async function getMonthlyLeaderboard(seasonId: number): Promise<MonthlyBoard> {
  const { data } = await client().get<MonthlyBoard>(`/api/game/seasons/${seasonId}/monthly-leaderboard`)
  return data
}

export async function getMonthlyMyRank(seasonId: number): Promise<MonthlyMyRank> {
  const { data } = await client().get<MonthlyMyRank>(`/api/game/seasons/${seasonId}/monthly-my-rank`)
  return data
}

/** 공개 — 지난 달들의 Top 3(최신 달 먼저) */
export async function getMonthlyResults(seasonId: number, limit = 1): Promise<MonthlyResultMonth[]> {
  const { data } = await client().get<MonthlyResultMonth[]>('/api/game/monthly-results', {
    params: { season_id: seasonId, limit },
  })
  return data
}

/** 공개 — 주간·월간·연속 출석 보상 금액(admin 설정값) */
export async function getRewardConfig(): Promise<RewardConfig> {
  const { data } = await client().get<RewardConfig>('/api/game/reward-config')
  return data
}

/** 공개 — 게임 규칙 상수(자본금·최소 주문·거래 시간·배율·수수료·자동 청산·보상) */
export async function getGameRules(): Promise<GameRules> {
  const { data } = await client().get<GameRules>('/api/game/rules')
  return data
}

/** 공개 — 활성 시즌 종목 분봉(t = 버킷 시작 UTC epoch seconds). 데이터 없으면 candles: [] */
export async function getGameCandles(interval: IntradayInterval): Promise<IntradayCandles> {
  const { data } = await client().get<IntradayCandles>('/api/game/candles', { params: { interval } })
  // 숫자가 문자열(Decimal)로 와도 number 로 정규화, t 가 비정상인 행은 버림
  const rows: IntradayCandle[] = (Array.isArray(data?.candles) ? data.candles : [])
    .map((c) => ({
      t: Number(c.t), open: toNum(c.open), high: toNum(c.high), low: toNum(c.low), close: toNum(c.close),
      volume: toNum(c.volume ?? 0),
    }))
    .filter((c) => Number.isFinite(c.t))
  return { interval: data?.interval ?? interval, ticker: data?.ticker ?? '', candles: rows }
}

/** 미확인 주간·월간 보상(period_type 으로 구분) */
export async function getUnseenWeeklyRewards(): Promise<WeeklyReward[]> {
  const { data } = await client().get<WeeklyReward[]>('/api/game/weekly-rewards/unseen')
  return data
}

export async function ackWeeklyReward(id: number): Promise<void> {
  await client().post(`/api/game/weekly-rewards/${id}/ack`)
}

export async function getQuests(): Promise<QuestList> {
  const { data } = await client().get<RawQuestList>('/api/game/quests')
  return { quests: data.quests.map(toQuest), badges: data.badges }
}

export async function claimQuest(code: string): Promise<ClaimResult> {
  const { data } = await client().post<RawClaimResult>(`/api/game/quests/${encodeURIComponent(code)}/claim`)
  return { quest: toQuest(data.quest), cash_balance: toNumOrNull(data.cash_balance), badge: data.badge }
}

export async function getAcademyQuiz(): Promise<AcademyQuiz> {
  const { data } = await client().get<AcademyQuiz>('/api/game/academy/quiz')
  return data
}

/** answers: 문항 id → 선택 인덱스(0-based) */
export async function submitAcademy(answers: Record<number, number>): Promise<AcademySubmitResult> {
  const { data } = await client().post<AcademySubmitResult>('/api/game/academy/submit', { answers })
  return data
}

export async function getRandomQuiz(): Promise<QuizQuestion> {
  const { data } = await client().get<RawQuizQuestion>('/api/game/quiz/random')
  return { id: data.id, chart_snapshot: toQuizCandles(data.chart_snapshot), time_limit_sec: data.time_limit_sec }
}

export async function submitQuiz(quizId: number, choice: QuizChoice): Promise<QuizResult> {
  const { data } = await client().post<RawQuizResult>(`/api/game/quiz/${quizId}/submit`, { choice })
  return toQuizResult(data)
}

export async function getMyStreak(): Promise<Streak> {
  const { data } = await client().get<Streak>('/api/game/streak/my')
  return data
}

/** 연속 출석 마일스톤 보상 수령 — 갱신된 streak(rewards 포함)과 지급 후 현금 잔고 */
export async function claimStreakReward(milestone: number): Promise<StreakClaimResult> {
  const { data } = await client().post<RawStreakClaimResult>(`/api/game/streak/rewards/${milestone}/claim`)
  return { streak: data.streak, cash_balance: toNum(data.cash_balance) }
}
