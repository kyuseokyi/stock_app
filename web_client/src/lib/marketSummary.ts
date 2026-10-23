import { formatPct } from './format'
import type { GroupItem, MarketIndex } from '../types/market'

// 홈 '오늘 시장 노트' — 받은 숫자만으로 제목·한 줄 요약을 만든다(서버·AI 없음, 지어내지 않음).

const KOSPI = 'KR:0001'
const KOSDAQ = 'KR:1001'

/** 홈에 올릴 지수 3개 — 코스피·코스닥·원/달러(FX 첫 항목). 없는 것은 건너뛴다 */
export function noteIndices(indices: MarketIndex[]): MarketIndex[] {
  const pick = [
    indices.find((i) => i.code === KOSPI),
    indices.find((i) => i.code === KOSDAQ),
    indices.find((i) => i.region === 'FX'),
  ]
  return pick.filter((i): i is MarketIndex => i != null)
}

/** '2026-10-22' → '10월 22일 장 마감 노트' / 장중이면 '10월 23일 장중 노트 · 14:20' */
export function noteTitle(indices: MarketIndex[]): string | null {
  const k = indices.find((i) => i.code === KOSPI) ?? indices.find((i) => i.region === 'KR')
  if (!k) return null
  const [, m, d] = k.date.split('-').map(Number)
  if (!m || !d) return null
  return k.live ? `${m}월 ${d}일 장중 노트${k.asOf ? ` · ${k.asOf}` : ''}` : `${m}월 ${d}일 장 마감 노트`
}

const FLAT_BAND = 0.3 // ±0.3% 안은 '보합'

/** 한 줄 요약 — '코스피 -3.5%·코스닥 -3.6%로 내린 하루, 난방기·슈퍼박테리아 테마는 올랐어요' */
export function noteSummary(indices: MarketIndex[], themes: GroupItem[]): string | null {
  const k = indices.find((i) => i.code === KOSPI)?.chg1d ?? null
  const q = indices.find((i) => i.code === KOSDAQ)?.chg1d ?? null
  const parts = [k != null && `코스피 ${formatPct(k)}`, q != null && `코스닥 ${formatPct(q)}`].filter(Boolean)
  if (parts.length === 0) return null
  const known = [k, q].filter((v): v is number => v != null)
  const avg = known.reduce((a, b) => a + b, 0) / known.length
  const mood = avg > FLAT_BAND ? '오른' : avg < -FLAT_BAND ? '내린' : '보합으로 끝난'
  const lead = `${parts.join('·')}로 ${mood} 하루`

  const risers = themes.filter((t) => t.chg != null && Math.round(t.chg * 10) / 10 > 0).slice(0, 2).map((t) => t.name)
  if (risers.length === 0) return `${lead}, 오른 테마가 드물었어요`
  const names = risers.join('·')
  return avg < -FLAT_BAND ? `${lead}, ${names} 테마는 올랐어요` : `${lead}, ${names} 테마가 앞장섰어요`
}
