import type { ElementType, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
}

// 토스 스타일 카드: surface(흰색) 채움, 큰 라운드. 블루 배너(코치·퀴즈)만 bg-sky-soft 전달.
// as로 렌더 태그를 바꿔 시맨틱 보존(예: as="article" / as="section").
export default function Card({ as: Tag = 'div', className = '', children, ...props }: CardProps) {
  // className에 bg-* 가 있으면 기본 surface를 빼서 색 충돌(CSS 순서 의존)을 막는다.
  const bg = /(^|\s)bg-/.test(className) ? '' : 'bg-surface'
  return (
    <Tag className={`rounded-card ${bg} p-4 ${className}`} {...props}>
      {children}
    </Tag>
  )
}
