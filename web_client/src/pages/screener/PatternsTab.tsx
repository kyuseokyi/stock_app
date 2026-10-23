import { useEffect, useRef, useState } from 'react'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { chipClass } from '../../components/ui/Chip'
import PatternDetail from '../../components/patterns/PatternDetail'
import PatternList from '../../components/patterns/PatternList'
import { getPatternScreen } from '../../api/patterns'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { PATTERN_KINDS, PATTERN_MARKETS, PATTERN_PAGE, PATTERN_REPORTS, PATTERN_SORTS } from '../../lib/patterns'
import type { PatternItem, PatternQuery } from '../../types/patterns'
import PageHeader from '../../components/ui/PageHeader'
import ScrollRow from '../../components/ui/ScrollRow'
import FilterPanel from '../../components/ui/FilterPanel'
import { ListSkeleton } from '../../components/ui/Skeleton'
import Button from '../../components/ui/Button'

const INITIAL_QUERY: PatternQuery = { report: 'forming', patternType: null, market: 'ALL', sort: 'pivot_dist' }

// 스크리너 '패턴' 탭 — 리포트·패턴·시장·정렬 칩 + 목록(50개씩 더 보기). 넓은 화면은 오른쪽 상세, 좁은 화면은 행 펼침.
export default function PatternsTab() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [query, setQuery] = useState<PatternQuery>(INITIAL_QUERY)
  const [date, setDate] = useState<string | null>(null)
  const [items, setItems] = useState<PatternItem[]>([])
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
    getPatternScreen(query)
      .then((s) => {
        if (cancelled) return
        setDate(s.date)
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

  const update = (patch: Partial<PatternQuery>) => setQuery((cur) => ({ ...cur, ...patch }))

  const loadMore = () => {
    const id = seq.current
    setLoadingMore(true)
    setMoreFailed(false)
    getPatternScreen(query, items.length)
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

  const shown = selected ?? (wide ? items[0]?.ticker ?? null : null)
  const shownItem = items.find((i) => i.ticker === shown) ?? null
  const onSelect = (ticker: string) => setSelected((cur) => (!wide && cur === ticker ? null : ticker))
  const report = PATTERN_REPORTS.find((r) => r.key === query.report)

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader title="차트 패턴" description="컵·쌍바닥·플랫 베이스 같은 돌파 전후 패턴을 찾아요." />

      <Card>
        <ScrollRow role="group" aria-label="리포트">
          {PATTERN_REPORTS.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={query.report === r.key}
              className={chipClass(query.report === r.key)}
              onClick={() => update({ report: r.key })}
            >
              {r.label}
            </button>
          ))}
        </ScrollRow>
        <p className="mt-2 text-sm text-ink-muted">{report?.description}</p>
        <details className="group mt-1 text-sm">
          <summary className="-my-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-brand-strong">
            용어 설명
            <span aria-hidden className="inline-block text-xs transition group-open:rotate-180">▾</span>
          </summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-field bg-fill/60 p-3 text-ink">
            <dt className="font-semibold">베이스</dt>
            <dd className="text-ink-muted">주가가 오른 뒤 쉬어 가며 만드는 횡보 구간이에요.</dd>
            <dt className="font-semibold">피벗</dt>
            <dd className="text-ink-muted">베이스를 벗어나는지 보는 기준 가격이에요. 종가가 이 가격을 넘으면 돌파로 봐요.</dd>
            <dt className="font-semibold">깊이</dt>
            <dd className="text-ink-muted">베이스 고점에서 가장 많이 내려간 폭이에요.</dd>
            <dt className="font-semibold">길이</dt>
            <dd className="text-ink-muted">베이스가 이어진 거래일 수예요.</dd>
            <dt className="font-semibold">단계</dt>
            <dd className="text-ink-muted">
              상승 흐름에서 몇 번째 베이스인지예요. 앞 베이스보다 피벗이 20% 넘게 오르면 한 단계 올라가고, 덜 오르면 같은 단계에 a·b를 붙여요.
            </dd>
          </dl>
        </details>
        <FilterPanel activeCount={(query.patternType !== INITIAL_QUERY.patternType ? 1 : 0) + (query.market !== INITIAL_QUERY.market ? 1 : 0) + (query.sort !== INITIAL_QUERY.sort ? 1 : 0)}>
        <ScrollRow role="group" aria-label="패턴 종류" className="mt-1 sm:mt-3">
          {PATTERN_KINDS.map((k) => (
            <button
              key={k.key ?? 'all'}
              type="button"
              aria-pressed={query.patternType === k.key}
              className={chipClass(query.patternType === k.key)}
              onClick={() => update({ patternType: k.key })}
            >
              {k.label}
            </button>
          ))}
        </ScrollRow>
        <ScrollRow role="group" aria-label="시장과 정렬" className="mt-3 items-center">
          {PATTERN_MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={query.market === m.key}
              className={chipClass(query.market === m.key)}
              onClick={() => update({ market: m.key })}
            >
              {m.label}
            </button>
          ))}
          <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />
          {PATTERN_SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={query.sort === s.key}
              className={chipClass(query.sort === s.key)}
              onClick={() => update({ sort: s.key })}
            >
              {s.label}
            </button>
          ))}
        </ScrollRow>
        </FilterPanel>
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
      {state === 'loading' && <ListSkeleton />}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="패턴 데이터를 준비하고 있어요" description="매일 장 마감 후 계산돼요." /></Card>
      )}
      {state === 'ready' && date !== null && items.length === 0 && (
        <Card><EmptyState emoji="🔎" title="조건에 맞는 종목이 없어요" description="리포트나 패턴을 바꿔 보세요." /></Card>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 종목</p>
            <PatternList
              items={items}
              selected={shown}
              onSelect={onSelect}
              renderInline={wide ? undefined : (it) => <PatternDetail key={it.ticker} item={it} />}
            />
            {moreFailed && (
              <p role="alert" className="mt-2 text-center text-xs text-danger">더 불러오지 못했어요. 다시 눌러 주세요.</p>
            )}
            {items.length < total && (
              <Button variant="tertiary" full className="mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(PATTERN_PAGE, total - items.length)}개)`}
              </Button>
            )}
          </Card>
          {wide && shownItem && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <PatternDetail key={shownItem.ticker} item={shownItem} />
            </Card>
          )}
        </div>
      )}

      <p className="text-xs text-ink-muted">
        {date ?? '–'} 종가 기준 · 매일 20:30 갱신 · 패턴 판정은 참고용이며 투자 권유가 아니에요
      </p>
    </div>
  )
}
