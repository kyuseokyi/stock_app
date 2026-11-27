import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getMarketStatus } from '../api/marketAdmin'
import { MA_PAGE_SIZE, getMaScreener, getScreenerDataset, type MaScreenerItem } from '../api/maScreener'
import DatasetCard from '../components/market/DatasetCard'
import MaScreenerDetail from '../components/maScreener/MaScreenerDetail'
import MaScreenerFilters from '../components/maScreener/MaScreenerFilters'
import Button from '../leaders/components/ui/Button'
import Card from '../leaders/components/ui/Card'
import { chipClass } from '../leaders/components/ui/Chip'
import EmptyState from '../leaders/components/ui/EmptyState'
import FilterPanel from '../leaders/components/ui/FilterPanel'
import PageHeader from '../leaders/components/ui/PageHeader'
import { ListSkeleton } from '../leaders/components/ui/Skeleton'
import StockRow from '../leaders/components/screener/StockRow'
import { useMediaQuery } from '../leaders/hooks/useMediaQuery'
import { screenerQueries } from '../queries/screenerQueries'
import { formatPct, formatPrice } from '../leaders/lib/format'
import {
  DEFAULT_MA_FILTERS, MA_MODES, activeMaFilters, datasetStatus, formatEok, formatManShares, positionBadge,
  toFilterInput, type MaFilters,
} from '../lib/maScreener'
import type { Dataset } from '../types/marketAdmin'

