import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMarketOverview } from '../../api/market'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { marketDataVisible, type MarketAccessFlags } from '../../lib/marketAccess'
import { formatPct, pnlClass } from '../../lib/format'
import { homeMacroSourceLine, homeMacroTile, homeReferenceEnabled, homeReferenceView } from '../../lib/homeSections'
import { MARKET_REQUEST_TIMEOUT_MS } from '../../lib/marketLive'
import type { MacroValue, MarketIndex } from '../../types/market'
import Card from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'

// 홈 최하단 '오늘 시장 참고' — 코스피 · 코스닥 · 미국 대표 지수 · 원/달러만 작게. 전체 시장은 시장 탭(/market).
// 이 칸만 따로 불러와 실패해도 위 펀드·교육 카드는 그대로 보이고, 이 칸에서만 다시 시도한다.
// (예전 홈의 '오늘 시장 노트'(MarketNote)는 지우지 않고 보존 — 다시 켤 때 HomePage 에서 바꿔 끼우면 된다)
// 시세 비노출(A안): 시세 열람이면 지금과 같고, 아니면 (국내 지수 공개 스위치일 때 코스피·코스닥 +) 거시 카드
// 원/달러(한국은행 ECOS, 일별)·미 10년물·미 기준금리(FRED). 그릴 게 없으면 빈 카드 대신 섹션째 그리지 않는다
// (판단값을 묻는 동안은 요청도 하지 않고 숨김). 판정은 lib/homeSections.homeReferenceView(순수 함수·테스트).

const fmtIndex = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

type Load = { state: 'loading' } | { state: 'ready'; indices: MarketIndex[]; macro: MacroValue[] } | { state: 'failed' }

export default function HomeMarketReference() {
  const access = useScreenerFeatures()
  if (!homeReferenceEnabled(access)) return null
  const showMarket = marketDataVisible(access)
  // 로그인으로 열람 범위가 바뀌면 다시 불러오게 key 로 새로 그린다
  const scope = showMarket ? 'all' : access?.marketIndexKr === true ? 'kr' : 'macro'
  return <MarketReferenceBody key={scope} access={access} />
}

function MarketReferenceBody({ access }: { access: MarketAccessFlags | null }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchOnce = useCallback(() => {
    let alive = true
    getMarketOverview(MARKET_REQUEST_TIMEOUT_MS)
      .then((ov) => alive && setLoad({ state: 'ready', indices: ov.indices, macro: ov.macro ?? [] }))
      .catch(() => alive && setLoad({ state: 'failed' }))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => fetchOnce(), [fetchOnce])

  const view = load.state === 'ready' ? homeReferenceView(access, load.indices, load.macro) : null
  // 시세 비노출에서 그릴 게 없으면(수집 전 등) 섹션째 숨김 — 시세 열람이면 지금처럼 안내 카드
  if (view?.mode === 'hidden') return null
  const indices = view ? view.indices : []
  const macro = view?.mode === 'public' ? view.macro : []
  const source = homeMacroSourceLine(macro)

  return (
    <section aria-labelledby="home-market-title">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="home-market-title" className="text-lg font-bold text-ink">오늘 시장 참고</h2>
        <Link to="/market" className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
          시장 더보기 ›
        </Link>
      </div>

      {load.state === 'loading' && (
        <div aria-busy="true" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <p role="status" className="sr-only">오늘 시장을 불러오고 있어요</p>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] rounded-card" />)}
        </div>
      )}

      {load.state === 'failed' && (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">시장 지수를 불러오지 못했어요</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ state: 'loading' })
              fetchOnce()
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-btn bg-fill px-4 text-sm font-medium text-ink"
          >
            다시 시도
          </button>
        </Card>
      )}

      {load.state === 'ready' &&
        (indices.length === 0 && macro.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">시장 데이터는 매일 장 마감 후 갱신돼요.</p>
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {indices.map((ix) => (
              <li key={ix.code}>
                <Card padding="sm" className="h-full">
                  <p className="truncate text-xs font-medium text-ink-muted">{ix.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
                    <span className="font-bold text-ink">{fmtIndex(ix.close)}</span>
                    <span className={`text-xs font-medium ${pnlClass(ix.chg1d)}`}>
                      {ix.chg1d == null ? '—' : formatPct(ix.chg1d)}
                    </span>
                  </p>
                </Card>
              </li>
            ))}
            {macro.map((m) => {
              const t = homeMacroTile(m)
              return (
                <li key={t.seriesId}>
                  <Card padding="sm" className="h-full">
                    <p className="truncate text-xs font-medium text-ink-muted">{t.label}</p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
                      <span className="font-bold text-ink">{t.value}</span>
                      <span className="text-xs text-ink-muted">{t.basis}</span>
                    </p>
                  </Card>
                </li>
              )
            })}
          </ul>
        ))}

      {source && <p className="mt-2 text-xs text-ink-muted">{source}</p>}
      <p className="mt-2 text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요. 투자 판단의 참고 자료예요.</p>
    </section>
  )
}
