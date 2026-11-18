import { useEffect, useState, type ReactNode } from 'react'
import { chipClass } from '../../leaders/components/ui/Chip'
import { MA_SORTS, QUICK, VOL_RATIO_QUICK, sameRange, type MaFilters, type Range } from '../../lib/maScreener'

// 5·20 정배열 스크리너 필터 — 숫자 입력칸(최소~최대) + 원클릭 빠른 칩. 입력칸은 칸을 벗어나거나 Enter 때 적용한다.

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-28 shrink-0 pt-1.5 text-sm font-semibold text-ink">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

// 입력 중에는 화면 상태만 바꾸고, 칸을 벗어나거나 Enter 일 때 한 번 조회한다
function NumInput({ value, onCommit, label, placeholder }: { value: string; onCommit: (v: string) => void; label: string; placeholder: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => draft !== value && onCommit(draft)
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-indigo-400 focus:outline-none"
    />
  )
}

function RangeInputs({ value, onChange, unit, label }: { value: Range; onChange: (r: Range) => void; unit: string; label: string }) {
  return (
    <span className="mr-2 inline-flex items-center gap-1 text-sm text-ink-muted">
      <NumInput value={value.min} onCommit={(min) => onChange({ ...value, min })} label={`${label} 최소`} placeholder="최소" />
      ~
      <NumInput value={value.max} onCommit={(max) => onChange({ ...value, max })} label={`${label} 최대`} placeholder="최대" />
      {unit}
    </span>
  )
}

function QuickChips({ options, value, onChange }: { options: { label: string; range: Range }[]; value: Range; onChange: (r: Range) => void }) {
  return (
    <>
      {options.map((o) => (
        <button key={o.label} type="button" className={chipClass(sameRange(o.range, value))} onClick={() => onChange(o.range)}>
          {o.label}
        </button>
      ))}
    </>
  )
}

export default function MaScreenerFilters({ value, onChange }: { value: MaFilters; onChange: (f: MaFilters) => void }) {
  const set = <K extends keyof MaFilters>(key: K, v: MaFilters[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="divide-y divide-slate-100">
      <Row label="시장">
        {(['ALL', 'KOSPI', 'KOSDAQ'] as const).map((m) => (
          <button key={m} type="button" className={chipClass(value.market === m)} onClick={() => set('market', m)}>
            {m === 'ALL' ? '전체' : m}
          </button>
        ))}
        <label className="ml-1 inline-flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={value.liquidOnly} onChange={(e) => set('liquidOnly', e.target.checked)} />
          유동성 필터(20일 평균 거래대금 10억·1,000원↑)
        </label>
      </Row>
      <Row label="시가총액">
        <RangeInputs value={value.mcap} onChange={(r) => set('mcap', r)} unit="억" label="시가총액" />
        <QuickChips options={QUICK.mcap} value={value.mcap} onChange={(r) => set('mcap', r)} />
      </Row>
      <Row label="거래대금">
        <RangeInputs value={value.value} onChange={(r) => set('value', r)} unit="억" label="거래대금" />
        <QuickChips options={QUICK.value} value={value.value} onChange={(r) => set('value', r)} />
      </Row>
      <Row label="거래량">
        <RangeInputs value={value.volume} onChange={(r) => set('volume', r)} unit="만 주" label="거래량" />
        <span className="text-sm text-ink-muted">20일 평균 대비</span>
        {VOL_RATIO_QUICK.map((o) => (
          <button key={o.label} type="button" className={chipClass(value.volRatioMin.trim() === o.value)} onClick={() => set('volRatioMin', o.value)}>
            {o.label}
          </button>
        ))}
      </Row>
      <Row label="등락률">
        <RangeInputs value={value.chg} onChange={(r) => set('chg', r)} unit="%" label="등락률" />
        <QuickChips options={QUICK.chg} value={value.chg} onChange={(r) => set('chg', r)} />
      </Row>
      <Row label="5·20 이격도">
        <RangeInputs value={value.spread} onChange={(r) => set('spread', r)} unit="%" label="5·20 이격도" />
        <QuickChips options={QUICK.spread} value={value.spread} onChange={(r) => set('spread', r)} />
      </Row>
      <Row label="정렬">
        {MA_SORTS.map((s) => (
          <button key={s.key} type="button" className={chipClass(value.sort === s.key)} onClick={() => set('sort', s.key)}>
            {s.label}
          </button>
        ))}
      </Row>
    </div>
  )
}
