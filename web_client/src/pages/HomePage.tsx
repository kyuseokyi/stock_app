import FeaturedPosts from '../components/home/FeaturedPosts'
import MarketNote from '../components/home/MarketNote'

// 홈(/) — '오늘 시장 노트'(날짜·한 줄 요약·지수·주도 테마·업종 지도) + 추천 글 2개.
// 전체 시장은 스크리너 '시장 흐름', 전체 추천 글은 커뮤니티. (앱 홈 탭은 아직 추천 글 — 웹 먼저)
export default function HomePage() {
  return (
    <div className="space-y-8">
      <MarketNote />
      <FeaturedPosts limit={2} />
    </div>
  )
}
