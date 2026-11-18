import type { MaMode, MaScreenerFilterInput, MaScreenerItem, MaSort } from '../api/maScreener'
import type { DatasetStatus } from '../types/marketAdmin'

// 5·20 정배열 스크리너 화면 상태(입력칸 문자열) → GraphQL 변수, 상태 판정, 배지 — UI 와 분리한 순수 함수

/** 최소~최대 입력칸(문자열 그대로 — 빈칸 = 조건 없음) */
export interface Range {
  min: string
  max: string
}

export interface MaFilters {
  mode: MaMode
  market: 'ALL' | 'KOSPI' | 'KOSDAQ'
  liquidOnly: boolean
  mcap: Range // 억 원
  value: Range // 억 원
  volume: Range // 만 주
  volRatioMin: string // 배
  chg: Range // %
  spread: Range // %
  sort: MaSort
}

const EMPTY: Range = { min: '', max: '' }

export const DEFAULT_MA_FILTERS: MaFilters = {
  mode: 'MA5_20',
  market: 'ALL',
  liquidOnly: true,
  mcap: EMPTY,
  value: EMPTY,
  volume: EMPTY,
  volRatioMin: '',
  chg: EMPTY,
  spread: EMPTY,
  sort: 'value',
}

export const MA_MODES: { key: MaMode; label: string; hint: string }[] = [
  { key: 'MA5_20', label: '📈 5·20 정배열 전체', hint: 'MA5 > MA20' },
  { key: 'CLOSE_MA5_20', label: '🔥 5일선 위 강세', hint: '종가 ≥ MA5 > MA20' },
  { key: 'PULLBACK_MA5_20', label: '🎯 5·20 눌림목', hint: 'MA5 > 종가 ≥ MA20' },
  { key: 'PERFECT', label: '👑 4선 완전 정배열', hint: 'MA5 > 20 > 50 > 120' },
]

export const MA_SORTS: { key: MaSort; label: string }[] = [
  { key: 'value', label: '거래대금순' },
  { key: 'chg', label: '등락률순' },
  { key: 'volume', label: '거래량순' },
  { key: 'vol_ratio', label: '거래량급증(20일비)순' },
  { key: 'mcap', label: '시가총액순' },
  { key: 'spread_5_20', label: '5·20 이격도순' },
]

/** 빠른 칩 — 범위 묶음(빈 문자열 = 제한 없음) */
export const QUICK = {
  mcap: [
    { label: '전체', range: EMPTY },
    { label: '500억↑', range: { min: '500', max: '' } },
    { label: '1,000억↑', range: { min: '1000', max: '' } },
    { label: '3,000억↑', range: { min: '3000', max: '' } },
    { label: '1조↑', range: { min: '10000', max: '' } },
  ],
  value: [
    { label: '전체', range: EMPTY },
    { label: '30억↑', range: { min: '30', max: '' } },
    { label: '100억↑', range: { min: '100', max: '' } },
    { label: '300억↑', range: { min: '300', max: '' } },
    { label: '1,000억↑', range: { min: '1000', max: '' } },
  ],
  chg: [
    { label: '전체', range: EMPTY },
    { label: '양봉(0%↑)', range: { min: '0', max: '' } },
    { label: '+3% ~ +15%', range: { min: '3', max: '15' } },
    { label: '보합·소폭(-2% ~ +5%)', range: { min: '-2', max: '5' } },
  ],
  spread: [
    { label: '전체', range: EMPTY },
    { label: '초입(0~3%)', range: { min: '0', max: '3' } },
    { label: '추세(3~10%)', range: { min: '3', max: '10' } },
  ],
} satisfies Record<string, { label: string; range: Range }[]>

export const VOL_RATIO_QUICK = [
  { label: '전체', value: '' },
  { label: '1.5배↑', value: '1.5' },
  { label: '2배↑', value: '2' },
  { label: '3배↑', value: '3' },
]

/** 입력칸 문자열 → 숫자(빈칸·숫자 아님은 undefined). allowNegative 가 아니면 음수도 버린다(서버도 무시) */
export function parseNum(s: string, allowNegative = false): number | undefined {
  const t = s.replace(/,/g, '').trim()
  if (t === '') return undefined
  const n = Number(t)
  if (!Number.isFinite(n) || (n < 0 && !allowNegative)) return undefined
  return n
}

export function sameRange(a: Range, b: Range): boolean {
  return a.min.trim() === b.min.trim() && a.max.trim() === b.max.trim()
}

/** 화면 상태 → screenerScreen filters 변수(빈 조건은 빼서 보낸다) */
export function toFilterInput(f: MaFilters): MaScreenerFilterInput {
  const out: MaScreenerFilterInput = { liquidOnly: f.liquidOnly, maOrder: f.mode }
  if (f.market !== 'ALL') out.market = f.market
  const put = (key: keyof MaScreenerFilterInput, s: string, neg = false) => {
    const n = parseNum(s, neg)
    if (n !== undefined) (out as unknown as Record<string, number>)[key] = n
  }
  put('mcapMin', f.mcap.min)
  put('mcapMax', f.mcap.max)
  put('valueMin', f.value.min)
  put('valueMax', f.value.max)
  put('volumeMin', f.volume.min)
  put('volumeMax', f.volume.max)
  put('volRatioMin', f.volRatioMin)
  put('chgMin', f.chg.min, true)
  put('chgMax', f.chg.max, true)
  put('ma5Ma20SpreadMin', f.spread.min, true)
  put('ma5Ma20SpreadMax', f.spread.max, true)
  return out
}

/** 기본값과 다른 필터 수(모드·정렬 제외) — 좁은 화면 '필터 · n개 적용' */
export function activeMaFilters(f: MaFilters): number {
  const d = DEFAULT_MA_FILTERS
  return [
    f.market !== d.market,
    f.liquidOnly !== d.liquidOnly,
    !sameRange(f.mcap, d.mcap),
    !sameRange(f.value, d.value),
    !sameRange(f.volume, d.volume),
    f.volRatioMin.trim() !== '',
    !sameRange(f.chg, d.chg),
    !sameRange(f.spread, d.spread),
  ].filter(Boolean).length
}

/** 종가 위치 배지 — 종가 ≥ MA5 = '5일선 위', MA20 ≤ 종가 < MA5 = '눌림목' */
export function positionBadge(it: Pick<MaScreenerItem, 'close' | 'ma5' | 'ma20'>): '5일선 위' | '눌림목' | null {
  if (it.ma5 === null || it.ma20 === null) return null
  if (it.close >= it.ma5) return '5일선 위'
  if (it.close >= it.ma20) return '눌림목'
  return null
}

/** 갱신 상태 — 계산일 없음 = empty, 데이터 현황 기준 거래일보다 이르면 stale */
export function datasetStatus(date: string | null, refDate: string | null): DatasetStatus {
  if (date === null) return 'empty'
  if (refDate !== null && date < refDate) return 'stale'
  return 'ok'
}

/** 원 → '1.2조' / '3,450억' */
export function formatEok(won: number | null): string {
  if (won === null) return '—'
  const eok = won / 1e8
  if (eok >= 10000) return `${(eok / 10000).toFixed(eok >= 100000 ? 0 : 1)}조`
  return `${Math.round(eok).toLocaleString('ko-KR')}억`
}

/** 주 → '12.3만주' */
export function formatManShares(shares: number | null): string {
  if (shares === null) return '—'
  const man = shares / 1e4
  return `${man >= 100 ? Math.round(man).toLocaleString('ko-KR') : man.toFixed(1)}만주`
}
