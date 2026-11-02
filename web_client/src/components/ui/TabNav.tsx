import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import ScrollRow from './ScrollRow'

interface TabNavProps {
  label: string
  tabs: { to: string; label: string; active: boolean }[]
}

// 화면 안 한 줄 탭(밑줄) — 마켓·스크리너 공통. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.
export default function TabNav({ label, tabs }: TabNavProps) {
  const ref = useRef<HTMLElement>(null)
  const activeTo = tabs.find((t) => t.active)?.to

  // 좁은 화면에서 오른쪽 끝 탭으로 들어오면 줄을 넘겨 지금 탭이 보이게 한다(세로 스크롤은 건드리지 않음)
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTo])

  return (
    <nav ref={ref} aria-label={label}>
      <ScrollRow fade="canvas" className="gap-5 border-b border-line pb-0">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.active ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 text-sm font-semibold transition ${
              t.active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </ScrollRow>
    </nav>
  )
}
