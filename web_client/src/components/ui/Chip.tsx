import type { HTMLAttributes } from 'react'

// NavLink 등 다른 엘리먼트에도 칩 스타일을 입히기 위한 클래스 헬퍼
export function chipClass(active: boolean): string {
  return `inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active ? 'bg-brand-soft text-brand' : 'bg-fill text-ink-muted hover:brightness-95'
  }`
}

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean
}

// 정적 칩(span). 선택 상태는 active로.
export default function Chip({ active = false, className = '', children, ...props }: ChipProps) {
  return (
    <span className={`${chipClass(active)} ${className}`} {...props}>
      {children}
    </span>
  )
}
