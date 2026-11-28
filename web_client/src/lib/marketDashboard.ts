import type { MacroValue, MarketIndex } from '../types/market'
import type { FlowSource, InvestorFlow, Mover, Movers } from '../types/marketRest'

// 마켓 개요 표시용 순수 함수 — 기준 시각·장운영 뱃지·억 단위·지수 분류(앱 market/dashboard.ts 와 같은 규칙·문구).

const KST_OFFSET_MS = 9 * 3_600_000
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 시각 문자열 → epoch(ms). 실패하면 null.
 * - 오프셋 있는 ISO('…+09:00'·'…Z')는 그대로 해석
 * - 오프셋 없는 'YYYY-MM-DDTHH:MM[:SS]'(또는 공백 구분)는 이미 KST 로 본다(브라우저 시간대에 휘둘리지 않게)
 */
export function parseKst(s: string | null | undefined): number | null {
  if (!s) return null
  const t = s.trim()
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(t)
  if (naive) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = naive
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - KST_OFFSET_MS
  }
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

/** 시각 → '10.30 15:30 기준' (KST). 읽을 수 없으면 null */
export function formatBasis(s: string | null | undefined): string | null {
  const ms = parseKst(s)
  if (ms == null) return null
  const d = new Date(ms + KST_OFFSET_MS)
  return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} 기준`
}

/** 'YYYY-MM-DD' → '10.30' (모양이 다르면 받은 그대로) */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[1]}.${m[2]}` : iso
}

/** 브리핑 배지·창 제목 — 토요일 날짜면 주간 마감 브리핑(백엔드가 토요일 행으로 저장, 응답에 따로 구분 값이 없다) */
export function briefLabel(iso: string | null | undefined): { badge: string; title: string } {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  // 날짜만 있는 값 — UTC 로 요일을 구해 기기 시간대에 따라 하루 밀리지 않게
  const saturday = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() === 6 : false
  return saturday
    ? { badge: 'AI 주간 마감 브리핑', title: 'AI 주간 마감 브리핑' }
    : { badge: 'AI 장전 브리핑 (08:30)', title: 'AI 장전 브리핑' }
}

type IndexClock = Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>
const HHMM = /^\d{2}:\d{2}$/

/**
 * 헤더 기준 시각 — 섹션마다 기준이 달라 '국내 지수' 기준임을 문구로 밝힌다.
 * 장중: '지수 장중 14:32 기준'(시각을 모르면 '지수 장중') · 확정: '지수 10.30 15:30 기준' · 국내 지수 없음: null
 */
export function indexHeaderBasis(indices: IndexClock[]): string | null {
  const kr = indices.filter((ix) => ix.region === 'KR')
  if (kr.some((ix) => ix.live)) {
    const times = kr.filter((ix) => ix.live && ix.asOf && HHMM.test(ix.asOf)).map((ix) => ix.asOf as string).sort()
    return times.length > 0 ? `지수 장중 ${times[times.length - 1]} 기준` : '지수 장중'
  }
  const latest = kr.map((ix) => ix.date.slice(0, 10)).filter(Boolean).sort().pop()
  return latest ? `지수 ${formatShortDate(latest)} 15:30 기준` : null
}

export type MarketSession = '정규장' | '장 시작 전' | '장마감'

/**
 * 장운영 뱃지 — 국내 지수가 장중 값(live)이면 정규장, 아니면 평일 09:00 전은 '장 시작 전', 그 밖은 장마감.
 * 국내 지수가 하나도 없으면(개요 미수신) null — 잘못된 '장마감' 표시를 막는다.
 */
export function marketSession(indices: Pick<MarketIndex, 'region' | 'live'>[], now: Date = new Date()): MarketSession | null {
  const kr = indices.filter((i) => i.region === 'KR')
  if (kr.length === 0) return null
  if (kr.some((i) => i.live)) return '정규장'
  const k = new Date(now.getTime() + KST_OFFSET_MS)
  const dow = k.getUTCDay()
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes()
  if (dow >= 1 && dow <= 5 && minutes < 9 * 60) return '장 시작 전'
  return '장마감'
}

const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * 순매수 금액(원) → 부호 붙은 억 단위: '+1,234억' · '-56억' · '+0.3억' · '+1.2조'.
 * 1억 미만은 소수 한 자리, 1조 이상은 조 단위 소수 한 자리. 0 은 '0억'.
 */
