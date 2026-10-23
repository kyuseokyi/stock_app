// 경로별 브라우저 탭 제목(WCAG 2.4.2) — Layout 이 경로가 바뀔 때 넣고, 글·종목 상세는 데이터가 오면 useDocumentTitle 로 구체화한다.
const BRAND = 'StockApp'

const SCREENER: Record<string, string> = {
  market: '시장 요약',
  themes: '테마',
  sectors: '업종',
  calendar: '일정',
  leaders: '주도주 분석',
  finder: '조건검색',
  patterns: '차트 패턴',
}

export const withBrand = (title: string): string => `${title} · ${BRAND}`

export function titleFor(pathname: string, boardName: (id: number) => string): string {
  const [section, sub] = pathname.split('/').filter(Boolean)
  switch (section) {
    case undefined:
      return withBrand('오늘 시장 노트')
    case 'community':
      return withBrand('커뮤니티')
    case 'boards':
      return withBrand(boardName(Number(sub)) || '커뮤니티')
    case 'posts':
      return withBrand('게시글')
    case 'game':
      return withBrand('트레이딩 게임')
    case 'screener':
      return withBrand(SCREENER[sub ?? 'market'] ?? '스크리너')
    case 'stock':
      return withBrand('종목 상세')
    case 'me':
      return withBrand(sub === 'funds' ? '내 펀드' : '내 정보')
    default:
      return BRAND
  }
}
