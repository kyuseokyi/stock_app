import type { CalendarEvent } from '../../types/market'

const DOW = ['일', '월', '화', '수', '목', '금', '토']

function dayLabel(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const base = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DOW[d.getUTCDay()]})`
  return iso === today ? `${base} · 오늘` : base
}

const CATEGORY_STYLE: Record<string, string> = {
  공모주: 'bg-brand-soft text-brand-strong',
  경제지표: 'bg-up-soft text-up',
}

// 일정 — 날짜별로 묶은 목록. 종목 일정은 이름·코드, 상세 문장은 서버가 만든다.
export default function EventList({ events, today }: { events: CalendarEvent[]; today: string }) {
  const days: [string, CalendarEvent[]][] = []
  for (const e of events) {
    const last = days[days.length - 1]
    if (last && last[0] === e.date) last[1].push(e)
    else days.push([e.date, [e]])
  }
  return (
    <div className="space-y-4">
      {days.map(([day, list]) => (
        <section key={day}>
          <h3 className={`mb-1.5 text-sm font-bold ${day === today ? 'text-brand-strong' : 'text-ink'}`}>{dayLabel(day, today)}</h3>
          <ul className="space-y-1.5">
            {list.map((e, i) => (
              <li key={`${e.title}-${i}`} className="flex items-start gap-2 rounded-btn bg-fill px-3 py-2.5">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${CATEGORY_STYLE[e.category] ?? 'bg-surface text-ink-muted'}`}>
                  {e.category}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{e.title}</div>
                  {(e.detail || e.ticker) && (
                    <div className="text-xs text-ink-muted">
                      {[e.name && e.ticker ? `${e.name} (${e.ticker})` : e.ticker, e.detail].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
