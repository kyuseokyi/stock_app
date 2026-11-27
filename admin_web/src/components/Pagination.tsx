// 공용 쪽 넘김 — 서버가 준 {page, pages, total} 로 '이전 · n / N · 다음'. 목록 화면은 모두 이 부품을 쓴다(2026-11-27 사용자 요청:
// 관리자·사용자, 웹·모바일 모든 목록에 페이징). 쪽 번호는 1부터. 한 쪽뿐이면 개수만 보여 준다.
interface Props {
  page: number
  pages: number
  total: number
  onChange: (page: number) => void
  disabled?: boolean
  /** 개수 단위(예: '종목', '개') */
  unit?: string
}

export default function Pagination({ page, pages, total, onChange, disabled = false, unit = '개' }: Props) {
  const btn = 'h-11 min-w-[44px] rounded-btn bg-surface px-3 text-sm text-ink disabled:opacity-40'
  return (
    <nav aria-label="쪽 넘김" className="flex flex-wrap items-center justify-center gap-2 py-3">
      <span className="text-xs text-ink-muted">총 {total.toLocaleString('ko-KR')}{unit}</span>
      {pages > 1 && (
        <>
          <button type="button" className={btn} aria-label="첫 쪽" disabled={disabled || page <= 1} onClick={() => onChange(1)}>«</button>
          <button type="button" className={btn} aria-label="이전 쪽" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>‹</button>
          <span className="min-w-[64px] text-center text-sm text-ink" aria-current="page">{page} / {pages}</span>
          <button type="button" className={btn} aria-label="다음 쪽" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>›</button>
          <button type="button" className={btn} aria-label="마지막 쪽" disabled={disabled || page >= pages} onClick={() => onChange(pages)}>»</button>
        </>
      )}
    </nav>
  )
}
