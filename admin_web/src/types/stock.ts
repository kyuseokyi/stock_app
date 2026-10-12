// stock_api GraphQL 응답 타입. 출처: backend/apps/stock_api/graphql/types.py
// Strawberry 기본 설정으로 snake_case 필드는 camelCase 로 노출된다.

export interface Stock {
  symbol: string
  name: string
  market: string // KOSPI/KOSDAQ/NASDAQ/NYSE/INDEX
  country: string // KR/US/GLOBAL
  currency: string // KRW/USD/PT
}

export interface Candle {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface BollingerBand {
  period: number
  stdDev: number
  mid: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
}

export interface VolumeProfileBin {
  priceLow: number
  priceHigh: number
  volume: number
}

/** 정배열(PERFECT) / 역배열(REVERSE) / 혼조(MIXED) — 백엔드는 str 이지만 이 3값만 반환 */
export type MaOrder = 'PERFECT' | 'REVERSE' | 'MIXED'

export interface ChartData {
  symbol: string
  name: string
  market: string
  currency: string
  candles: Candle[]
  ma5: (number | null)[]
  ma20: (number | null)[]
  ma50: (number | null)[]
  ma120: (number | null)[]
  maOrder: MaOrder
  bollinger: BollingerBand
  volumeProfile: VolumeProfileBin[]
}
