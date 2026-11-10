// 경로별 브라우저 탭 제목(WCAG 2.4.2) — Layout 이 경로가 바뀔 때 넣고, 글·종목 상세는 데이터가 오면 useDocumentTitle 로 구체화한다.
const BRAND = 'FunNote'

const MARKET: Record<string, string> = {
  themes: '테마',
  sectors: '업종',
  calendar: '일정',
}

const SCREENER: Record<string, string> = {
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
    case 'market':
      return withBrand((sub && MARKET[sub]) || '오늘의 증시')
    case 'screener':
      return withBrand((sub && (MARKET[sub] ?? SCREENER[sub])) || '스크리너')
    case 'stock':
      return withBrand('종목 상세')
    case 'me':
      return withBrand(sub === 'funds' ? '내 펀드' : '내 정보')
    case 'auth':
      return BRAND
    default:
      return withBrand('페이지를 찾을 수 없어요') // App 의 404(NotFoundPage)와 같은 경로
  }
}
