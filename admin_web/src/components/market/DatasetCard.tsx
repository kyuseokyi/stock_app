import { useState } from 'react'
import type { Dataset, DatasetStatus } from '../../types/marketAdmin'

const BADGE: Record<DatasetStatus, { label: string; className: string }> = {
  ok: { label: '정상', className: 'bg-emerald-100 text-emerald-700' },
  stale: { label: '오래됨', className: 'bg-red-100 text-red-700' },
  warn: { label: '주의', className: 'bg-amber-100 text-amber-700' },
  empty: { label: '없음', className: 'bg-slate-200 text-slate-600' },
  off: { label: '꺼짐', className: 'bg-slate-100 text-slate-500' },
  error: { label: '오류', className: 'bg-red-600 text-white' },
}

function StatusBadge({ status }: { status: DatasetStatus }) {
  const b = BADGE[status]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.className}`}>{b.label}</span>
}

export default function DatasetCard({ data }: { data: Dataset }) {
  const [open, setOpen] = useState(false)
  const count = data.count != null ? `${data.count.toLocaleString('ko-KR')}${data.unit}` : ''
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{data.label}</p>
        <StatusBadge status={data.status} />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{data.latest ?? '—'}</p>
      <p className="break-keep text-xs text-slate-500">{[count, data.note].filter(Boolean).join(' · ')}</p>
      {data.items && data.items.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-xs font-semibold text-indigo-600">
            {open ? '접기' : `코드별 보기(${data.items.length})`}
          </button>
          {open && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">
              {data.items.map((i) => (
                <li key={i.code} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-600">
                    {i.name ? `${i.name} ` : ''}
                    <span className="text-slate-400">{i.code}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-slate-500">{i.latest ?? '—'}</span>
                    <StatusBadge status={i.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
