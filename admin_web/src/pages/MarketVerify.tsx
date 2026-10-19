import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getVerify } from '../api/marketAdmin'
import { CanslimCard, ComputedCard, InvestorCard, LinksCard, ProfileCard } from '../components/market/VerifyCards'
import VerifyStockPicker from '../components/market/VerifyStockPicker'
import { BarsCard, FundamentalsCard, MembershipsCard } from '../components/market/VerifyTables'
import { apiErrorMessage } from '../lib/apiError'
import type { VerifyReport } from '../types/marketAdmin'

const WIDE = 'lg:col-span-2 xl:col-span-3'

// 종목·기준일은 주소 쿼리(?ticker=&date=)에 둔다 — 새로고침·공유해도 같은 화면. date 가 없으면 서버가 그 종목 최신 일봉일로 정한다.
export default function MarketVerify() {
  const [params, setParams] = useSearchParams()
  const ticker = params.get('ticker') ?? ''
  const date = params.get('date') ?? ''
  const [data, setData] = useState<VerifyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // alive 플래그: 종목·날짜를 빠르게 바꿔도 늦게 도착한 이전 응답은 버린다.
  useEffect(() => {
    if (!ticker) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    getVerify(ticker, date || undefined)
      .then((r) => {
        if (alive) setData(r)
      })
      .catch((e: unknown) => {
        if (alive) {
          setData(null)
          setError(apiErrorMessage(e))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [ticker, date, reloadKey])

  const go = (next: { ticker?: string; date?: string }) => {
    const t = next.ticker ?? ticker
    const d = next.date ?? date
    const p: Record<string, string> = {}
    if (t) p.ticker = t
    if (d) p.date = d
    setParams(p)
  }

  const notes: VerifyReport['notes'] = data?.notes ?? {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">데이터 검증</h1>
        <p className="mt-1 break-keep text-sm text-slate-500">
          종목 하나의 우리 값을 모아 보여줘요. 아래 링크의 외부 사이트와 눈으로 비교하세요(읽기 전용).
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <VerifyStockPicker onPick={(t) => go({ ticker: t })} />
        <div className="flex min-w-0 gap-2">
          <input
            type="date"
            aria-label="기준일"
            value={date || data?.date || ''}
            onChange={(e) => go({ date: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!date}
            onClick={() => go({ date: '' })}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            최신일
          </button>
          <button
            type="button"
            disabled={!ticker || loading}
            onClick={() => setReloadKey((k) => k + 1)}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {!ticker && <p className="text-sm text-slate-400">종목을 검색해 고르세요.</p>}
      {error && <p className="break-keep rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <div className={`space-y-6 transition ${loading ? 'opacity-50' : ''}`}>
          <p className="break-keep text-sm text-slate-600">
            <b className="text-slate-800">{data.profile?.name ?? data.ticker}</b>{' '}
            <span className="text-slate-400">{data.ticker}</span> · 기준일 {data.date ?? '—'}
            {data.date && !data.requested_date ? ' (최신 일봉)' : ''}
          </p>
          {notes.date && (
            <p className="break-keep rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{notes.date}</p>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <ProfileCard data={data.profile} note={notes.profile} />
            <ComputedCard data={data.computed} note={notes.computed} />
            <InvestorCard data={data.investor} note={notes.investor} />
            <BarsCard rows={data.bars} note={notes.bars} className={WIDE} />
            <MembershipsCard rows={data.memberships} note={notes.memberships} className={WIDE} />
            <CanslimCard data={data.canslim} note={notes.canslim} />
            <LinksCard links={data.links} />
            <FundamentalsCard rows={data.fundamentals} note={notes.fundamentals} className={WIDE} />
          </div>
        </div>
      )}
    </div>
  )
}
