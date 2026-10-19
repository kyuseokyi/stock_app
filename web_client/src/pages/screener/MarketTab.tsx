import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import BasisNote from '../../components/market/BasisNote'
import EventList from '../../components/market/EventList'
import { IndexCards, MacroCards } from '../../components/market/IndexCards'
import Treemap from '../../components/market/Treemap'
import { getMarketCalendar, getMarketGroups, getMarketOverview, getMarketTreemap } from '../../api/market'
import { formatPct, kstDateString, pnlClass } from '../../lib/format'
import type { CalendarEvent, GroupItem, MarketOverview, TreemapGroup } from '../../types/market'

function More({ to }: { to: string }) {
  return <Link to={to} className="text-sm font-medium text-brand">더 보기</Link>
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 시장 탭(요약) — 지수·거시 지표, 주도 테마 Top 5, 업종 지도, 다가오는 일정. 한 부분이 실패해도 나머지는 보여준다.
export default function MarketTab() {
  const navigate = useNavigate()
  const today = kstDateString()
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [themes, setThemes] = useState<GroupItem[]>([])
  const [sectors, setSectors] = useState<TreemapGroup[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [date, setDate] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      getMarketOverview(),
      getMarketGroups('theme', '1d', 'chg', 0, 5),
      getMarketTreemap('sector', 'mcap', '1d'),
      getMarketCalendar(today, addDays(today, 60)),
    ]).then(([ov, th, tm, ev]) => {
      if (cancelled) return
      if (ov.status === 'fulfilled') setOverview(ov.value)
      if (th.status === 'fulfilled') {
        setThemes(th.value.items)
        setDate(th.value.date)
      }
      if (tm.status === 'fulfilled') setSectors(tm.value.groups)
      if (ev.status === 'fulfilled') setEvents(ev.value.slice(0, 5))
      setState('ready')
    })
    return () => {
      cancelled = true
    }
  }, [today])

  if (state === 'loading') return <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>

  const nothing = !overview?.indices.length && !themes.length && !sectors.length && !events.length
  return (
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">오늘 시장</h1>
        <p className="mt-0.5 text-sm text-ink-muted">국내·미국 지수와 주도 테마, 업종 흐름, 다가오는 일정을 한눈에 봐요.</p>
      </div>
      {nothing && (
        <Card><EmptyState emoji="🛠️" title="시장 데이터를 준비하고 있어요" description="매일 장 마감 후 갱신돼요." /></Card>
      )}
      {overview && <IndexCards indices={overview.indices} />}
      {overview && <MacroCards macro={overview.macro} />}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        {themes.length > 0 && (
          <Card>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">주도 테마 Top 5</h2>
              <More to="/screener/themes" />
            </div>
            <ul className="divide-y divide-line">
              {themes.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 text-center text-sm font-bold text-ink-muted">{t.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-ink">{t.name}</div>
                    {t.leader && <div className="truncate text-xs text-ink-muted">대장 {t.leader.name}</div>}
                  </div>
                  <span className={`text-sm font-bold ${pnlClass(t.chg)}`}>{t.chg == null ? '—' : formatPct(t.chg)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {events.length > 0 && (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">다가오는 일정</h2>
              <More to="/screener/calendar" />
            </div>
            <EventList events={events} today={today} />
          </Card>
        )}
      </div>

      {sectors.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">업종 지도 <span className="text-xs font-normal text-ink-muted">면적 = 시가총액</span></h2>
            <More to="/screener/sectors" />
          </div>
          <Treemap groups={sectors} period="1d" nested={false} height={260} onGroupSelect={() => navigate('/screener/sectors')} />
        </Card>
      )}
      <BasisNote date={date} />
    </div>
  )
}
