// 종목 대차잔고 추이(stock_api REST GET /api/v1/stocks/{ticker}/lending) — 모바일 features/leaders/lending.ts 와 같은 모양.
export interface LendingPoint {
  date: string // YYYY-MM-DD
  balanceQty: number // 대차잔고(주)
  netQty: number // 그날 증감(주, 상환이 많으면 음수)
  balanceAmt: number // 잔고금액(원)
}

export interface LendingBar {
  x: number
  y: number
  w: number
  h: number
  up: boolean
}

export interface LendingView {
  first: LendingPoint
  last: LendingPoint
  /** 기간 첫날 대비 마지막 날 잔고 증감률(%) — 첫날 잔고가 0이면 null */
  chgPct: number | null
  /** 잔고 선(svg polyline points) */
  line: string
  /** 일별 증감 막대 */
  bars: LendingBar[]
  /** 막대 0 기준선 y */
  zeroY: number
  width: number
  height: number
}
