import { useCallback, useEffect, useState } from 'react'
import { getGameRules } from '../api/game'
import { normalizeRewardConfig } from './useRewardConfig'
import { CHART_INTERVALS, type ChartInterval, type GameRules } from '../types/game'

export type GameRulesStatus = 'loading' | 'ready' | 'error'

export interface GameRulesState {
  rules: GameRules | null
  status: GameRulesStatus
  retry: () => void
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInterval = (v: unknown): v is ChartInterval => CHART_INTERVALS.includes(v as ChartInterval)

/** 핵심 숫자가 비정상이면 null(오류 상태로 표시 — 틀린 숫자를 안내하지 않는다) */
export function normalizeGameRules(raw: unknown): GameRules | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<GameRules>
  const required = [r.initial_cash, r.min_order_amount, r.max_open_positions, r.fee_roundtrip_pct, r.margin_call_roi_pct]
  if (!required.every(isNum)) return null
  const windows = Array.isArray(r.trading_windows)
    ? r.trading_windows.filter(
        (w): w is [string, string] => Array.isArray(w) && w.length === 2 && w.every((t) => typeof t === 'string'),
      )
    : []
  const leverages = Array.isArray(r.leverages) ? r.leverages.filter(isNum) : []
  return {
    initial_cash: r.initial_cash as number,
    min_order_amount: r.min_order_amount as number,
    max_open_positions: r.max_open_positions as number,
    trading_windows: windows,
    leverages: leverages.length > 0 ? leverages : [1],
    leverage_unlock: r.leverage_unlock && typeof r.leverage_unlock === 'object' ? r.leverage_unlock : {},
    fee_roundtrip_pct: r.fee_roundtrip_pct as number,
    margin_call_roi_pct: r.margin_call_roi_pct as number,
    sentiment_interval_sec: isNum(r.sentiment_interval_sec) ? r.sentiment_interval_sec : 5,
    rewards: normalizeRewardConfig(r.rewards),
    chart_interval_default: isInterval(r.chart_interval_default) ? r.chart_interval_default : 'day',
    chart_intervals: (() => {
      const list = Array.isArray(r.chart_intervals) ? r.chart_intervals.filter(isInterval) : []
      return list.length > 0 ? list : CHART_INTERVALS
    })(),
  }
}

// 페이지 수명 동안 1회 요청 결과를 공유(useRewardConfig 와 같은 방식). 실패 시 retry/다음 마운트에 재요청.
let cached: GameRules | null = null
let inflight: Promise<GameRules> | null = null

function loadGameRules(): Promise<GameRules> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = getGameRules()
      .then((raw) => {
        const rules = normalizeGameRules(raw)
        if (!rules) throw new Error('규칙 응답 형식 오류')
        cached = rules
        return rules
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** 게임 규칙(/rules). 로딩·실패 상태와 다시 시도 함수를 함께 돌려준다 */
export function useGameRules(): GameRulesState {
  const [rules, setRules] = useState<GameRules | null>(cached)
  const [status, setStatus] = useState<GameRulesStatus>(cached ? 'ready' : 'loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cached) return
    let cancelled = false
    setStatus('loading')
    loadGameRules()
      .then((r) => {
        if (cancelled) return
        setRules(r)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { rules, status, retry }
}
