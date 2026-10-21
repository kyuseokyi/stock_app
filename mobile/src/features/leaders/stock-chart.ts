// 종목 상세 일봉 차트 설정 — 게임 차트(TvChart·chart-bridge)를 그대로 쓰고 기간·가격선만 정한다.
import type { ChartLine } from '@/features/game/lib/chart-bridge';

/** 이동평균 기간 — 50일선 하나(첫째 칸 ma5 에 들어간다) */
export const STOCK_CHART_MA = [50] as const;
/** 첫 화면 일수 — 최근 1년 */
export const STOCK_CHART_VISIBLE_DAYS = 365;
/** 받아 올 일수 — 1년 + 50일선 워밍업(50거래일 ≈ 달력 75일) */
export const STOCK_CHART_LOOKBACK_DAYS = 440;
/** 50일선 색 — chart-page.ts 의 첫째 이동평균 칸(MA.ma5) 색과 같아야 범례가 맞는다 */
export const MA50_COLOR = '#14b8a6';

/** 52주 고점 점선(값 없으면 생략). 자동 범위에 넣어 화면 밖으로 사라지지 않게 한다 */
export function stockChartLines(high52w: number | null, color: string): ChartLine[] {
  if (high52w === null || !Number.isFinite(high52w)) return [];
  return [{ price: high52w, color, width: 1, dashed: true, title: '52주 고점', fit: 'day' }];
}
