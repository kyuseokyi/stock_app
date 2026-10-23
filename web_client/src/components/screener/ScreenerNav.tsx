import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ScrollRow from '../ui/ScrollRow'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import type { ScreenerFeatures } from '../../api/screenerFeatures'

// 스크리너 탭 — 한 줄 7개를 두 묶음(시장 / 종목 찾기)으로. 예전 '3그룹 버튼 + 하위 탭' 2층을 1층으로 줄여 지금 위치가 한 줄에서 보인다.
// 주소(/screener/<tab>)는 예전 7개 탭 그대로라 기존 링크·즐겨찾기가 깨지지 않는다.
type Tab = 'market' | 'themes' | 'sectors' | 'calendar' | 'leaders' | 'finder' | 'patterns'

// feature 가 있는 탭은 관리자 스위치가 켜졌을 때만 보인다(관리자 > 스크리너 설정)
const GROUPS: { key: string; label: string; tabs: { to: Tab; label: string; feature?: keyof ScreenerFeatures }[] }[] = [
  {
    key: 'market',
    label: '시장',
    tabs: [
      { to: 'market', label: '세계 시장' },
      { to: 'themes', label: '테마' },
      { to: 'sectors', label: '업종' },
      { to: 'calendar', label: '일정' },
    ],
  },
  {
    key: 'stocks',
    label: '종목 찾기',
    tabs: [
      { to: 'leaders', label: '주도주' },
      { to: 'finder', label: '조건검색', feature: 'finder' },
      { to: 'patterns', label: '패턴', feature: 'patterns' },
    ],
  },
]

export default function ScreenerNav() {
  const { pathname } = useLocation()
  const active = (pathname.split('/')[2] ?? 'market') as Tab
  const ref = useRef<HTMLElement>(null)
  const features = useScreenerFeatures()
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => !t.feature || features?.[t.feature] === true) }))

  // 좁은 화면에서 오른쪽 끝 탭(패턴 등)으로 들어오면 줄을 넘겨 지금 탭이 보이게 한다(세로 스크롤은 건드리지 않음).
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <nav ref={ref} aria-label="스크리너">
      <ScrollRow fade="canvas" className="gap-0 border-b border-line pb-0">
        {groups.map((g, i) => (
          <div
            key={g.key}
            role="group"
            aria-labelledby={`screener-group-${g.key}`}
            className={`flex shrink-0 flex-col ${i > 0 ? 'ml-4 border-l border-line pl-4' : ''}`}
          >
            <span id={`screener-group-${g.key}`} className="pt-1 text-xs text-ink-muted">{g.label}</span>
            <div className="flex gap-5">
              {g.tabs.map((t) => (
                <Link
                  key={t.to}
                  to={`/screener/${t.to}`}
                  aria-current={t.to === active ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 text-sm font-semibold transition ${
                    t.to === active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </ScrollRow>
    </nav>
  )
}