export function formatEok(won: number): string {
  const eok = won / 1e8
  const sign = eok > 0 ? '+' : eok < 0 ? '-' : ''
  const a = Math.abs(eok)
  if (Math.round(a) >= 10_000) return `${sign}${(a / 10_000).toFixed(1)}조`
  if (a >= 0.95) return `${sign}${comma(Math.round(a))}억`
  const r = Math.round(a * 10) / 10
  return r === 0 ? '0억' : `${sign}${r.toFixed(1)}억`
}

const FLOW_SOURCE_LABEL: Record<FlowSource, string> = { kiwoom: '키움', pykrx: 'KRX(pykrx)', kis: 'KIS' }

/** 수급 전광판 캡션 — '10.30 기준 · 출처 KRX(pykrx)'. 둘 다 없으면 null */
export function flowCaption(flow: Pick<InvestorFlow, 'date' | 'source'>): string | null {
  const parts = [
    flow.date ? `${formatShortDate(flow.date)} 기준` : null,
    flow.source ? `출처 ${FLOW_SOURCE_LABEL[flow.source]}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 수급에 보여 줄 게 하나라도 있는가 */
export const hasFlowData = (f: InvestorFlow): boolean =>
  f.foreignTop.length + f.institutionTop.length + f.pensionTop.length + f.doubleBuy.length > 0

// 맨 위 지수 카드 — 국내 2·미국 3(앱 캐러셀 순서). 원/달러는 오르는 게 좋은 일이 아니라 회색으로 보여 주는 돈의 흐름 쪽에 둔다.
const HEADLINE_CODES = ['KR:0001', 'KR:1001', 'US:COMP', 'US:SPX', 'US:SOX']
const FLOW_CODES = ['FX:USDKRW', 'US:VIX']
const RATE_SERIES = ['DGS10', 'DGS2']

/** 개요 데이터 나누기 — 처음 보는 코드도 버리지 않고 '그 밖의 지수'나 '돈의 흐름' 끝에 붙인다 */
export function splitOverview(indices: MarketIndex[], macro: MacroValue[]) {
  const pick = (codes: string[]) => codes.flatMap((c) => indices.filter((i) => i.code === c))
  const isFlowExtra = (i: MarketIndex) => !FLOW_CODES.includes(i.code) && i.region !== 'KR' && i.region !== 'US'
  return {
    headline: pick(HEADLINE_CODES),
    flow: [...pick(FLOW_CODES), ...indices.filter(isFlowExtra)],
    others: indices.filter((i) => !HEADLINE_CODES.includes(i.code) && !FLOW_CODES.includes(i.code) && !isFlowExtra(i)),
    rates: RATE_SERIES.flatMap((s) => macro.filter((m) => m.seriesId === s)),
    // 한국은행 ECOS 원/달러(ECOS:USDKRW)는 홈 '오늘 시장 참고' 전용 — '미국 경제지표' 칸에 섞지 않는다(시장 탭은 그대로)
    otherMacro: macro.filter((m) => !RATE_SERIES.includes(m.seriesId) && !m.seriesId.startsWith('ECOS:')),
  }
}

/** 핫 키워드의 티커를 이름으로 보여 주기 위한 표 — 급등락·수급에서 모은다(모르는 티커는 코드 그대로) */
export function tickerNames(movers: Movers | null, flow: InvestorFlow | null): Map<string, string> {
  const m = new Map<string, string>()
  for (const x of [...(movers?.gainers ?? []), ...(movers?.losers ?? [])]) m.set(x.ticker, x.stockName)
  for (const x of [...(flow?.foreignTop ?? []), ...(flow?.institutionTop ?? []), ...(flow?.pensionTop ?? []), ...(flow?.doubleBuy ?? [])]) {
    m.set(x.ticker, x.name)
  }
  return m
}

/**
 * 급등락 카드 제목 — AI 원인이 하나라도 있을 때만 '& AI 원인'(앱 moversTitle 과 같은 규칙).
 * 네이버 약관(2026-09-07 시행)으로 서버가 원인 분석을 기본 꺼 두므로, 원인이 없을 때 제목만 남는 빈 약속을 막는다.
 */
export function moversTitle(gainers: Mover[], losers: Mover[]): string {
  return [...gainers, ...losers].some((m) => m.reasonSummary) ? '급등락 & AI 원인' : '급등락'
}
