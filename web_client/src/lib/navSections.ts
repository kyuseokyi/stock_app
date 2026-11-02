import type { ScreenerFeatures } from '../api/screenerFeatures'
import { screenerMenuVisible } from './screenerFeatures'

// 1차 메뉴 판정 — 순수 함수. 순서는 앱 하단 탭과 같다.
export type Section = 'home' | 'market' | 'screener' | 'community' | 'game' | 'me'

const SECTIONS: Section[] = ['home', 'market', 'screener', 'community', 'game', 'me']

/** 지금 보여 줄 메뉴 — 스크리너는 종목 찾기 스위치가 켜졌을 때만(로딩·오류는 숨김) */
export function visibleSections(features: ScreenerFeatures | null): Section[] {
  return SECTIONS.filter((s) => s !== 'screener' || screenerMenuVisible(features))
}

/**
 * 경로 → 섹션. 게시판·글 상세는 커뮤니티로, 종목 상세는 항상 보이는 마켓으로 본다.
 * 어느 메뉴에도 속하지 않는 경로(404·로그인 완료 등)는 null — 선택 표시 없음
 */
export function sectionOf(pathname: string): Section | null {
  const [root] = pathname.split('/').filter(Boolean)
  switch (root) {
    case undefined:
      return 'home'
    case 'market':
    case 'stock':
      return 'market'
    case 'screener':
      return 'screener'
    case 'game':
      return 'game'
    case 'me':
      return 'me'
    case 'community':
    case 'boards':
    case 'posts':
      return 'community'
    default:
      return null
  }
}
