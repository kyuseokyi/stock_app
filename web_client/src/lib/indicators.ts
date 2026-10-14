// 게임 차트 보조지표(이동평균선·볼린저밴드) 순수 함수 — mobile lib/indicators.ts 와 같은 계산.
// 입력은 종가 배열(오래된 → 최신). 기간보다 앞 구간은 null(선이 그 지점부터 시작).

export const MA_PERIODS = [5, 20, 60] as const
export type MaPeriod = (typeof MA_PERIODS)[number]
export const BB_PERIOD = 20
export const BB_K = 2

/** 단순이동평균 — 직전 period 개 종가 평균 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

export interface Band {
  upper: number
  middle: number
  lower: number
}

/** 볼린저밴드 — 중심=SMA(period), 상·하단=중심 ± k×모표준편차(MTS 관례) */
export function bollinger(values: number[], period: number = BB_PERIOD, k: number = BB_K): (Band | null)[] {
  return sma(values, period).map((middle, i) => {
    if (middle === null) return null
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - middle) ** 2
    const sd = Math.sqrt(sq / period)
    return { upper: middle + k * sd, middle, lower: middle - k * sd }
  })
}
