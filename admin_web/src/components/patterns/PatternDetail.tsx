// web_client/src/components/patterns/PatternDetail.tsx 이식 — 원본과 같이 고칠 것
// (변경: 차트에 패턴 도형(컵 = U자·베이스 = 사각형) 오버레이 + 지난 베이스까지 보이게 엔진 조회 범위로 일봉 조회 — CanslimDetail 과 같은 방식,
//  종목 링크 → 관리자 데이터 검증 /market/verify?ticker=)
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart from '../../leaders/components/screener/StockDailyChart'
import { BaseHistoryTable, CurrentBaseSummary } from './PatternParts'
import { getPatternBases } from '../../leaders/api/patterns'
import { formatPrice } from '../../leaders/lib/format'
import {
  ENGINE_LOOKBACK_DAYS, SHAPE_COLORS, allBaseDates, baseDates, lookbackFor, overlayCaption, patternOverlay, patternShapes,
} from '../../leaders/lib/patternOverlay'
import { patternLabel, stageLabel } from '../../leaders/lib/patterns'
import type { PatternBases, PatternItem } from '../../leaders/types/patterns'

// 패턴 상세 — 일봉 차트(패턴 도형 + 피벗·매수 상단·손절 선 + 베이스 꼭짓점 마커) + 현재 베이스 요약 + 베이스 이력 표.
export default function PatternDetail({ item }: { item: PatternItem }) {
  const [data, setData] = useState<PatternBases | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [reload, setReload] = useState(0)
  const [dropped, setDropped] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setData(null)
    setDropped(0)
    getPatternBases(item.ticker)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [item.ticker, reload])

  const bases = useMemo(() => data?.bases ?? [], [data])
  const current = bases.find((b) => b.isCurrent) ?? null
  const hasPast = bases.some((b) => !b.isCurrent)
  const pivot = current?.pivot ?? item.pivot

  // 모든 베이스(지난 것 포함)가 잘리지 않게 엔진 조회 범위(≈1,100일)까지 받는다. 베이스가 없으면 현재 베이스 기준(기본 약 280일)
  const lookbackDays = useMemo(
    () => (bases.length > 0 ? lookbackFor(allBaseDates(bases), undefined, ENGINE_LOOKBACK_DAYS) : lookbackFor(baseDates(current))),
    [bases, current],
  )
  const { priceLines, markers } = useMemo(() => patternOverlay(data?.zones ?? null, current, pivot), [data, current, pivot])
  const shapes = useMemo(() => (bases.length > 0 ? patternShapes(bases) : undefined), [bases])
  // 첫 화면은 현재 베이스 시작(앞 여유 10봉)부터 — 긴 기간을 받아도 현재 패턴이 크게 보이게
  const focusFrom = current ? baseDates(current).sort()[0] : undefined

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-lg font-bold text-ink">{item.name}</h2>
          <span className="text-xs text-ink-muted">{item.ticker} · {item.sectorName ?? item.market}</span>
        </div>
        <p className="text-sm text-ink-muted">
          {formatPrice(item.close)}원 · {patternLabel(item.patternType)} · {stageLabel(item.stage, item.label)}
        </p>
      </div>

      {/* 꼭짓점 기간을 알아야 일봉을 한 번만 요청하므로 베이스 조회가 끝난 뒤에 그린다 */}
      {state === 'loading' ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-muted">차트를 불러오는 중…</div>
      ) : (
        <StockDailyChart
          ticker={item.ticker}
          high52w={null}
          priceLines={priceLines}
          markers={markers}
          shapes={shapes}
          focusFrom={focusFrom}
          shapeLegend={[
            ...(current ? [{ color: SHAPE_COLORS.current, label: '현재 패턴' }] : []),
            ...(hasPast ? [{ color: SHAPE_COLORS.past, label: '지난 베이스' }] : []),
          ]}
          lookbackDays={lookbackDays}
          onMarkersDropped={setDropped}
        />
      )}
      <p className="text-xs text-ink-muted">{overlayCaption(data?.zones ?? null, pivot)}</p>
      {dropped > 0 && <p className="text-xs text-ink-muted">차트 기간 밖 꼭짓점 {dropped}개는 표시하지 않았어요</p>}

      {state === 'loading' && <p className="py-4 text-center text-sm text-ink-muted">베이스 이력을 불러오는 중…</p>}
      {state === 'failed' && (
        <div className="py-2 text-center">
          <p className="text-sm text-ink-muted">베이스 이력을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={() => setReload((k) => k + 1)}
            className="mt-2 rounded-btn bg-fill px-4 py-2 text-sm font-medium text-ink"
          >
            다시 시도
          </button>
        </div>
      )}

      {state === 'ready' && current && <CurrentBaseSummary base={current} />}
      {state === 'ready' && data && <BaseHistoryTable name={item.name} bases={data.bases} />}

      <Link to={`/market/verify?ticker=${encodeURIComponent(item.ticker)}`} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
        데이터 검증에서 보기 →
      </Link>
    </div>
  )
}
