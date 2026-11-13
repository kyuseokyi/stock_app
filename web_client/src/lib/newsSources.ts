// AI 요약 근거 기사(sources) — 순수 함수(테스트 대상). 앱 features/ai-sources/sources 와 같은 규칙.
// 서버 모양: [{ title, url, pub_date(ISO | null) }] 최대 3개. 옛 응답에는 필드가 없을 수 있어 항상 배열로 맞춘다.

export interface NewsSource {
  title: string
  url: string
  /** ISO 문자열, 없으면 null */
  pubDate: string | null
}

export const MAX_SOURCES = 3

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** http(s) 주소만 링크로 — javascript: 같은 다른 스킴은 버린다 */
const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

/** 응답의 sources → 제목·주소가 온전한 항목만, 최대 3개(없거나 배열이 아니면 []) */
export function normalizeSources(raw: unknown): NewsSource[] {
  if (!Array.isArray(raw)) return []
  const out: NewsSource[] = []
  for (const x of raw) {
    if (!isObj(x)) continue
    const title = str(x.title)
    const url = str(x.url)
    if (!title || !isWebUrl(url)) continue
    out.push({ title, url, pubDate: str(x.pub_date) || null })
    if (out.length >= MAX_SOURCES) break
  }
  return out
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 기사 날짜 → KST 기준 "M.D"(예: 11.13). 없거나 잘못된 값이면 '' */
export function formatSourceDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const kst = new Date(t + KST_OFFSET_MS)
  return `${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`
}