// 관리자 전용 '5·20 정배열 스크리너' — 공용 GraphQL screenerScreen(preset ma5_20 + 배열 모드)을 쓴다.
// 사용자 웹·앱 스크리너 화면에는 노출하지 않는다(설계: docs/admin_ma5_20_screener_spec_and_plan.md).
export default function MarketMaScreener() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [filters, setFilters] = useState<MaFilters>(DEFAULT_MA_FILTERS)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const input = useMemo(() => toFilterInput(filters), [filters])
  // 첫 쪽은 Query, '더 보기'로 이어 붙인 쪽은 조건 키에 묶어 화면이 들고 있다(조건이 바뀌면 비운다)
  const firstPage = useQuery(screenerQueries.maScreener(input, filters.sort))
  const condKey = JSON.stringify([input, filters.sort])
  const [more, setMore] = useState<{ key: string; items: MaScreenerItem[] }>({ key: condKey, items: [] })
  if (more.key !== condKey) setMore({ key: condKey, items: [] })
  // 새로 받으면 고른 종목이 새 목록에 없을 때 닫는다(지금 동작)
  const [last, setLast] = useState(firstPage.data)
  if (firstPage.data !== undefined && firstPage.data !== last) {
    const next = firstPage.data
    setLast(next)
    setSelected((cur) => (next.items.some((i) => i.ticker === cur) ? cur : null))
  }
  const date = last?.date ?? null
  const total = firstPage.data?.total ?? 0
  const items = firstPage.data ? (more.key === condKey ? [...firstPage.data.items, ...more.items] : firstPage.data.items) : []
  const state: 'loading' | 'ready' | 'failed' = firstPage.isPending ? 'loading' : firstPage.isError ? 'failed' : 'ready'

  // 넓은 화면은 첫 종목을 오른쪽에 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shownTicker = selected ?? (wide ? items[0]?.ticker ?? null : null)
  const shown = items.find((i) => i.ticker === shownTicker) ?? null

  const loadMore = () => {
    const key = condKey
    setLoadingMore(true)
    getMaScreener(input, filters.sort, items.length)
      // 조건이 바뀐 뒤 늦게 온 응답은 새 목록에 붙이지 않는다
      .then((r) => setMore((m) => (m.key === key ? { key, items: [...m.items, ...r.items] } : m)))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }

  const onSelect = (ticker: string) => setSelected((cur) => (!wide && cur === ticker ? null : ticker))

  return (
    <div className="space-y-3 break-keep sm:space-y-4">
      <PageHeader
        title="5·20 정배열 스크리너"
        description="5일선이 20일선 위에 있는 종목을 시가총액·거래대금·거래량·등락률로 좁혀 봐요. 매일 장 마감 후 계산된 조건검색 데이터를 써요. 관리자 전용 화면이에요."
      />
      <ScreenerDatasetStatus />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="정배열 모드">
        {MA_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.hint}
            aria-pressed={filters.mode === m.key}
            className={chipClass(filters.mode === m.key)}
            onClick={() => setFilters((f) => ({ ...f, mode: m.key }))}
          >
            {m.label} <span className="ml-1 text-xs opacity-70">({m.hint})</span>
          </button>
        ))}
      </div>

      <Card>
        <FilterPanel activeCount={activeMaFilters(filters)}>
          <MaScreenerFilters value={filters} onChange={setFilters} />
        </FilterPanel>
        {activeMaFilters(filters) > 0 && (
          <button type="button" className="mt-1 text-sm font-medium text-brand-strong" onClick={() => setFilters((f) => ({ ...DEFAULT_MA_FILTERS, mode: f.mode, sort: f.sort }))}>
            필터 초기화
          </button>
        )}
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="목록을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <ListSkeleton />}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="조건검색 데이터를 준비하고 있어요" description="매일 장 마감 후 계산돼요. 데이터 현황에서 '조건검색 계산'을 실행할 수 있어요." /></Card>
      )}
      {state === 'ready' && date !== null && items.length === 0 && (
        <Card><EmptyState emoji="🔎" title="조건에 맞는 종목이 없어요" description="필터 범위를 넓혀 보세요." /></Card>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{date} 종가 기준 · {total.toLocaleString('ko-KR')}개 종목</p>
            <ul className="divide-y divide-slate-100">
              {items.map((it) => (
                <MaRow
                  key={it.ticker}
                  item={it}
                  active={it.ticker === shownTicker}
                  expandable={!wide}
                  onSelect={() => onSelect(it.ticker)}
                />
              ))}
            </ul>
            {items.length < total && (
              <Button variant="tertiary" full className="mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(MA_PAGE_SIZE, total - items.length)}개)`}
              </Button>
            )}
          </Card>
          {wide && shown && (
            // 관리자 상단 바(약 57px) 아래에 붙는다
            <Card as="aside" className="lg:sticky lg:top-20">
              <MaScreenerDetail item={shown} />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function MaRow({ item, active, expandable, onSelect }: { item: MaScreenerItem; active: boolean; expandable: boolean; onSelect: () => void }) {
  const badge = positionBadge(item)
  const chg = item.chg1d
  return (
    <StockRow
      name={item.name}
      ticker={item.ticker}
      active={active}
      expandable={expandable}
      onSelect={onSelect}
      meta={
        <>
          <span className="text-xs text-ink-muted">{[item.market, item.sectorName].filter(Boolean).join(' · ')}</span>
          {item.ma5Ma20SpreadPct !== null && (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">5·20 {formatPct(item.ma5Ma20SpreadPct)}</span>
          )}
          {badge && (
            <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${badge === '5일선 위' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{badge}</span>
          )}
          <span className="w-full text-xs tabular-nums text-ink-muted">
            MA5 {item.ma5 === null ? '—' : formatPrice(item.ma5)} · MA20 {item.ma20 === null ? '—' : formatPrice(item.ma20)}
            {' · '}대금 {formatEok(item.value)} · 거래량 {formatManShares(item.volume)}
            {item.volRatio20 !== null && ` (${item.volRatio20.toFixed(1)}x)`} · 시총 {formatEok(item.mcap)}
          </span>
        </>
      }
      aside={[
        <span className="tabular-nums">{formatPrice(item.close)}</span>,
        chg === null ? null : (
          <span className={`tabular-nums ${chg > 0 ? 'text-up' : chg < 0 ? 'text-down' : 'text-ink-muted'}`}>{formatPct(chg)}</span>
        ),
      ]}
      inline={expandable && active ? <MaScreenerDetail item={item} /> : undefined}
    />
  )
}

// 상단 갱신 현황 — 조건검색(screener_daily) 최신 기준일·전체 종목 수 + 데이터 현황의 기준 거래일과 비교한 정상/오래됨.
// 데이터 현황(GET /admin/market/status)에는 조건검색 항목이 없어 공개 GraphQL 로 직접 센다. 실패해도 아래 화면은 그대로.
function ScreenerDatasetStatus() {
  const [data, setData] = useState<Dataset | null | 'failed'>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getScreenerDataset(), getMarketStatus().then((r) => r.ref_date).catch(() => null)])
      .then(([ds, refDate]) => {
        if (cancelled) return
        const status = datasetStatus(ds.date, refDate)
        setData({
          key: 'screener',
          label: '조건검색(정규장 마감 데이터)',
          latest: ds.date ? `${ds.date} 종가 기준` : null,
          count: ds.date ? ds.total : null,
          unit: '종목',
          status,
          note: status === 'stale' ? `기준 거래일 ${refDate} 보다 오래됐어요` : status === 'empty' ? '아직 계산된 데이터가 없어요' : '',
        })
      })
      .catch(() => !cancelled && setData('failed'))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <div className="min-w-0 flex-1">
        {data === null && <div className="h-[104px] animate-pulse rounded-xl border border-slate-200 bg-white" aria-hidden />}
        {data === 'failed' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            조건검색 갱신 상태를 불러오지 못했어요. 아래 화면은 그대로 볼 수 있어요.
          </div>
        )}
        {data !== null && data !== 'failed' && <DatasetCard data={data} />}
      </div>
      <Link
        to="/market/status"
        className="flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-indigo-600 hover:bg-slate-50"
      >
        수집 현황에서 재계산 →
      </Link>
    </div>
  )
}
