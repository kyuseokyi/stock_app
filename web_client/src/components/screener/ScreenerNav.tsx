import { Link, useLocation } from 'react-router-dom'

// 스크리너 탭 — 질문 단위 3그룹(시장 흐름 / 일정 / 종목 찾기) + 고른 그룹의 하위 탭(밑줄).
// 주소(/screener/<tab>)는 예전 7개 탭 그대로라 기존 링크·즐겨찾기가 깨지지 않는다.
type Tab = 'market' | 'themes' | 'sectors' | 'calendar' | 'leaders' | 'finder' | 'patterns'

const GROUPS: { key: string; label: string; tabs: { to: Tab; label: string }[] }[] = [
  { key: 'flow', label: '시장 흐름', tabs: [{ to: 'market', label: '요약' }, { to: 'themes', label: '테마' }, { to: 'sectors', label: '업종' }] },
  { key: 'calendar', label: '일정', tabs: [{ to: 'calendar', label: '일정' }] },
  { key: 'stocks', label: '종목 찾기', tabs: [{ to: 'leaders', label: '주도주' }, { to: 'finder', label: '조건검색' }, { to: 'patterns', label: '패턴' }] },
]

export default function ScreenerNav() {
  const { pathname } = useLocation()
  const active = (pathname.split('/')[2] ?? 'market') as Tab
  const group = GROUPS.find((g) => g.tabs.some((t) => t.to === active)) ?? GROUPS[0]
  return (
    <nav aria-label="스크리너" className="space-y-2">
      <div className="grid grid-cols-3 gap-1 rounded-btn bg-fill p-1">
        {GROUPS.map((g) => {
          const on = g.key === group.key
          return (
            <Link
              key={g.key}
              to={`/screener/${g.tabs[0].to}`}
              aria-current={on ? 'true' : undefined}
              className={`flex h-10 items-center justify-center rounded-field text-sm font-semibold transition ${
                on ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {g.label}
            </Link>
          )
        })}
      </div>
      {group.tabs.length > 1 && (
        <div className="flex gap-5 border-b border-line px-1">
          {group.tabs.map((t) => (
            <Link
              key={t.to}
              to={`/screener/${t.to}`}
              aria-current={t.to === active ? 'page' : undefined}
              className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-sm font-semibold transition ${
                t.to === active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  )
}
