// 게임 차트 마지막 설정(단위·보조지표) 저장값 — 순수 함수(저장소 접근은 DailyChart 가 SecureStore 로).
// 우선순위: 저장값 > 관리자 기본 단위(/rules) > 일봉. web_client src/lib/chartPrefs.ts 와 같은 형식.
import type { ChartInterval } from '../types';
import { isChartInterval } from './intraday';

export const CHART_PREFS_KEY = 'game.chartPrefs.v1';

export type ChartPrefs = {
  /** 사용자가 마지막으로 고른 단위(고른 적 없으면 null → 관리자 기본값) */
  interval: ChartInterval | null;
  ma: boolean;
  bb: boolean;
  /** 매물대(보이는 구간 가격대별 거래량) */
  vp: boolean;
};

export const DEFAULT_CHART_PREFS: ChartPrefs = { interval: null, ma: true, bb: false, vp: false };

/** 저장 문자열 → 설정(형식이 틀린 필드는 기본값) */
export function parseChartPrefs(raw: string | null): ChartPrefs {
  if (!raw) return DEFAULT_CHART_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ChartPrefs, unknown>>;
    return {
      interval: isChartInterval(v.interval) ? v.interval : null,
      ma: typeof v.ma === 'boolean' ? v.ma : DEFAULT_CHART_PREFS.ma,
      bb: typeof v.bb === 'boolean' ? v.bb : DEFAULT_CHART_PREFS.bb,
      vp: typeof v.vp === 'boolean' ? v.vp : DEFAULT_CHART_PREFS.vp,
    };
  } catch {
    return DEFAULT_CHART_PREFS;
  }
}

export const serializeChartPrefs = (prefs: ChartPrefs): string => JSON.stringify(prefs);
