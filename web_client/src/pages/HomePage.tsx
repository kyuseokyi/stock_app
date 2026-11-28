import AdSlot from '../components/ads/AdSlot'
import FeaturedPosts from '../components/home/FeaturedPosts'
import HomeFundCard from '../components/home/HomeFundCard'
import HomeGameEduCard from '../components/home/HomeGameEduCard'
import HomeMarketReference from '../components/home/HomeMarketReference'
import { useAdConfig } from '../hooks/useAdConfig'
import { useMediaQuery } from '../hooks/useMediaQuery'

// 홈(/) — 3단(docs/app_identity_and_nav_redesign_spec.md 2장):
//   ① 내 펀드 카드(최상단) → ② 추천 블로그 글 + 오늘의 실전 투자 교육(게임·퀴즈) → ③ 오늘 시장 참고(지수·환율 작게, 시장 더보기).
// 넓은 화면(lg+)의 ②는 추천 글(본문) + 교육 카드 옆 칸 2단, 추천 글은 4개(좁은 화면 2개).
// 광고 자리(WEB_HOME_SIDEBAR)는 교육 카드 아래 — 넓은 화면은 옆 칸, 좁은 화면은 시장 참고 바로 위.
// 예전 홈의 '오늘 시장 노트'(components/home/MarketNote.tsx)는 지우지 않고 보존한다 — 다시 켜려면 여기서 바꿔 끼운다.
export default function HomePage() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const ads = useAdConfig()
  return (
    <>
      {/* 탭 제목·스크린리더용 페이지 제목(화면에는 섹션 제목이 보인다).
          space-y-8 밖에 둔다 — 안에 두면 보이지 않는 이 제목이 '앞 형제'가 되어 첫 섹션 위에 여백 32px 이 더 붙는다 */}
      <h1 className="sr-only">FunNote 홈</h1>
      <div className="space-y-8">
        <HomeFundCard />

        {/* 옆 칸(교육 카드·광고)이 둘 다 없으면 aside 가 비므로 숨기고, 넓은 화면도 1단으로 — 빈 20rem 칸이 남지 않게 */}
        <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8 lg:space-y-0 lg:[&:has(>aside:empty)]:grid-cols-1">
          <FeaturedPosts
            limit={wide ? 4 : 2}
            title={
              <>
                <span aria-hidden>📌 </span>추천 블로그 글
              </>
            }
            moreLabel="블로그 전체 보기 ›"
          />
          <aside aria-label="실전 투자 교육" className="empty:hidden">
            <HomeGameEduCard />
            <AdSlot config={ads} slotKey="WEB_HOME_SIDEBAR" className="mt-3" />
          </aside>
        </div>

        <HomeMarketReference />
      </div>
    </>
  )
}
