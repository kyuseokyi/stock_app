import { chipClass } from '../ui/Chip'
import type { GroupSort, Period, TreemapSize } from '../../types/market'

export type GroupView = 'list' | 'treemap'

export interface GroupControlValue {
  view: GroupView
  period: Period
  sort: GroupSort
  size: TreemapSize
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

// 보기(목록/트리맵)·기간·정렬(목록)·크기(트리맵) 칩.
export default function GroupControls({ value, onChange }: { value: GroupControlValue; onChange: (v: GroupControlValue) => void }) {
  const set = <K extends keyof GroupControlValue>(k: K, v: GroupControlValue[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Seg label="보기" value={value.view} options={[['list', '목록'], ['treemap', '트리맵']]} onChange={(v) => set('view', v)} />
      <Seg label="기간" value={value.period} options={[['1d', '1일'], ['5d', '5일'], ['20d', '20일']]} onChange={(v) => set('period', v)} />
      {value.view === 'list' ? (
        <Seg label="정렬" value={value.sort} options={[['chg', '등락률'], ['value', '거래대금']]} onChange={(v) => set('sort', v)} />
      ) : (
        <Seg label="크기" value={value.size} options={[['mcap', '시가총액'], ['value', '거래대금']]} onChange={(v) => set('size', v)} />
      )}
    </div>
  )
}
