import type { ThemeGroup } from '../../api/dailySurge'
import { fmtRate, fmtValue } from '../../lib/dailySurge'

// 테마 묶음 목록(기본 화면) — 같은 테마에서 같은 방향으로 2종목 이상 급등(급락)한 묶음.
interface Props {
  groups: ThemeGroup[]
  selected: { themeId: number; direction: string } | null
  onSelect: (g: ThemeGroup) => void
}

function Section({ title, sub, tone, items, selected, onSelect }: {
  title: string; sub: string; tone: 'up' | 'down'; items: ThemeGroup[]
} & Omit<Props, 'groups'>) {
  return (
    <section className="flex flex-col gap-2 rounded-card bg-surface p-4">
      <h2 className={`text-base font-bold ${tone === 'up' ? 'text-up' : 'text-down'}`}>
        {title} <span className="text-sm font-normal text-ink-muted">{sub}</span>
      </h2>
      {items.length === 0 && <p className="text-sm text-ink-muted">해당 묶음이 없습니다.</p>}
      {items.map((g) => {
        const on = selected?.themeId === g.theme_id && selected.direction === g.direction
        return (
          <button key={`${g.theme_id}-${g.direction}`} type="button" onClick={() => onSelect(g)} aria-pressed={on}
            className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-field border p-3 text-left transition ${
              on ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-fill'}`}>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm text-ink">{g.theme_name}</strong>
                <span className="text-xs text-ink-muted">{tone === 'up' ? '급등' : '급락'} {g.stock_count}종목</span>
                {g.note && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-strong">메모</span>}
              </div>
              <span className="text-xs text-ink-muted">대장 <strong className="text-ink">{g.leader_name}</strong> · 합계 {fmtValue(g.value_sum)}</span>
              {g.note && <span className="truncate text-xs text-brand-strong">{g.note}</span>}
            </div>
            <span className={`shrink-0 text-lg font-bold ${tone === 'up' ? 'text-up' : 'text-down'}`}>평균 {fmtRate(g.avg_change_rate)}</span>
          </button>
        )
      })}
    </section>
  )
}

export default function ThemeGroupList({ groups, selected, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="급등 테마" sub="같은 테마 2종목 이상 +10% 이상" tone="up"
        items={groups.filter((g) => g.direction === 'up')} selected={selected} onSelect={onSelect} />
      <Section title="급락 테마" sub="같은 테마 2종목 이상 -10% 이하" tone="down"
        items={groups.filter((g) => g.direction === 'down')} selected={selected} onSelect={onSelect} />
    </div>
  )
}
