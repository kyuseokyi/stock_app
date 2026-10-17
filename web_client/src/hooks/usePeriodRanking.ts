import { useEffect, useRef, useState } from 'react'
import {
  getMonthlyLeaderboard, getMonthlyMyRank, getMonthlyResults,
  getWeeklyLeaderboard, getWeeklyMyRank, getWeeklyResults,
} from '../api/game'
import { gameErrorMessage } from '../lib/gameErrors'
import { useVisibleInterval } from './useVisibleInterval'

/** 탭이 열려 있는 동안 조용히 다시 불러오는 주기(서버 목록 캐시 5초) */
export const RANKING_REFRESH_MS = 15_000

export type RankingPeriod = 'week' | 'month'

/** 주간·월간 공통 표시 형태(roi = weekly_roi | monthly_roi) */
export interface PeriodBoard {
  start_at: string | null
  end_at: string | null
  entries: { rank: number; user_id: number; nickname: string | null; roi: number }[]
}
export interface PeriodMyRank {
  rank: number | null
  roi: number | null
  total: number
}
export interface PeriodLastResult {
  entries: { rank: number; nickname: string | null; roi: number; reward_amount: number }[]
}

export type PeriodRankingData = { board: PeriodBoard; me: PeriodMyRank | null; last: PeriodLastResult | null }
export type PeriodRankingLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: PeriodRankingData }

async function fetchWeek(seasonId: number, loggedIn: boolean): Promise<PeriodRankingData> {
  const [board, me, results] = await Promise.all([
    getWeeklyLeaderboard(seasonId),
    loggedIn ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
    getWeeklyResults(seasonId, 1).catch(() => []),
  ])
  const last = results[0]
  return {
    board: {
      start_at: board.start_at,
      end_at: board.end_at,
      entries: board.entries.map((e) => ({ rank: e.rank, user_id: e.user_id, nickname: e.nickname, roi: e.weekly_roi })),
    },
    me: me && { rank: me.rank, roi: me.weekly_roi, total: me.total },
    last: last
      ? { entries: last.entries.map((e) => ({ rank: e.rank, nickname: e.nickname, roi: e.weekly_roi, reward_amount: e.reward_amount })) }
      : null,
  }
}

async function fetchMonth(seasonId: number, loggedIn: boolean): Promise<PeriodRankingData> {
  const [board, me, results] = await Promise.all([
    getMonthlyLeaderboard(seasonId),
    loggedIn ? getMonthlyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
    getMonthlyResults(seasonId, 1).catch(() => []),
  ])
  const last = results[0]
  return {
    board: {
      start_at: board.start_at,
      end_at: board.end_at,
      entries: board.entries.map((e) => ({ rank: e.rank, user_id: e.user_id, nickname: e.nickname, roi: e.monthly_roi })),
    },
    me: me && { rank: me.rank, roi: me.monthly_roi, total: me.total },
    last: last
      ? { entries: last.entries.map((e) => ({ rank: e.rank, nickname: e.nickname, roi: e.monthly_roi, reward_amount: e.reward_amount })) }
      : null,
  }
}

/**
 * 주간/월간 탭 데이터 — 목록 실패만 에러, 내 순위·지난 기간 Top 3 실패는 조용히 생략.
 * 열려 있는 동안 RANKING_REFRESH_MS 마다 로딩 표시 없이 갱신(실패하면 기존 목록 유지).
 */
export function usePeriodRanking(period: RankingPeriod, seasonId: number, myUserId: number | null) {
  const [state, setState] = useState<PeriodRankingLoad>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const epoch = useRef(0) // 조건이 바뀌면 늦게 온 조용한 갱신 응답을 버린다

  useEffect(() => {
    let cancelled = false
    epoch.current += 1
    setState({ kind: 'loading' })
    const fetcher = period === 'month' ? fetchMonth : fetchWeek
    fetcher(seasonId, myUserId !== null)
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [period, seasonId, myUserId, reloadKey])

  useVisibleInterval(() => {
    if (state.kind !== 'ok') return // 첫 로드 중·오류 화면은 그대로(다시 시도 버튼)
    const my = epoch.current
    const fetcher = period === 'month' ? fetchMonth : fetchWeek
    fetcher(seasonId, myUserId !== null)
      .then((data) => {
        if (epoch.current === my) setState({ kind: 'ok', data })
      })
      .catch(() => {}) // 조용한 갱신 실패는 기존 목록 유지
  }, RANKING_REFRESH_MS)

  return { state, reload: () => setReloadKey((k) => k + 1) }
}
