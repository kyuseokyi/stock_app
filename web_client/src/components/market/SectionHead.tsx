import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { chipClass } from '../ui/Chip'

/** 섹션 제목 줄 — 제목 + 기준 시각(캡션) + 더 보기 */
export function SectionHead({ title, caption, more }: { title: string; caption?: string | null; more?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="min-w-0 text-base font-bold text-ink">
        {title} {caption && <span className="whitespace-nowrap text-xs font-normal text-ink-muted">{caption}</span>}
      </h2>
      {more && <Link to={more} className="-my-2 inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-brand-strong">더 보기 ›</Link>}
    </div>
  )
}

/** 섹션 하나만 실패했을 때 — 한 줄 안내 + 다시 시도(나머지 섹션은 그대로 보인다) */
export function SectionError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-2 rounded-card bg-surface p-4">
      <p className="min-w-0 text-sm text-ink-muted">{text}</p>
      <button type="button" onClick={onRetry} className={`${chipClass(false)} shrink-0`}>다시 시도</button>
    </div>
  )
}

/** 칩 줄 — 급등/급락·외국인/기관/연기금 */
export function TabChips<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: [T, ReactNode][]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="mb-2 flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={chipClass(value === v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** AI 문구 근처 안내 */
export const AI_NOTICE = 'AI 분석은 참고용이에요. 투자 권유가 아니에요.'
