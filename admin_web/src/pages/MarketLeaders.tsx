import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMarketStatus } from '../api/marketAdmin'
import DatasetCard from '../components/market/DatasetCard'
import type { Dataset } from '../types/marketAdmin'
import Card from '../leaders/components/ui/Card'
import EmptyState from '../leaders/components/ui/EmptyState'
import CanslimDetail from '../leaders/components/screener/CanslimDetail'
import CanslimFilters from '../leaders/components/screener/CanslimFilters'
import CanslimList from '../leaders/components/screener/CanslimList'
import MarketStrip from '../leaders/components/screener/MarketStrip'
import { PAGE_SIZE, getCanslimScreen } from '../leaders/api/screener'
import { useMediaQuery } from '../leaders/hooks/useMediaQuery'
import { DEFAULT_FILTERS, activeCanslimFilters } from '../leaders/lib/canslim'
import type { CanslimItem, CanslimMarket, ScreenFilters } from '../leaders/types/screener'
import PageHeader from '../leaders/components/ui/PageHeader'
import FilterPanel from '../leaders/components/ui/FilterPanel'
import { ListSkeleton } from '../leaders/components/ui/Skeleton'
import TodayPicks from '../leaders/components/screener/TodayPicks'
import Button from '../leaders/components/ui/Button'

// 관리자 '주도주' — 웹(web_client/src/pages/ScreenerPage.tsx)과 같은 화면 + 맨 위 CANSLIM 계산 상태 카드.
// 화면 조각은 src/leaders/ 복사본(웹 원본과 같이 고칠 것). 종목 링크는 관리자 '데이터 검증'(/market/verify?ticker=)으로 간다.
export default function MarketLeaders() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [params, setParams] = useSearchParams()
  const linked = params.get('ticker')
  const [filters, setFilters] = useState<ScreenFilters>(DEFAULT_FILTERS)
  const [markets, setMarkets] = useState<CanslimMarket[]>([])
  const [date, setDate] = useState<string | null>(null)
  const [items, setItems] = useState<CanslimItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getCanslimScreen(filters)
      .then(({ markets: m, screen }) => {
        if (cancelled) return
        setMarkets(m)
        setDate(screen.date)
        setItems(screen.items)
        setTotal(screen.total)
        setSelected((cur) => (screen.items.some((i) => i.ticker === cur) ? cur : null))
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [filters])

  // 넓은 화면은 첫 종목을 오른쪽에 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shown = selected ?? (wide ? items[0]?.ticker ?? null : null)

  const loadMore = () => {
    setLoadingMore(true)
    getCanslimScreen(filters, items.length)
      .then(({ screen }) => setItems((cur) => [...cur, ...screen.items]))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }

  const onSelect = (ticker: string) => setSelected((cur) => (!wide && cur === ticker ? null : ticker))

  return (
    <div className="space-y-3 break-keep sm:space-y-4">
      <PageHeader title="주도주 분석" description="윌리엄 오닐의 CANSLIM 7가지 기준으로 실적과 추세가 강한 종목을 찾아요. 일반 유저 웹과 같은 화면이에요." />
      <CanslimStatus />
      {linked && (
        // 목록 필터(유동성 등)에 걸려 목록에 없을 수도 있어 따로 보여준다
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted">주소로 고른 종목</span>
            <button type="button" onClick={() => setParams({}, { replace: true })} className="text-sm font-medium text-brand-strong">
              닫기
            </button>
          </div>
          <CanslimDetail ticker={linked} />
        </Card>
      )}
      <MarketStrip markets={markets} date={date} loading={state === 'loading'} />
      <TodayPicks />
      <Card>
        <FilterPanel activeCount={activeCanslimFilters(filters)}>
          <CanslimFilters value={filters} onChange={setFilters} />
        </FilterPanel>
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="목록을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <ListSkeleton />}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="분석 데이터를 준비하고 있어요" description="매일 장 마감 후 계산돼요." /></Card>
      )}
      {state === 'ready' && date !== null && items.length === 0 && (
        <Card><EmptyState emoji="🔎" title="조건에 맞는 종목이 없어요" description="통과 수나 '꼭 통과' 조건을 줄여 보세요." /></Card>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 종목</p>
            <CanslimList
              items={items}
              selected={shown}
              onSelect={onSelect}
              renderInline={wide ? undefined : (t) => <CanslimDetail ticker={t} />}
            />
            {items.length < total && (
              <Button variant="tertiary" full className="mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(PAGE_SIZE, total - items.length)}개)`}
              </Button>
            )}
          </Card>
          {wide && shown && (
            // 관리자 상단 바(약 57px) 아래에 붙는다 — 웹은 상단 바+탭이라 7.5rem
            <Card as="aside" className="lg:sticky lg:top-20">
              <CanslimDetail ticker={shown} />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// 관리자용 상태 한 줄 — 데이터 현황(GET /admin/market/status)의 canslim 항목(최신 계산일·종목 수·정상/오래됨/없음).
// 불러오지 못해도 아래 화면(공개 GraphQL)은 그대로 보인다.
function CanslimStatus() {
  const [data, setData] = useState<Dataset | null | 'failed'>(null)

  useEffect(() => {
    let cancelled = false
    getMarketStatus()
      .then((r) => {
        if (!cancelled) setData(r.datasets.find((d) => d.key === 'canslim') ?? 'failed')
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
            CANSLIM 계산 상태를 불러오지 못했어요. 아래 화면은 그대로 볼 수 있어요.
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
