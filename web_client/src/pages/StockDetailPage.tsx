import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getPatternBases } from '../api/patterns'
import { getDailyCandles } from '../api/stock'
import { getCanslimScore } from '../api/screener'
import { findStock, type StockHit } from '../api/stockSearch'
import { BaseHistoryTable, CurrentBaseSummary } from '../components/patterns/PatternParts'
import StockDailyChart from '../components/screener/StockDailyChart'
import LendingSection from '../components/stock/LendingSection'
import StockSearch from '../components/stock/StockSearch'
import Card from '../components/ui/Card'
import { chipClass } from '../components/ui/Chip'
import { high52w } from '../lib/canslim'
import { formatPct, formatPrice } from '../lib/format'
import { overlayCaption, patternOverlay } from '../lib/patternOverlay'
import type { PatternBases } from '../types/patterns'
import type { DailyCandle } from '../types/game'
import type { CanslimScore } from '../types/screener'
import { Skeleton } from '../components/ui/Skeleton'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useScreenerFeatures } from '../hooks/useScreenerFeatures'
import { stockBackPath } from '../lib/screenerFeatures'
import { marketDataVisible, stockLinkOutUrl } from '../lib/marketAccess'
import type { ScreenerFeatures } from '../api/screenerFeatures'

// 종목 상세 — 검색창 + 헤더(이름·종가) + 일봉 차트(기간 선택, 50일선·52주 고점·현재 패턴 선)
//   + 패턴(현재 베이스·이력) + 대차잔고(데이터 없으면 숨김) + 참고용 안내. 스크리너 상세 패널과 같은 부품을 쓴다.
// 사용자 화면에서는 CANSLIM 점수 박스·주도주 분석(LetterList·ScoreHistory)을 보여 주지 않는다 — 모든 데이터는 참고용
// (docs/app_identity_and_nav_redesign_spec.md 2-4). 부품(components/screener/CanslimParts.tsx)은 지우지 않고 보존한다.
// 점수 응답은 계속 받는다 — 이름·업종·종가·기준일·52주 고점(차트 선)이 이 응답에서 나온다.
// 점수·패턴은 따로 불러와 하나가 실패해도 나머지는 보인다. 일봉은 종가 기준(실시간 아님).

const PERIODS = [
  { key: '6m', label: '6개월', days: 190 },
  { key: '1y', label: '1년', days: 370 },
  { key: '3y', label: '3년', days: 1100 },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

const TICKER_RE = /^[0-9A-Z]{6}$/

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'failed' }

// 시세 비노출(A안 설계 3-4): 요청자가 시세를 볼 수 없으면 차트·종가·52주·패턴·대차를 요청도 하지 않고
// 종목명·코드 + "시세는 증권사 앱에서" 링크아웃만 그린다. 판단값을 묻는 동안은 기다린다(시세가 잠깐 비치지 않게).
export default function StockDetailPage() {
  const features = useScreenerFeatures()
  if (features === null) return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>
  if (!marketDataVisible(features)) return <StockLinkOutPage features={features} />
  return <StockMarketDetail features={features} />
}

function useGoBack(features: ScreenerFeatures | null) {
  const navigate = useNavigate()
  return () => {
    // 직접 들어온 경우(뒤로 갈 곳 없음)는 스크리너가 보일 때만 스크리너로, 아니면 마켓으로
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(stockBackPath(features))
  }
}

