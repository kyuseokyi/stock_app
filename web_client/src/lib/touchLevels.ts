// 마지막 캔들이 닿은(터치·관통) 지표 레벨 — 그 가격에 가로선을 긋는다(설계 2026-10-27 chart-game-sr-trendlines §7-3).
// 지표 = 켜진 매물대 POC·이동평균·볼린저 선의 마지막 캔들 값. 닿음 = 고가~저가(± 오차)가 레벨을 포함.
// 앱 features/game/lib/touch-levels.ts 와 같은 코드.
import { roundToTick } from './krxTick'
import { srEps } from './srWatch'

export interface IndicatorLevel {
  id: string // 'poc' | 'ma5' | 'bbUpper' …
  name: string // 범례 이름
  price: number
  color: string
}

/** 마지막 캔들의 고가~저가(± 오차 = max(호가, 0.15%)) 안에 든 레벨만, 입력 순서대로.
 * 호가 반올림 가격이 같으면 먼저 온 것 하나(BB 중심 = 20일선이라 같은 선이 두 번 그어지지 않게) */
export function touchedLevels(last: { high: number; low: number }, levels: IndicatorLevel[]): IndicatorLevel[] {
  const seen = new Set<number>()
  return levels.filter((lv) => {
    if (!Number.isFinite(lv.price) || lv.price <= 0) return false
    const eps = srEps(lv.price)
    if (lv.price < last.low - eps || lv.price > last.high + eps) return false
    const key = roundToTick(lv.price)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
