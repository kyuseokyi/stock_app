// 토스 스타일 카드: surface 채움, 큰 라운드.
// as로 렌더 태그를 바꿔 시맨틱 보존(예: as="article" / as="section").
export default function Card({ as: Tag = 'div', className = '', children, ...props }) {
  return (
    <Tag className={`rounded-card bg-surface p-4 ${className}`} {...props}>
      {children}
    </Tag>
  )
}
