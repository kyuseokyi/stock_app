// web_client/src/lib/indicators.ts 복사본 — 원본과 같이 고칠 것 (주도주 차트가 쓰는 sma 만)
// 입력은 종가 배열(오래된 → 최신). 기간보다 앞 구간은 null(선이 그 지점부터 시작).

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
