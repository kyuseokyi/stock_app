import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTheme, getThemeMetrics, listThemes } from '../api/marketAdmin'
import ThemeDetail, { THEME_SAVED_MESSAGE } from '../components/market/ThemeDetail'
import ThemeList, { type ThemeRow } from '../components/market/ThemeList'
import { apiErrorMessage } from '../lib/apiError'
import { showToast } from '../lib/toast'
import type { AdminTheme, ThemeMetrics } from '../types/marketAdmin'

type SortKey = 'rank' | 'chg_1d' | 'value' | 'stock_count' | 'name'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rank', label: '순위' },
  { key: 'chg_1d', label: '1일 등락' },
  { key: 'value', label: '거래대금' },
  { key: 'stock_count', label: '종목 수' },
  { key: 'name', label: '이름' },
]
const EMPTY_METRICS: ThemeMetrics = { as_of: null, themes: {} }
const NARROW = 1024 // 이 폭 미만이면 상세가 목록 아래에 열린다 → 스크롤해 보여준다

// 지표 없는 테마(숨김·종목 3개 미만)는 지표 정렬에서 항상 뒤로
const compare =
  (key: SortKey) =>
  (a: ThemeRow, b: ThemeRow): number => {
    if (key === 'name') return a.name.localeCompare(b.name, 'ko')
    if (key === 'stock_count') return b.stock_count - a.stock_count
    const av = a.metric?.[key] ?? null
    const bv = b.metric?.[key] ?? null
    if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1
    return key === 'rank' ? av - bv : bv - av
  }

export default function MarketThemes() {
  const [themes, setThemes] = useState<AdminTheme[]>([])
  const [metrics, setMetrics] = useState<ThemeMetrics>(EMPTY_METRICS)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('rank')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [list, m] = await Promise.all([listThemes(), getThemeMetrics().catch(() => EMPTY_METRICS)])
      setThemes(list)
      setMetrics(m)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (selectedId != null && window.innerWidth < NARROW) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedId])

  const rows = useMemo<ThemeRow[]>(() => {
    const q = query.trim().toLowerCase()
    return themes
      .filter((t) => showHidden || !t.is_hidden)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .map((t) => ({ ...t, metric: metrics.themes[String(t.id)] ?? null }))
      .sort(compare(sort))
  }, [themes, metrics, query, sort, showHidden])

  const selected = themes.find((t) => t.id === selectedId) ?? null

  const create = async () => {
    if (!newName.trim()) {
      showToast('테마 이름을 입력하세요', { icon: '⚠️' })
      return
    }
    setCreating(true)
    try {
      const t = await createTheme(newName.trim(), newDesc.trim() || null)
      setNewName('')
      setNewDesc('')
      showToast(THEME_SAVED_MESSAGE)
      await load()
      setSelectedId(t.id)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">테마 보정</h1>
        <p className="mt-1 text-sm text-slate-500">
          KIS 테마를 숨기거나 이름을 고치고, 종목을 추가·제외해요. 바꾼 내용은 웹 스크리너 테마 탭에 반영돼요.
          {metrics.as_of && ` · 지표 기준일 ${metrics.as_of}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          aria-label="테마 검색"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="테마 검색"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-56"
        />
        <select
          value={sort}
          aria-label="정렬"
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}순
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> 숨긴 테마 보기
        </label>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">＋ 새 테마 만들기</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={newName}
            aria-label="새 테마 이름"
            onChange={(e) => setNewName(e.target.value)}
            placeholder="테마 이름"
            maxLength={100}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-48"
          />
          <input
            value={newDesc}
            aria-label="새 테마 설명"
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="설명(선택)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={creating}
            onClick={() => void create()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            만들기
          </button>
        </div>
      </details>

      <div className={`grid grid-cols-1 gap-4 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}`}>
        <ThemeList rows={rows} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
        {selected && (
          <div ref={detailRef} className="min-w-0 scroll-mt-4">
            <ThemeDetail
              key={selected.id}
              theme={selected}
              onChanged={() => void load()}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
