import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import CanslimDetail from '../components/screener/CanslimDetail'
import CanslimFilters from '../components/screener/CanslimFilters'
import CanslimList from '../components/screener/CanslimList'
import MarketStrip from '../components/screener/MarketStrip'
import { PAGE_SIZE, getCanslimScreen } from '../api/screener'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { DEFAULT_FILTERS } from '../lib/canslim'
import type { CanslimItem, CanslimMarket, ScreenFilters } from '../types/screener'

// 스크리너 '주도주' 탭 — CANSLIM(윌리엄 오닐). 넓은 화면은 목록 + 오른쪽 상세, 좁은 화면은 행을 눌러 펼침.
// ?ticker= 로 들어오면(테마·업종 상세의 종목) 그 종목 점수표를 바로 보여준다.
export default function ScreenerPage() {
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
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">주도주 분석</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          윌리엄 오닐의 CANSLIM 7가지 기준으로 실적과 추세가 강한 종목을 찾습니다.
        </p>
      </div>
      {linked && (
        // 목록 필터(유동성 등)에 걸려 목록에 없을 수도 있어 따로 보여준다
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted">테마·업종에서 고른 종목</span>
            <button type="button" onClick={() => setParams({}, { replace: true })} className="text-sm font-medium text-brand">
              닫기
            </button>
          </div>
          <CanslimDetail ticker={linked} />
        </Card>
      )}
      <MarketStrip markets={markets} date={date} />
      <Card>
        <CanslimFilters value={filters} onChange={setFilters} />
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="목록을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
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
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full rounded-btn bg-fill py-2.5 text-sm font-medium text-ink disabled:opacity-60"
              >
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(PAGE_SIZE, total - items.length)}개)`}
              </button>
            )}
          </Card>
          {wide && shown && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <CanslimDetail ticker={shown} />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
