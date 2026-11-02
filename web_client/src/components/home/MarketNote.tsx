import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Card from '../ui/Card'
import BasisNote from '../market/BasisNote'
import { IndexCards } from '../market/IndexCards'
import Treemap from '../market/Treemap'
import { getMarketGroups, getMarketOverview, getMarketTreemap } from '../../api/market'
import { useReturnRefresh } from '../../hooks/useReturnRefresh'
import { useVisibleInterval } from '../../hooks/useVisibleInterval'
import { MARKET_REFRESH_MS, MARKET_REQUEST_TIMEOUT_MS } from '../../lib/marketLive'
import { closeBasisLabel, formatPct, pnlClass } from '../../lib/format'
import { noteIndices, noteSummary, noteTitle } from '../../lib/marketSummary'
import type { GroupItem, MarketOverview, TreemapGroup } from '../../types/market'
import { Skeleton } from '../ui/Skeleton'

// 홈 '오늘 시장 노트' — 날짜 제목 + 한 줄 요약 + 지수 3 + 주도 테마 3 + 업종 지도 미리보기.
// 전체는 스크리너 시장 탭. 조각마다 따로 불러 하나가 실패해도 나머지는 보인다.
function More({ to, label = '더 보기' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
      {label} ›
    </Link>
  )
}

export default function MarketNote() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [themes, setThemes] = useState<GroupItem[]>([])
  const [sectors, setSectors] = useState<TreemapGroup[]>([])
  const [date, setDate] = useState<string | null>(null)
  const [sectorDate, setSectorDate] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready'>('loading')
  const ovSeq = useRef(0)
  const ovBusy = useRef(false)
  // 테마·업종 지도를 마지막으로 받은 시각, 지금 보여 주는 지도의 기준일(복귀 재조회 판정용)
  const dailyFetchedAt = useRef<number | null>(null)
  const shownSectorDate = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const ovId = ++ovSeq.current
    Promise.allSettled([
      getMarketOverview(),
      getMarketGroups('theme', '1d', 'chg', 0, 3),
      getMarketTreemap('sector', 'mcap', '1d'),
    ]).then(([ov, th, tm]) => {
      dailyFetchedAt.current = Date.now()
      if (cancelled) return
      if (ov.status === 'fulfilled' && ovId === ovSeq.current) setOverview(ov.value)
      if (th.status === 'fulfilled') {
        setThemes(th.value.items)
        setDate(th.value.date)
      }
      if (tm.status === 'fulfilled') {
        setSectors(tm.value.groups)
        setSectorDate(tm.value.date)
        shownSectorDate.current = tm.value.date
      }
      setState('ready')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 장중 지수 — 시장 탭과 같은 30초 주기·10초 제한·옛 응답 버림
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

  // 테마·업종 지도는 저녁에 한 번 바뀐다 — 타이머 없이 탭 복귀 때 마지막 조회 후 10분이 지났으면 1회만, 실패한 조각은 이전 값 유지.
  // 지도는 기준일이 바뀔 때만 교체한다(교체하면 들어가 있던 종목 보기가 풀린다)
  useReturnRefresh(async () => {
    const [th, tm] = await Promise.allSettled([
      getMarketGroups('theme', '1d', 'chg', 0, 3),
      getMarketTreemap('sector', 'mcap', '1d'),
    ])
    dailyFetchedAt.current = Date.now()
    if (th.status === 'fulfilled') {
      setThemes(th.value.items)
      setDate(th.value.date)
    }
    if (tm.status === 'fulfilled' && tm.value.date !== shownSectorDate.current) {
      setSectors(tm.value.groups)
      setSectorDate(tm.value.date)
      shownSectorDate.current = tm.value.date
    }
  }, dailyFetchedAt)

  if (state === 'loading') {
    // 높이는 실제 화면 측정값(제목 84/60 · 지수 136 · 테마 230 · 업종 지도 248 · 안내 32/16)
    return (
      <section aria-busy="true" className="space-y-3">
        <p role="status" className="sr-only">오늘 시장을 불러오고 있어요</p>
        <div className="min-h-[84px] sm:min-h-[60px]">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-5 w-full sm:w-3/4" />
        </div>
        <div className="h-4" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[136px] rounded-card" />)}
        </div>
        <Skeleton className="h-[230px] rounded-card" />
        <Skeleton className="h-[248px] rounded-card" />
        <div className="h-8 sm:h-4" />
      </section>
    )
  }

  const indices = overview?.indices ?? []
  const title = noteTitle(indices) ?? '오늘 시장 노트'
  const summary = noteSummary(indices, themes)
  const trio = noteIndices(indices)

  return (
    <section aria-labelledby="note-title" className="space-y-3">
      <header className="min-h-[84px] sm:min-h-[60px]">
        <h1 id="note-title" className="text-2xl font-bold text-ink">{title}</h1>
        {summary ? (
          <p className="mt-1 text-pretty text-base text-ink">{summary}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">시장 데이터는 매일 장 마감 후 갱신돼요.</p>
        )}
      </header>

      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>

      {trio.length > 0 && <IndexCards indices={trio} gridClass="grid-cols-3" />}

      {themes.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">
              주도 테마 {closeBasisLabel(date) && <span className="text-xs font-normal text-ink-muted">{closeBasisLabel(date)}</span>}
            </h2>
            <More to="/screener/themes" />
          </div>
          <ol className="divide-y divide-line">
            {themes.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="w-5 text-center text-sm font-bold text-ink-muted">{t.rank}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-ink">{t.name}</div>
                  {t.leader && <div className="truncate text-xs text-ink-muted">대장 {t.leader.name}</div>}
                </div>
                <span className={`text-sm font-bold tabular-nums ${pnlClass(t.chg)}`}>{t.chg == null ? '—' : formatPct(t.chg)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {sectors.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">
              업종 지도 <span className="text-xs font-normal text-ink-muted">면적 = 시가총액{closeBasisLabel(sectorDate) ? ` · ${closeBasisLabel(sectorDate)}` : ''}</span>
            </h2>
            <More to="/screener/sectors" label="업종 전체" />
          </div>
          <Treemap groups={sectors} period="1d" nested={false} height={180} onGroupSelect={() => navigate('/screener/sectors')} />
        </Card>
      )}

      <BasisNote date={date} />
    </section>
  )
}
