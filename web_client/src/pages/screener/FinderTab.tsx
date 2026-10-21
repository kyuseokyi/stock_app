import { useEffect, useRef, useState } from 'react'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { chipClass } from '../../components/ui/Chip'
import FinderDetail from '../../components/finder/FinderDetail'
import FinderFilters from '../../components/finder/FinderFilters'
import FinderList from '../../components/finder/FinderList'
import { getFinderScreen } from '../../api/finder'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { DEFAULT_FINDER_FILTERS, FINDER_PAGE, FINDER_SORTS, PRESETS, activeFilterCount, sameFinderQuery } from '../../lib/finder'
import type { FinderItem, FinderPreset, FinderQuery } from '../../types/finder'

const INITIAL_QUERY: FinderQuery = { preset: null, sort: 'value', filters: DEFAULT_FINDER_FILTERS }

// 스크리너 '조건검색' 탭 — 프리셋 칩(하나만)·필터 패널·정렬 칩·목록(50개씩 더 보기). 넓은 화면은 오른쪽 상세, 좁은 화면은 행 펼침.
export default function FinderTab() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [query, setQuery] = useState<FinderQuery>(INITIAL_QUERY)
  const [panelOpen, setPanelOpen] = useState(false)
  const [date, setDate] = useState<string | null>(null)
  const [bbSigma, setBbSigma] = useState(2)
  const [items, setItems] = useState<FinderItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  // 요청 번호 — 조건을 바꾼 뒤 늦게 온 '더 보기' 응답이 새 목록에 붙지 않게
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false
    seq.current += 1
    setState('loading')
    setLoadingMore(false)
    setMoreFailed(false)
    getFinderScreen(query)
      .then((s) => {
        if (cancelled) return
        setDate(s.date)
        setBbSigma(s.bbSigma)
        setItems(s.items)
        setTotal(s.total)
        setSelected((cur) => (s.items.some((i) => i.ticker === cur) ? cur : null))
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [query, reloadKey])

  const update = (next: FinderQuery) => setQuery((cur) => (sameFinderQuery(cur, next) ? cur : next))
  const togglePreset = (p: FinderPreset) => update({ ...query, preset: query.preset === p ? null : p })

  const loadMore = () => {
    const id = seq.current
    setLoadingMore(true)
    setMoreFailed(false)
    getFinderScreen(query, items.length)
      .then((s) => {
        if (id !== seq.current) return
        setItems((cur) => {
          const seen = new Set(cur.map((x) => x.ticker))
          return [...cur, ...s.items.filter((x) => !seen.has(x.ticker))]
        })
      })
      .catch(() => {
        if (id === seq.current) setMoreFailed(true)
      })
      .finally(() => {
        if (id === seq.current) setLoadingMore(false)
      })
  }

  // 넓은 화면은 첫 종목을 오른쪽에 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shown = selected ?? (wide ? items[0]?.ticker ?? null : null)
  const shownItem = items.find((i) => i.ticker === shown) ?? null
  const onSelect = (ticker: string) => setSelected((cur) => (!wide && cur === ticker ? null : ticker))
  const preset = PRESETS.find((p) => p.key === query.preset)
  const filterCount = activeFilterCount(query.filters)

  return (
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">조건검색</h1>
        <p className="mt-0.5 text-sm text-ink-muted">자주 쓰는 조건(프리셋)이나 직접 고른 조건으로 종목을 찾습니다.</p>
      </div>

      <Card>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={query.preset === p.key}
              className={chipClass(query.preset === p.key)}
              onClick={() => togglePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-muted">{preset ? preset.description : '프리셋을 고르거나 필터로 조건을 정해 보세요.'}</p>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            aria-expanded={panelOpen}
            className={chipClass(panelOpen || filterCount > 0)}
            onClick={() => setPanelOpen((o) => !o)}
          >
            필터{filterCount > 0 ? ` ${filterCount}` : ''} {panelOpen ? '▲' : '▼'}
          </button>
          <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />
          {FINDER_SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={query.sort === s.key}
              className={chipClass(query.sort === s.key)}
              onClick={() => update({ ...query, sort: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
        {panelOpen && (
          <div className="mt-3 border-t border-line pt-3">
            <FinderFilters
              value={query.filters}
              onApply={(f) => {
                update({ ...query, filters: f })
                setPanelOpen(false)
              }}
            />
          </div>
        )}
      </Card>

      {state === 'failed' && (
        <Card>
          <EmptyState emoji="⚠️" title="목록을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." />
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mx-auto mt-2 block rounded-btn bg-fill px-4 py-2 text-sm font-medium text-ink"
          >
            다시 시도
          </button>
        </Card>
      )}
      {state === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="조건검색 데이터를 준비하고 있어요" description="매일 장 마감 후 계산돼요." /></Card>
      )}
      {state === 'ready' && date !== null && items.length === 0 && (
        <Card><EmptyState emoji="🔎" title="조건에 맞는 종목이 없어요" description="조건을 줄여 보세요." /></Card>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 종목</p>
            <FinderList
              items={items}
              selected={shown}
              onSelect={onSelect}
              renderInline={wide ? undefined : (it) => <FinderDetail item={it} bbSigma={bbSigma} date={date} />}
            />
            {moreFailed && (
              <p role="alert" className="mt-2 text-center text-xs text-up">더 불러오지 못했어요. 다시 눌러 주세요.</p>
            )}
            {items.length < total && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full rounded-btn bg-fill py-2.5 text-sm font-medium text-ink disabled:opacity-60"
              >
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(FINDER_PAGE, total - items.length)}개)`}
              </button>
            )}
          </Card>
          {wide && shownItem && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <FinderDetail item={shownItem} bbSigma={bbSigma} date={date} />
            </Card>
          )}
        </div>
      )}

      <p className="text-xs text-ink-muted">{date ?? '–'} 종가 기준 · 매일 20:30 갱신 · 투자 권유가 아닙니다</p>
    </div>
  )
}
