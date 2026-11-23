import type { ScreenerFeatures } from '../api/screenerFeatures'
import { gameTabVisible } from './marketAccess'
import { screenerMenuVisible } from './screenerFeatures'

// 1차 메뉴 판정 — 순수 함수. 순서는 앱 하단 탭과 같다.
// 기본 5탭: 홈 · 내 펀드 · 블로그 · 게임 · 시장(docs/app_identity_and_nav_redesign_spec.md 1-1).
// 스크리너는 종목 찾기 스위치가 켜졌을 때만 시장 옆에 붙는다. 내정보('me')는 탭이 아니라 헤더 우측 버튼으로 옮겼다
// (섹션 값은 경로 판정·화면 폭 판단용으로 남겨 둔다).
export type Section = 'home' | 'funds' | 'market' | 'screener' | 'community' | 'game' | 'me'

const SECTIONS: Section[] = ['home', 'funds', 'community', 'game', 'market', 'screener']

/** 지금 보여 줄 메뉴 — 스크리너는 종목 찾기 스위치가 켜지고 시세 열람일 때만, 게임은 보여 줄 게임이 있을 때만
 *  (관리자 REAL_MARKET 스위치 ON 이면 실시간 허용일 때, OFF 면 가상 데이터 게임 공개일 때 — gameTabVisible). 로딩·오류는 숨김 */
export function visibleSections(
  features: ScreenerFeatures | null,
  realMarket: boolean | null,
  eduEnabled: boolean | null = null,
  realMarketSwitch: boolean | null = null,
): Section[] {
  return SECTIONS.filter(
    (s) => (s !== 'screener' || screenerMenuVisible(features)) && (s !== 'game' || gameTabVisible(realMarket, eduEnabled, realMarketSwitch)),
  )
}

/**
 * 경로 → 섹션. 게시판·글 상세는 블로그(community)로, 종목 상세는 항상 보이는 시장으로 본다.
 * 내 펀드(/me/funds, /me/funds/:id)는 '내 펀드' 탭, 그 밖의 /me 는 'me'(탭 선택 표시 없음).
 * 어느 메뉴에도 속하지 않는 경로(404·로그인 완료 등)는 null — 선택 표시 없음
 */
export function sectionOf(pathname: string): Section | null {
  const [root, sub] = pathname.split('/').filter(Boolean)
  switch (root) {
    case undefined:
      return 'home'
    case 'market':
    case 'stock':
      return 'market'
    case 'screener':
      return 'screener'
    case 'game':
    case 'edu-game':
      return 'game'
    case 'me':
      return sub === 'funds' ? 'funds' : 'me'
    case 'community':
    case 'boards':
    case 'posts':
      return 'community'
    default:
      return null
  }
}