/** 시세 없이 종목명·코드 + 링크아웃 — 이름은 검색(searchStocks, 가격 필드 없음)으로 채운다 */
function StockLinkOutPage({ features }: { features: ScreenerFeatures }) {
  const { ticker: raw = '' } = useParams()
  const ticker = raw.toUpperCase()
  const valid = TICKER_RE.test(ticker)
  const goBack = useGoBack(features)
  const [info, setInfo] = useState<StockHit | null>(null)

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    setInfo(null)
    findStock(ticker)
      .then((h) => !cancelled && setInfo(h))
      .catch(() => undefined) // 이름을 못 찾으면 코드만 보여 준다
    return () => {
      cancelled = true
    }
  }, [ticker, valid])

  useDocumentTitle(valid ? info?.name : null)
  const href = stockLinkOutUrl(ticker)

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={goBack} aria-label="뒤로" className="shrink-0 rounded-btn bg-fill px-3 py-2 text-sm font-medium text-ink">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <StockSearch />
        </div>
      </div>
      {!valid ? (
        <p className="py-16 text-center text-sm text-ink-muted">종목 코드가 올바르지 않아요</p>
      ) : (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <h1 className="truncate text-2xl font-bold text-ink">{info?.name ?? ticker}</h1>
            <span className="text-xs text-ink-muted">{ticker}{info?.market ? ` · ${info.market}` : ''}</span>
          </div>
          <p className="text-sm text-ink-muted">시세·차트는 증권사 앱이나 포털에서 확인해 주세요.</p>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-btn bg-fill px-4 text-sm font-semibold text-brand-strong"
            >
              시세는 증권사 앱에서 ↗
            </a>
          )}
        </Card>
      )}
    </div>
  )
}

