import { CHART_INTERVALS, type ChartInterval } from '../types/game'

// 게임 차트 마지막 설정(단위·보조지표)을 이 브라우저에 저장 — 다시 열면 마지막에 보던 그대로.
// 우선순위: 저장값 > 관리자 기본 단위(/rules) > 일봉. 지표 기본은 이동평균 켜짐·볼린저 꺼짐.
// localStorage 가 막힌 환경(사파리 프라이빗 등)·깨진 값이면 조용히 기본값.
const KEY = 'game.chartPrefs.v1'

export interface ChartPrefs {
  /** 사용자가 마지막으로 고른 단위(고른 적 없으면 null → 관리자 기본값) */
  interval: ChartInterval | null
  ma: boolean
  bb: boolean
  /** 매물대(보이는 구간 가격대별 거래량) */
  vp: boolean
}

export const DEFAULT_CHART_PREFS: ChartPrefs = { interval: null, ma: true, bb: false, vp: false }

const isInterval = (v: unknown): v is ChartInterval => CHART_INTERVALS.includes(v as ChartInterval)

/** 저장 문자열 → 설정(형식이 틀린 필드는 기본값) */
export function parseChartPrefs(raw: string | null): ChartPrefs {
  if (!raw) return DEFAULT_CHART_PREFS
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ChartPrefs, unknown>>
    return {
      interval: isInterval(v.interval) ? v.interval : null,
      ma: typeof v.ma === 'boolean' ? v.ma : DEFAULT_CHART_PREFS.ma,
      bb: typeof v.bb === 'boolean' ? v.bb : DEFAULT_CHART_PREFS.bb,
      vp: typeof v.vp === 'boolean' ? v.vp : DEFAULT_CHART_PREFS.vp,
    }
  } catch {
    return DEFAULT_CHART_PREFS
  }
}

export function loadChartPrefs(): ChartPrefs {
  try {
    return parseChartPrefs(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_CHART_PREFS
  }
}

export function saveChartPrefs(prefs: ChartPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장 실패는 무시(다음에 열면 기본값)
  }
}
