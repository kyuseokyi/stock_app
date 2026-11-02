import { useCallback, useMemo, useState, type ReactNode } from 'react'
import BriefCard from '../../components/market/BriefCard'
import BasisNote from '../../components/market/BasisNote'
import EventList from '../../components/market/EventList'
import FlowBoard from '../../components/market/FlowBoard'
import GroupDetailView from '../../components/market/GroupDetailView'
import HotKeywords from '../../components/market/HotKeywords'
import { IndexCards, MacroCards } from '../../components/market/IndexCards'
import MoversBoard from '../../components/market/MoversBoard'
import { SectionError, SectionHead } from '../../components/market/SectionHead'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Skeleton } from '../../components/ui/Skeleton'
import { getMarketCalendar, getMarketGroups, getMarketOverview } from '../../api/market'
import { getInvestorFlow, getMorningBrief, getMovers } from '../../api/marketRest'
import { useMarketSection } from '../../hooks/useMarketSection'
import { useReturnRefresh } from '../../hooks/useReturnRefresh'
import { useVisibleInterval } from '../../hooks/useVisibleInterval'
import { closeBasisLabel, formatPct, kstDateString, pnlClass } from '../../lib/format'
import { flowCaption, formatBasis, hasFlowData, indexHeaderBasis, marketSession, splitOverview, tickerNames } from '../../lib/marketDashboard'
import { MARKET_REFRESH_MS } from '../../lib/marketLive'
import type { GroupKind, MacroValue, MarketIndex } from '../../types/market'

// 오르는 게 좋은 일이 아닌 지표 — 핑크(상승) 대신 회색에 부호, 뜻을 한 줄로(Pink-Is-a-Point)
const NEUTRAL_HINT: Record<string, string> = {
  'FX:USDKRW': '오르면 원화 약세',
  'US:VIX': '공포지수 · 오르면 불안이 커졌다는 뜻',
}
/** 급등락 자동 갱신 주기 — 서버 AI 원인 분석이 몇 분 단위라 지수(30초)보다 느리게(앱과 같은 값) */
const MOVERS_REFRESH_MS = 60_000

const fetchThemes = () => getMarketGroups('theme', '1d', 'chg', 0, 5)

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const fmtIndex = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

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

