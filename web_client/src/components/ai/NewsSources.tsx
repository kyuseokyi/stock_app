import { formatSourceDate, type NewsSource } from '../../lib/newsSources'

// AI 요약 카드 아래 "참고 기사" — 작은 제목 + 링크 최대 3개(제목 한 줄 말줄임, 날짜가 있으면 M.D), 새 탭으로 연다.
// sources 가 비거나 없으면 아무것도 그리지 않는다. 링크·버튼 안에 넣지 말 것(<a> 중첩 금지) — 형제로 둔다.
export default function NewsSources({ sources, className = '' }: { sources: NewsSource[] | undefined; className?: string }) {
  if (!sources || sources.length === 0) return null
  return (
    <div className={className}>
      <p className="text-[11px] font-bold text-ink-muted">참고 기사</p>
      <ul className="mt-0.5 space-y-0.5">
        {sources.map((s) => {
          const date = formatSourceDate(s.pubDate)
          return (
            <li key={s.url} className="flex min-w-0 items-center gap-1.5 text-xs">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-brand-strong underline underline-offset-2 hover:brightness-90"
              >
                {s.title}
              </a>
              {date && <span className="shrink-0 text-[11px] text-ink-muted">{date}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