function StockMarketDetail({ features }: { features: ScreenerFeatures }) {
  const { ticker: raw = '' } = useParams()
  const ticker = raw.toUpperCase()
  const valid = TICKER_RE.test(ticker)

  const [score, setScore] = useState<Load<CanslimScore | null>>({ state: 'loading' })
  const [bases, setBases] = useState<Load<PatternBases>>({ state: 'loading' })
  const [info, setInfo] = useState<StockHit | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('1y')
  const [reload, setReload] = useState(0)
  const [dropped, setDropped] = useState(0)
  const [recent, setRecent] = useState<DailyCandle[]>([]) // 전일 대비 등락률용 최근 일봉

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    setScore({ state: 'loading' })
    setBases({ state: 'loading' })
    setInfo(null)
    getCanslimScore(ticker)
      .then((d) => !cancelled && setScore({ state: 'ready', data: d }))
      .catch(() => !cancelled && setScore({ state: 'failed' }))
    getPatternBases(ticker)
      .then((d) => !cancelled && setBases({ state: 'ready', data: d }))
      .catch(() => !cancelled && setBases({ state: 'failed' }))
    setRecent([])
    getDailyCandles(ticker, undefined, 14)
      .then((rows) => !cancelled && setRecent(rows))
      .catch(() => undefined) // 등락률만 빠진다
    return () => {
      cancelled = true
    }
  }, [ticker, valid, reload])

  // 주도주 분석 대상이 아니면(ETF·우선주 등) 이름·시장을 검색으로 채운다
  const scoreData = score.state === 'ready' ? score.data : null
  const needInfo = valid && score.state !== 'loading' && scoreData === null
  useEffect(() => {
    if (!needInfo) return
    let cancelled = false
    findStock(ticker)
      .then((h) => !cancelled && setInfo(h))
      .catch(() => undefined) // 이름을 못 찾으면 코드만 보여 준다
    return () => {
      cancelled = true
    }
  }, [needInfo, ticker])

  const basesData = bases.state === 'ready' ? bases.data : null
  const current = basesData?.bases.find((b) => b.isCurrent) ?? null
  const overlay = useMemo(
    () => (current ? patternOverlay(basesData?.zones ?? null, current, current.pivot) : null),
    [basesData, current],
  )

  useDocumentTitle(valid ? scoreData?.name ?? info?.name : null)

  if (!valid) {
    return (
      <div className="space-y-4">
        <StockSearch />
        <p className="py-16 text-center text-sm text-ink-muted">종목 코드가 올바르지 않아요</p>
      </div>
    )
  }

  const name = scoreData?.name ?? info?.name ?? (basesData && basesData.name !== ticker ? basesData.name : null)
  const sub = scoreData?.sectorName ?? scoreData?.market ?? info?.market ?? null
  const close = scoreData?.close ?? basesData?.close ?? null
  const date = scoreData?.date ?? basesData?.date ?? null
  const n = scoreData?.letters.find((l) => l.key === 'n')
  // 전일 대비 — 헤더 종가 날짜의 봉과 그 전 봉(날짜를 못 찾으면 최근 두 봉)
  const dayIdx = date ? recent.findIndex((c) => c.date === date) : recent.length - 1
  const i = dayIdx >= 0 ? dayIdx : recent.length - 1
  const dayChange = i >= 1 && recent[i - 1].close > 0 ? ((recent[i].close - recent[i - 1].close) / recent[i - 1].close) * 100 : null
  const days = PERIODS.find((p) => p.key === period)?.days ?? 370

  const goBack = useGoBack(features)

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={goBack}
          aria-label="뒤로"
          className="shrink-0 rounded-btn bg-fill px-3 py-2 text-sm font-medium text-ink"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <StockSearch />
        </div>
      </div>
      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>

      <Card>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <h1 className="truncate text-2xl font-bold text-ink">{name ?? ticker}</h1>
              <span className="text-xs text-ink-muted">{ticker}{sub ? ` · ${sub}` : ''}</span>
            </div>
            <p className="text-sm text-ink-muted tabular-nums">
              {close === null ? '종가 정보 없음' : (
                <>
                  {formatPrice(close)}원
                  {dayChange !== null && (
                    <span className={`ml-1.5 font-semibold ${dayChange > 0 ? 'text-up' : dayChange < 0 ? 'text-down' : ''}`}>
                      {formatPct(dayChange)}
                    </span>
                  )}
                  {date ? ` · ${date} 종가` : ''}
                </>
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* 일봉 차트는 전체 폭, 아래 차트 패턴·대차잔고는 넓은 화면(lg+)에서 2단(대차잔고가 없으면 패턴이 전체 폭) */}
      <Card as="section" aria-label="일봉 차트" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-ink">일봉</h2>
          <div className="flex gap-1.5" role="group" aria-label="차트 기간">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                aria-pressed={period === p.key}
                className={chipClass(period === p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* 52주 고점(점수 응답)을 알아야 일봉을 한 번만 요청하므로 점수 조회가 끝난 뒤에 그린다 */}
        {score.state === 'loading' ? (
          <div className="flex h-72 items-center justify-center text-sm text-ink-muted sm:h-96">차트를 불러오는 중…</div>
        ) : (
          <StockDailyChart
            ticker={ticker}
            high52w={scoreData ? high52w(scoreData.close, n?.value ?? null) : null}
            priceLines={overlay?.priceLines}
            markers={overlay?.markers}
            lookbackDays={days}
            onMarkersDropped={setDropped}
            heightClass="h-72 sm:h-96"
          />
        )}
        {current && <p className="text-xs text-ink-muted">{overlayCaption(basesData?.zones ?? null, current.pivot)}</p>}
        {current && dropped > 0 && (
          <p className="text-xs text-ink-muted">차트 기간 밖 꼭짓점 {dropped}개는 표시하지 않았어요 — 기간을 늘려 보세요</p>
        )}
      </Card>

      <div className="space-y-3 sm:space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 lg:[&>*:only-child]:col-span-2">
        <Card as="section" aria-label="차트 패턴" className="space-y-3">
          <h2 className="font-bold text-ink">차트 패턴 <span className="text-xs font-normal text-ink-muted">참고용</span></h2>
          {bases.state === 'loading' && (
            <>
              <p role="status" className="sr-only">패턴을 불러오고 있어요</p>
              <Skeleton className="h-[23rem] sm:h-[17rem]" />
            </>
          )}
          {bases.state === 'failed' && <Retry text="패턴을 불러오지 못했어요" onRetry={() => setReload((k) => k + 1)} />}
          {basesData && (
            basesData.bases.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">찾은 베이스(패턴)가 없어요</p>
            ) : (
              <>
                {current ? <CurrentBaseSummary base={current} /> : <p className="text-sm text-ink-muted">지금 진행 중인 베이스는 없어요</p>}
                <BaseHistoryTable name={name ?? ticker} bases={basesData.bases} />
              </>
            )
          )}
        </Card>

        <LendingSection ticker={ticker} />
      </div>
      <p className="rounded-field bg-fill px-3 py-2 text-xs text-ink-muted">ⓘ 모든 데이터는 투자 판단의 참고용 자료이며, 투자 권유가 아니에요.</p>
    </div>
  )
}

function Retry({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="py-2 text-center">
      <p className="text-sm text-ink-muted">{text}</p>
      <button type="button" onClick={onRetry} className="mt-2 rounded-btn bg-fill px-4 py-2 text-sm font-medium text-ink">
        다시 시도
      </button>
    </div>
  )
}
