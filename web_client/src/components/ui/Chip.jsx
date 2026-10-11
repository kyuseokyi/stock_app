// NavLink 등 다른 엘리먼트에도 칩 스타일을 입히기 위한 클래스 헬퍼
export function chipClass(active) {
  return `inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-muted hover:bg-line'
  }`
}

// 정적 칩(span). 선택 상태는 active로.
export default function Chip({ active = false, className = '', children, ...props }) {
  return (
    <span className={`${chipClass(active)} ${className}`} {...props}>
      {children}
    </span>
  )
}
