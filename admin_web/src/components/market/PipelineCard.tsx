import { useState } from 'react'
import { formatDateTime, formatSeconds } from '../../lib/marketFormat'
import type { PipelineRecord } from '../../types/marketAdmin'

const STEP_LABEL: Record<string, string> = {
  daily: '전종목 일봉',
  indices_kr: '국내 지수',
  investor: '투자자 순매수',
  canslim: 'CANSLIM',
  market_groups: '시장 그룹',
}

export default function PipelineCard({ record }: { record: PipelineRecord | null }) {
  const [openStep, setOpenStep] = useState<string | null>(null)
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-800">
        최근 일일 파이프라인 <span className="font-normal text-slate-400">(매일 20:30)</span>
      </p>
      {!record ? (
        <p className="mt-2 text-sm text-slate-500">기록이 없어요. 이 기능 배포 뒤 첫 20:30 실행부터 남아요.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(record.started_at)} 시작 · {formatDateTime(record.finished_at)} 끝
          </p>
          <ul className="mt-3 space-y-1">
            {record.steps.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => setOpenStep(openStep === s.name ? null : s.name)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    {s.ok ? '✅' : '❌'} {STEP_LABEL[s.name] ?? s.name}
                  </span>
                  <span className="text-xs text-slate-500">{formatSeconds(s.seconds)}</span>
                </button>
                {openStep === s.name && (
                  <pre className="mx-2 mb-1 whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                    {s.summary}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
