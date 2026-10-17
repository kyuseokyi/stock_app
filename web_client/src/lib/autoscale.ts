import type { AutoscaleInfo } from 'lightweight-charts'

/**
 * 캔들 시리즈 자동 범위(autoscaleInfoProvider)를 가격선까지 넓힌다(원본 불변).
 * lightweight-charts 4 의 createPriceLine 은 자동 범위에 들어가지 않아, 범위 밖 지지·저항선이 화면에서 사라진다.
 * 보이는 캔들이 없으면(info=null) 그대로 null — 가격선만으로 범위를 만들지 않는다.
 */
export function widenRange(info: AutoscaleInfo | null, prices: readonly number[]): AutoscaleInfo | null {
  if (!info || !info.priceRange) return info
  const valid = prices.filter(Number.isFinite)
  if (valid.length === 0) return info
  return {
    ...info,
    priceRange: {
      minValue: Math.min(info.priceRange.minValue, ...valid),
      maxValue: Math.max(info.priceRange.maxValue, ...valid),
    },
  }
}
