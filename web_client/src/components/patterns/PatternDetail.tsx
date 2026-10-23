import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart from '../screener/StockDailyChart'
import { BaseHistoryTable, CurrentBaseSummary } from './PatternParts'
import { getPatternBases } from '../../api/patterns'
import { formatPrice } from '../../lib/format'
import { baseDates, lookbackFor, overlayCaption, patternOverlay } from '../../lib/patternOverlay'
import { patternLabel, stageLabel } from '../../lib/patterns'
import type { PatternBases, PatternItem } from '../../types/patterns'

// 패턴 상세 — 일봉 차트(피벗·매수 상단·손절 선 + 베이스 꼭짓점 마커) + 현재 베이스 요약 + 베이스 이력 표.
export default function PatternDetail({ item }: { item: PatternItem }) {
  const [data, setData] = useState<PatternBases | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [reload, setReload] = useState(0)
  const [dropped, setDropped] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setData(null)
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

  const current = data?.bases.find((b) => b.isCurrent) ?? null

  const lookbackDays = useMemo(() => lookbackFor(baseDates(current)), [current])
  const pivot = current?.pivot ?? item.pivot

  const { priceLines, markers } = useMemo(
    () => patternOverlay(data?.zones ?? null, current, pivot),
    [data, current, pivot],
  )

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

      <Link to={`/stock/${encodeURIComponent(item.ticker)}`} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
        종목 상세 보기 →
      </Link>
    </div>
  )
}
