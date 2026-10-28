// web_client/src/types/game.ts 복사본 — 원본과 같이 고칠 것 (일봉 차트가 쓰는 DailyCandle 만)

/** stock_api getChartData.candles (date = 'YYYY-MM-DD') */
export interface DailyCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  /** 거래량 — 매물대용. 당일 세션 봉·틱 병합 봉에는 없을 수 있다 */
  volume?: number
}