/** 나란히 놓을 두 칸 — 둘 다 있을 때만 넓은 화면 2열 */
function Pair({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${left && right ? 'lg:grid-cols-2 lg:items-start' : ''}`}>
      {left}
      {right}
    </div>
  )
}

// 마켓 개요 — 앱 마켓 탭과 같은 순서: 브리핑 → 지수 → 돈의 흐름·경제지표 → 급등락 → 수급 → 핫 키워드·주도 테마 → 일정.
// 섹션마다 따로 불러와 하나가 실패해도 나머지는 보이고, 실패한 칸에만 '다시 시도'를 둔다.
export default function OverviewTab() {
  const today = kstDateString()
  const [openGroup, setOpenGroup] = useState<{ kind: GroupKind; id: string } | null>(null)

  const fetchEvents = useCallback(async () => (await getMarketCalendar(today, addDays(today, 60))).slice(0, 5), [today])

  const overview = useMarketSection(getMarketOverview)
  const brief = useMarketSection(getMorningBrief)
  const movers = useMarketSection(getMovers)
  const flow = useMarketSection(getInvestorFlow)
  const themes = useMarketSection(fetchThemes)
  const events = useMarketSection(fetchEvents)

  const indices = useMemo(() => overview.data?.indices ?? [], [overview.data])
  const session = marketSession(indices)

  // 지수 30초(기존), 급등락은 정규장일 때만 60초 — 탭이 보이는 동안만. 나머지는 탭 복귀 때 마지막 조회 후 10분이 지났으면 1회만.
  useVisibleInterval(() => void overview.silentRefresh(), MARKET_REFRESH_MS, !overview.loading, { runOnVisible: true })
  useVisibleInterval(() => void movers.silentRefresh(), MOVERS_REFRESH_MS, session === '정규장', { runOnVisible: true })
  useReturnRefresh(brief.silentRefresh, brief.fetchedAt)
  useReturnRefresh(movers.silentRefresh, movers.fetchedAt)
  useReturnRefresh(flow.silentRefresh, flow.fetchedAt)
  useReturnRefresh(themes.silentRefresh, themes.fetchedAt)
  useReturnRefresh(events.silentRefresh, events.fetchedAt)

  const names = useMemo(() => tickerNames(movers.data, flow.data), [movers.data, flow.data])

  const basis = indexHeaderBasis(indices)
  const split = useMemo(() => splitOverview(indices, overview.data?.macro ?? []), [indices, overview.data])
  const mv = movers.data
  const fl = flow.data
  const keywords = mv?.keywords ?? []
  const themeItems = themes.data?.items ?? []
  const eventItems = events.data ?? []
  const hasMovers = mv != null && mv.gainers.length + mv.losers.length > 0

  const moversCard = hasMovers ? (
    <Card as="section" aria-label="급등락">
      <SectionHead title="급등락 & AI 원인" caption={formatBasis(mv.updatedAt)} />
      <MoversBoard gainers={mv.gainers} losers={mv.losers} />
    </Card>
  ) : movers.failed ? (
    <SectionError text="급등락 종목을 불러오지 못했어요" onRetry={movers.reload} />
  ) : movers.loading ? (
    <Skeleton className="h-80 rounded-card" />
  ) : null

  const flowCard = fl && hasFlowData(fl) ? (
    <Card as="section" aria-label="수급 전광판">
      <SectionHead title="수급 전광판" caption={flowCaption(fl)} />
      <FlowBoard flow={fl} />
    </Card>
  ) : flow.failed ? (
    <SectionError text="수급 데이터를 불러오지 못했어요" onRetry={flow.reload} />
  ) : flow.loading ? (
    <Skeleton className="h-80 rounded-card" />
  ) : null

  const keywordCard = keywords.length > 0 || themeItems.length > 0 || themes.failed ? (
    <Card as="section" aria-label="핫 키워드와 주도 테마" className="space-y-3">
      {keywords.length > 0 && (
        <div>
          <SectionHead title="핫 키워드" caption={formatBasis(mv?.updatedAt)} />
          <HotKeywords keywords={keywords} names={names} />
        </div>
      )}
      {themeItems.length > 0 && (
        <div>
          <SectionHead title="주도 테마" caption={closeBasisLabel(themes.data?.date)} more="/market/themes" />
          <ol className="divide-y divide-line">
            {themeItems.map((t) => (
              <li key={t.id}>
                <button type="button" aria-haspopup="dialog" onClick={() => setOpenGroup({ kind: 'theme', id: t.id })} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-fill/60">
                  <span className="w-5 shrink-0 text-center text-sm font-bold text-ink-muted">{t.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{t.name}</span>
                    {t.leader && <span className="block truncate text-xs text-ink-muted">대장 {t.leader.name}</span>}
                  </span>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${pnlClass(t.chg)}`}>{t.chg == null ? '—' : formatPct(t.chg)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {themes.failed && themeItems.length === 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-ink-muted">주도 테마를 불러오지 못했어요</p>
          <button type="button" onClick={themes.reload} className="shrink-0 text-sm font-medium text-brand-strong">다시 시도</button>
        </div>
      )}
    </Card>
  ) : themes.loading ? (
    <Skeleton className="h-64 rounded-card" />
  ) : null

  const eventsCard = eventItems.length > 0 ? (
    <Card as="section" aria-label="다가오는 일정">
      <SectionHead title="다가오는 일정" more="/market/calendar" />
      <EventList events={eventItems} today={today} />
    </Card>
  ) : events.failed ? (
    <SectionError text="일정을 불러오지 못했어요" onRetry={events.reload} />
  ) : events.loading ? (
    <Skeleton className="h-64 rounded-card" />
  ) : null

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader
        title="오늘의 증시"
        description={session || basis ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {session && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${session === '정규장' ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink-muted'}`}>{session}</span>
            )}
            {basis && <span className="text-xs">{basis}</span>}
          </span>
        ) : undefined}
      />
      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>

      {brief.data ? (
        <BriefCard brief={brief.data} />
      ) : brief.failed ? (
        <SectionError text="AI 장전 브리핑을 불러오지 못했어요" onRetry={brief.reload} />
      ) : null}

      {overview.loading && !overview.data ? (
        <div aria-busy="true">
          <p role="status" className="sr-only">지수를 불러오고 있어요</p>
          <Skeleton className="h-[136px] rounded-card" />
        </div>
      ) : overview.failed && !overview.data ? (
        <SectionError text="지수를 불러오지 못했어요" onRetry={overview.reload} />
      ) : (
        <>
          <IndexCards indices={split.headline} />
          {(split.flow.length + split.rates.length > 0 || split.others.length > 0) && (
            <Pair
              left={split.flow.length + split.rates.length > 0 ? (
                <Card as="section" aria-label="돈의 흐름">
                  <h2 className="text-base font-bold text-ink">돈의 흐름</h2>
                  <ul className="mt-1 divide-y divide-line">
                    {split.flow.map((ix) => <IndexRow key={ix.code} ix={ix} />)}
                    {split.rates.map((m) => <RateRow key={m.seriesId} m={m} />)}
                  </ul>
                </Card>
              ) : null}
              right={split.others.length > 0 ? (
                <Card as="section" aria-label="그 밖의 지수">
                  <h2 className="text-base font-bold text-ink">그 밖의 지수</h2>
                  <ul className="mt-1 divide-y divide-line">
                    {split.others.map((ix) => <IndexRow key={ix.code} ix={ix} />)}
                  </ul>
                </Card>
              ) : null}
            />
          )}
          <MacroCards macro={split.otherMacro} />
        </>
      )}

      <Pair left={moversCard} right={flowCard} />
      <Pair left={keywordCard} right={eventsCard} />

      {/* 주도 테마가 실패해도 기준일이 남게 국내 지수 날짜로 대체(미국·환율은 거래일이 다름) */}
      <BasisNote date={themes.data?.date ?? indices.find((ix) => ix.region === 'KR')?.date ?? null} />

      {openGroup && (
        <Modal title={openGroup.kind === 'theme' ? '테마' : '업종'} onClose={() => setOpenGroup(null)}>
          <GroupDetailView kind={openGroup.kind} id={openGroup.id} />
        </Modal>
      )}
    </div>
  )
}
