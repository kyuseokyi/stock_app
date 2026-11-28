import { Link } from 'react-router-dom'

interface TabNavProps {
  label: string
  tabs: { to: string; label: string; active: boolean }[]
}

// 화면 안 하위 탭(세그먼트) — 마켓·스크리너 공통. 위쪽 1차 메뉴(밑줄)·화면 안 필터(칩)와 모양을 달리해
// 탭 줄이 겹쳐 보이지 않게 한다. 탭은 최대 4개라 가로 넘김 없이 휴대폰은 줄 전체를 같은 너비로 나눈다. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.
export default function TabNav({ label, tabs }: TabNavProps) {
  return (
    <nav aria-label={label}>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-fill p-1 sm:inline-grid">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.active ? 'page' : undefined}
            // 틀 안쪽 여백(4px) 포함 44px 높이
            className={`inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
              t.active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
