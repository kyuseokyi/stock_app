// web_client/src/components/ui/PageHeader.tsx 복사본 — 원본과 같이 고칠 것
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** 제목 위 '‹ 내정보' 같은 상위 화면 링크 */
  back?: { to: string; label: string }
  className?: string
}

// 페이지 제목 — DESIGN.md Headline(24px·700) + 보조 설명. 화면마다 h1 크기가 달라지지 않게 한곳에 둔다.
export default function PageHeader({ title, description, back, className = '' }: PageHeaderProps) {
  return (
    <header className={className}>
      {back && (
        <Link to={back.to} className="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
          ‹ {back.label}
        </Link>
      )}
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      {description && <p className="mt-1 text-pretty text-sm text-ink-muted">{description}</p>}
    </header>
  )
}
