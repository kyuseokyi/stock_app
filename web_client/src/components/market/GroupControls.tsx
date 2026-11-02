import { chipClass } from '../ui/Chip'
import type { GroupSort, Period } from '../../types/market'

export interface GroupControlValue {
  period: Period
  sort: GroupSort
}

function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="shrink-0 text-xs text-ink-muted">{label}</span>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={chipClass(value === v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

// 기간·정렬 칩.
export default function GroupControls({ value, onChange }: { value: GroupControlValue; onChange: (v: GroupControlValue) => void }) {
  const set = <K extends keyof GroupControlValue>(k: K, v: GroupControlValue[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Seg label="기간" value={value.period} options={[['1d', '1일'], ['5d', '5일'], ['20d', '20일']]} onChange={(v) => set('period', v)} />
      <Seg label="정렬" value={value.sort} options={[['chg', '등락률'], ['value', '거래대금']]} onChange={(v) => set('sort', v)} />
    </div>
  )
}
