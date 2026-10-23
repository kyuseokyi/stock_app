import Card from './Card'

// 로딩 뼈대 — 데이터가 오기 전에 최종 화면과 같은 자리를 잡아 두어, 도착할 때 아래 내용이 밀리지 않게 한다(레이아웃 이동 방지).
// 움직임 줄이기 설정이면 깜빡임을 멈춘다. 화면 읽기에는 숨기고, 상태 문구는 부르는 쪽 role="status" 로 알린다.
export function Skeleton({ className = '' }: { className?: string }) {
  // className 에 rounded-* 가 있으면 기본 모서리를 빼서 덮어쓸 수 있게(CSS 순서 의존 방지 — Card 와 같은 방식)
  const r = /(^|\s)rounded-/.test(className) ? '' : 'rounded-field'
  return <div aria-hidden className={`animate-pulse bg-fill motion-reduce:animate-none ${r} ${className}`} />
}

/** 목록 뼈대 — 카드 안에 행 n개(행 높이는 실제 목록 행과 비슷하게) */
export function ListSkeleton({ rows = 8, rowClass = 'h-14', label = '목록을 불러오고 있어요' }: { rows?: number; rowClass?: string; label?: string }) {
  return (
    <Card>
      <p role="status" className="sr-only">{label}</p>
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={`flex items-center gap-3 ${rowClass}`}>
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </Card>
  )
}
