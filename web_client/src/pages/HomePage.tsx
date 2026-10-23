import FeaturedPosts from '../components/home/FeaturedPosts'
import MarketNote from '../components/home/MarketNote'
import { useMediaQuery } from '../hooks/useMediaQuery'

// 홈(/) — '오늘 시장 노트'(날짜·한 줄 요약·지수·주도 테마·업종 지도) + 추천 글 2개.
// 전체 시장은 스크리너 '시장 흐름', 전체 추천 글은 커뮤니티. (앱 홈 탭은 아직 추천 글 — 웹 먼저)
// 넓은 화면(lg+): 노트(본문) + 추천 글 옆 칸 2단, 옆 칸은 세로 공간이 넉넉해 4개.
export default function HomePage() {
  const wide = useMediaQuery('(min-width: 1024px)')
  return (
    <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8 lg:space-y-0">
      <MarketNote />
      <aside aria-label="추천 글">
        <FeaturedPosts limit={wide ? 4 : 2} />
      </aside>
    </div>
  )
}
