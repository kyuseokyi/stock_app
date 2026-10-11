// 토스 스타일 카드: surface 채움, 큰 라운드
export default function Card({ className = '', children, ...props }) {
  return (
    <div className={`rounded-card bg-surface p-4 ${className}`} {...props}>
      {children}
    </div>
  )
}
