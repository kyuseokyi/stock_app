import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMarketStatus } from '../../api/marketAdmin'
import { datasetStatus } from '../../lib/maScreener'
import type { Dataset } from '../../types/marketAdmin'
import DatasetCard from './DatasetCard'

interface Props {
  /** Dataset.key — 'screener' · 'patterns' */
  datasetKey: string
  /** 카드 제목 — 예: '조건검색(정규장 마감 데이터)' */
  label: string
  /** 최신 기준일과 개수 — 공개 GraphQL 로 센다(데이터 현황 API 에는 이 항목이 없다) */
  load: () => Promise<{ date: string | null; total: number }>
  /** 개수 단위 — 예: '종목' · '종목(형성 중)' */
  unit: string
  /** 실패 안내에 쓰는 이름 — 예: '조건검색' */
  name: string
}

// 관리자 스크리너 화면 상단 갱신 현황 — 최신 기준일·개수 + 데이터 현황의 기준 거래일과 비교한 정상/오래됨.
// (5·20 정배열 화면의 ScreenerDatasetStatus 와 같은 모양. 그 화면은 건드리지 않으려고 따로 둔다.)
// 실패해도 아래 화면은 그대로 쓸 수 있다.
export default function ScreenDatasetStatus({ datasetKey, label, load, unit, name }: Props) {
  const [data, setData] = useState<Dataset | null | 'failed'>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([load(), getMarketStatus().then((r) => r.ref_date).catch(() => null)])
      .then(([ds, refDate]) => {
        if (cancelled) return
        const status = datasetStatus(ds.date, refDate)
        setData({
          key: datasetKey,
          label,
          latest: ds.date ? `${ds.date} 종가 기준` : null,
          count: ds.date ? ds.total : null,
          unit,
          status,
          note: status === 'stale' ? `기준 거래일 ${refDate} 보다 오래됐어요` : status === 'empty' ? '아직 계산된 데이터가 없어요' : '',
        })
      })
      .catch(() => !cancelled && setData('failed'))
    return () => {
      cancelled = true
    }
    // load 는 화면마다 고정 함수 — 처음 한 번만 센다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <div className="min-w-0 flex-1">
        {data === null && <div className="h-[104px] animate-pulse rounded-xl border border-slate-200 bg-white" aria-hidden />}
        {data === 'failed' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            {name} 갱신 상태를 불러오지 못했어요. 아래 화면은 그대로 볼 수 있어요.
          </div>
        )}
        {data !== null && data !== 'failed' && <DatasetCard data={data} />}
      </div>
      <Link
        to="/market/status"
        className="flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-indigo-600 hover:bg-slate-50"
      >
        수집 현황에서 재계산 →
      </Link>
    </div>
  )
}
