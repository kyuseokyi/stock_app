import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import BasisNote from '../../components/market/BasisNote'
import EventList from '../../components/market/EventList'
import { MacroCards } from '../../components/market/IndexCards'
import { getMarketCalendar, getMarketOverview } from '../../api/market'
import { useVisibleInterval } from '../../hooks/useVisibleInterval'
import { MARKET_REFRESH_MS, MARKET_REQUEST_TIMEOUT_MS } from '../../lib/marketLive'
import { formatPct, kstDateString, pnlClass } from '../../lib/format'
import type { CalendarEvent, MacroValue, MarketIndex, MarketOverview } from '../../types/market'
import PageHeader from '../../components/ui/PageHeader'

// 미국 증시 카드 순서(KIS 해외지수). 국내 지수·주도 테마·업종 지도는 홈 '장 마감 노트'가 맡는다.
const US_ORDER = ['US:SPX', 'US:COMP', 'US:NDX', 'US:SOX', 'US:DJI']
// 돈의 흐름 카드로 올리는 FRED 금리 — 키가 없으면 데이터가 없어 줄이 그냥 빠진다. 나머지 FRED 지표는 '미국 경제지표' 카드.
const RATE_SERIES = ['DGS10', 'DGS2']
// 오르는 게 좋은 일이 아닌 지표 — 핑크(상승) 대신 회색에 부호, 뜻을 한 줄로(Pink-Is-a-Point)
const NEUTRAL_HINT: Record<string, string> = {
  'FX:USDKRW': '오르면 원화 약세',
  'US:VIX': '공포지수 · 오르면 불안이 커졌다는 뜻',
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const fmtIndex = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

function More({ to }: { to: string }) {
  return <Link to={to} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">더 보기 ›</Link>
}

function Row({ name, hint, value, sub, subClass = 'text-ink-muted' }: { name: string; hint?: ReactNode; value: string; sub?: string; subClass?: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{name}</div>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <div className="text-sm font-bold text-ink">{value}</div>
        {sub && <div className={`text-xs font-medium ${subClass}`}>{sub}</div>}
      </div>
    </li>
  )
}

function IndexRow({ ix }: { ix: MarketIndex }) {
  const neutral = NEUTRAL_HINT[ix.code]
  const live = ix.live && ix.asOf ? `장중 ${ix.asOf}` : null
  return (
    <Row
      name={ix.name}
      hint={[neutral, live].filter(Boolean).join(' · ') || undefined}
      value={fmtIndex(ix.close)}
      sub={ix.chg1d == null ? '—' : formatPct(ix.chg1d)}
      subClass={neutral ? 'text-ink-muted' : pnlClass(ix.chg1d)}
    />
  )
}

function RateRow({ m }: { m: MacroValue }) {
  const diff = m.prev == null ? null : m.value - m.prev
  return (
    <Row
      name={m.name}
      hint={`${shortDate(m.date)} 기준`}
      value={`${m.value.toFixed(2)}${m.unit}`}
      sub={diff == null ? undefined : `직전 대비 ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%p`}
    />
  )
}

// 시장 탭(세계 시장) — 밤사이 미국 증시, 돈의 흐름(원/달러·VIX·미 국채), 미국 경제지표, 다가오는 일정.
// 내일 국내장에 영향을 줄 바깥 신호만 모은다. 한 부분이 실패해도 나머지는 보여준다.
export default function MarketTab() {
  const today = kstDateString()
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [state, setState] = useState<'loading' | 'ready'>('loading')

  // 개요 요청 번호 — 초기 로드와 30초 자동 새로고침이 겹쳐도 늦게 온 옛 응답이 최신 값을 덮지 않게 한다.
  const ovSeq = useRef(0)
  const ovBusy = useRef(false)

  useEffect(() => {
    let cancelled = false
    const ovId = ++ovSeq.current
    Promise.allSettled([getMarketOverview(), getMarketCalendar(today, addDays(today, 60))]).then(([ov, ev]) => {
      if (cancelled) return
      if (ov.status === 'fulfilled' && ovId === ovSeq.current) setOverview(ov.value)
      if (ev.status === 'fulfilled') setEvents(ev.value.slice(0, 5))
      setState('ready')
    })
    return () => {
      cancelled = true
    }
  }, [today])

  // 원/달러는 장중(09:00~15:35) 값이 덧씌워진다 — 탭이 보이는 동안 30초마다 개요만 조용히 다시 받는다.
  // 실패는 무시(다음 주기에 재시도), 요청은 10초 제한, 앞 요청이 끝나기 전에는 건너뛰고, 늦게 온 옛 응답은 번호로 버린다.
  useVisibleInterval(() => {
    if (ovBusy.current) return
    ovBusy.current = true
    const id = ++ovSeq.current
    getMarketOverview(MARKET_REQUEST_TIMEOUT_MS)
      .then((ov) => {
        if (id === ovSeq.current) setOverview(ov)
      })
      .catch(() => undefined)
      .finally(() => {
        ovBusy.current = false
      })
  }, MARKET_REFRESH_MS, state === 'ready', { runOnVisible: true })

  const header = <PageHeader title="밤사이 세계 시장" description="미국 장 마감 기준으로, 내일 국내장에 영향을 줄 바깥 신호를 모았어요." />

  if (state === 'loading') {
    return (
      <div aria-busy="true" className="space-y-3 sm:space-y-4">
        {header}
        <p role="status" className="sr-only">세계 시장을 불러오고 있어요</p>
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          <Skeleton className="h-[324px] rounded-card" />
          <Skeleton className="h-[324px] rounded-card" />
        </div>
      </div>
    )
  }

  const indices = overview?.indices ?? []
  const us = US_ORDER.flatMap((c) => indices.filter((i) => i.code === c))
  const flow = ['FX:USDKRW', 'US:VIX'].flatMap((c) => indices.filter((i) => i.code === c))
  const rates = (overview?.macro ?? []).filter((m) => RATE_SERIES.includes(m.seriesId))
  const otherMacro = (overview?.macro ?? []).filter((m) => !RATE_SERIES.includes(m.seriesId))
  const usDate = us[0]?.date ?? null
  const nothing = !us.length && !flow.length && !rates.length && !events.length

  return (
    <div className="space-y-3 sm:space-y-4">
      {header}
      {nothing && (
        <Card><EmptyState emoji="🛠️" title="세계 시장 데이터를 준비하고 있어요" description="미국 장 마감 뒤(아침 6:30) 갱신돼요." /></Card>
      )}

      <div className={`grid gap-3 sm:gap-4 ${us.length > 0 && flow.length + rates.length > 0 ? 'lg:grid-cols-2 lg:items-start' : ''}`}>
        {us.length > 0 && (
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-ink">미국 증시</h2>
              {usDate && <span className="text-xs text-ink-muted">{shortDate(usDate)} 마감</span>}
            </div>
            <ul className="mt-1 divide-y divide-line">
              {us.map((ix) => <IndexRow key={ix.code} ix={ix} />)}
            </ul>
          </Card>
        )}
        {flow.length + rates.length > 0 && (
          <Card>
            <h2 className="text-base font-bold text-ink">돈의 흐름</h2>
            <ul className="mt-1 divide-y divide-line">
              {flow.map((ix) => <IndexRow key={ix.code} ix={ix} />)}
              {rates.map((m) => <RateRow key={m.seriesId} m={m} />)}
            </ul>
          </Card>
        )}
      </div>

      <MacroCards macro={otherMacro} />

      {events.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">다가오는 일정</h2>
            <More to="/screener/calendar" />
          </div>
          <EventList events={events} today={today} />
        </Card>
      )}
      <BasisNote date={usDate} />
    </div>
  )
}
