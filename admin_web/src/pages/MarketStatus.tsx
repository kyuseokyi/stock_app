import { useCallback, useEffect, useState } from 'react'
import { getMarketStatus } from '../api/marketAdmin'
import DatasetCard from '../components/market/DatasetCard'
import JobsPanel from '../components/market/JobsPanel'
import PipelineCard from '../components/market/PipelineCard'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/marketFormat'
import { showToast } from '../lib/toast'
import type { MarketStatusReport } from '../types/marketAdmin'

const Q_LABEL: Record<MarketStatusReport['settings']['q_cumulative'], string> = {
  true: '누적(연초부터)',
  false: '단독 분기',
  unset: '미설정 — CANSLIM C 는 준비 중으로 표시',
}

export default function MarketStatus() {
  const [data, setData] = useState<MarketStatusReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getMarketStatus())
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">데이터 현황</h1>
          <p className="mt-1 text-sm text-slate-500">
            기준 거래일 {data?.ref_date ?? '—'} · 지연은 이 날짜와 비교해요
            {data && ` · ${formatDateTime(data.generated_at)} 조회`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void load()
            setRefreshKey((k) => k + 1)
          }}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.datasets.map((d) => (
              <DatasetCard key={d.key} data={d} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PipelineCard record={data.pipeline} />
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">설정 상태</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">FRED API 키</dt>
                  <dd className={data.settings.fred_key ? 'text-emerald-600' : 'text-red-600'}>
                    {data.settings.fred_key ? '설정됨' : '없음'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">분기 EPS 형식</dt>
                  <dd className="text-right">{Q_LABEL[data.settings.q_cumulative]}</dd>
                </div>
              </dl>
              <p className="mt-3 break-keep text-xs text-slate-400">
                서버 환경 변수에서 읽어요(값 자체는 보여주지 않아요). 분기 EPS 형식은 다음 단계에서 이 화면에서 바꿀 수 있게 돼요.
              </p>
            </div>
          </div>
        </>
      )}

      <JobsPanel refreshKey={refreshKey} />
    </div>
  )
}
