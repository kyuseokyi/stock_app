// 주간·월간 랭킹 공통 표시 로직(탭 구성·DTO 정규화·보상 안내 문구·보상 설정 기본값). 순수 함수만.
import type {
  MonthlyBoard,
  MonthlyMyRank,
  MonthlyResultMonth,
  RewardConfig,
  SeasonPeriod,
  WeeklyBoard,
  WeeklyMyRank,
  WeeklyResultWeek,
} from '../types';
import { formatRewardWon } from './weekly';

export type RankingPeriod = 'week' | 'month';
export type RankingTab = 'weekly' | 'monthly' | 'season' | 'hof';

/** 랭킹 시트 탭 — 분기 시즌만 월간 탭. 월간(기본) 시즌은 기존 3탭 그대로 */
export function rankingTabs(period: SeasonPeriod | undefined): { key: RankingTab; label: string }[] {
  if (period === 'quarter') {
    return [
      { key: 'weekly', label: '주간' },
      { key: 'monthly', label: '월간' },
      { key: 'season', label: '시즌' },
      { key: 'hof', label: '명예의 전당' },
    ];
  }
  return [
    { key: 'weekly', label: '주간' },
    { key: 'season', label: '시즌 랭킹' },
    { key: 'hof', label: '명예의 전당' },
  ];
}

// ---------------------------------------------------------------- 주간·월간 공통 형태

export interface PeriodEntry {
  rank: number;
  user_id: number;
  nickname: string | null;
  roi: number;
}

export interface PeriodBoard {
  /** 기간 없음(월간 시즌의 월간 조회 등)이면 null */
  start_at: string | null;
  end_at: string | null;
  entries: PeriodEntry[];
}

export interface PeriodMyRank {
  rank: number | null;
  roi: number | null;
  total: number;
}

export interface PeriodResult {
  entries: { rank: number; nickname: string | null; roi: number; reward_amount: number }[];
}

export const fromWeeklyBoard = (b: WeeklyBoard): PeriodBoard => ({
  start_at: b.start_at,
  end_at: b.end_at,
  entries: b.entries.map((e) => ({ rank: e.rank, user_id: e.user_id, nickname: e.nickname, roi: e.weekly_roi })),
});

export const fromMonthlyBoard = (b: MonthlyBoard): PeriodBoard => ({
  start_at: b.start_at,
  end_at: b.end_at,
  entries: b.entries.map((e) => ({ rank: e.rank, user_id: e.user_id, nickname: e.nickname, roi: e.monthly_roi })),
});

export const fromWeeklyMyRank = (m: WeeklyMyRank): PeriodMyRank => ({ rank: m.rank, roi: m.weekly_roi, total: m.total });
export const fromMonthlyMyRank = (m: MonthlyMyRank): PeriodMyRank => ({ rank: m.rank, roi: m.monthly_roi, total: m.total });

export const fromWeeklyResult = (r: WeeklyResultWeek): PeriodResult => ({
  entries: r.entries.map((e) => ({ rank: e.rank, nickname: e.nickname, roi: e.weekly_roi, reward_amount: e.reward_amount })),
});

export const fromMonthlyResult = (r: MonthlyResultMonth): PeriodResult => ({
  entries: r.entries.map((e) => ({ rank: e.rank, nickname: e.nickname, roi: e.monthly_roi, reward_amount: e.reward_amount })),
});

/** 기간별 화면 문구 */
export const PERIOD_TEXT: Record<RankingPeriod, { myRank: string; lastTop: string; empty: string }> = {
  week: { myRank: '내 주간 순위', lastTop: '지난주 1~3위', empty: '이번 주 순위가 아직 없어요' },
  month: { myRank: '내 월간 순위', lastTop: '지난달 1~3위', empty: '이번 달 순위가 아직 없어요' },
};

// ---------------------------------------------------------------- 보상 설정(/reward-config)

/** 서버 설정 조회 실패·누락 시 기본값(backend game_settings 기본값과 동일) */
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  weekly: [500_000, 300_000, 200_000],
  monthly: [1_500_000, 900_000, 600_000],
  streak: { '3': 100_000, '7': 300_000, '14': 700_000, '30': 2_000_000 },
};

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const ranks3 = (v: unknown, fallback: number[]): number[] =>
  Array.isArray(v) && v.length === 3 && v.every(isAmount) ? v.map((n) => Math.round(n)) : fallback;

/** 응답 검증 — 필드별로 잘못된 값이면 그 필드만 기본값 */
export function normalizeRewardConfig(raw: unknown): RewardConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const streak: Record<string, number> = { ...DEFAULT_REWARD_CONFIG.streak };
  if (obj.streak && typeof obj.streak === 'object') {
    for (const [k, v] of Object.entries(obj.streak as Record<string, unknown>)) {
      if (isAmount(v)) streak[k] = Math.round(v);
    }
  }
  return {
    weekly: ranks3(obj.weekly, DEFAULT_REWARD_CONFIG.weekly),
    monthly: ranks3(obj.monthly, DEFAULT_REWARD_CONFIG.monthly),
    streak,
  };
}

/** 보상 안내 — "1위 500,000원 · 2위 300,000원 · 3위 200,000원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만" */
export function rankingRuleText(period: RankingPeriod, amounts: number[]): string {
  const prizes = amounts.map((a, i) => `${i + 1}위 ${formatRewardWon(a)}`).join(' · ');
  const cond =
    period === 'month' ? '그 달 신규 주문 1회 이상 · 시즌 마지막 달은 기록만' : '그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만';
  return `${prizes} · ${cond}`;
}
