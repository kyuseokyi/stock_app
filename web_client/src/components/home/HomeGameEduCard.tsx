import { Link } from 'react-router-dom'
import { useGameAccess } from '../../hooks/useGameAccess'
import { gameVisible } from '../../lib/marketAccess'
import Card from '../ui/Card'

// 홈 중단 '오늘의 실전 투자 교육' — 블로그에서 배운 원칙을 게임·차트 퀴즈로 연습하도록 게임 탭으로 안내.
// 두 버튼 모두 /game (퀴즈는 게임 화면 안에서 연다 — 로그인이 필요하면 게임 화면이 안내).
const btn =
  'inline-flex min-h-11 flex-1 items-center justify-center rounded-btn px-3 text-sm font-semibold text-ink transition hover:brightness-95'

// 실제 시세 게임이 열려 있지 않으면(A안 — features.real_market 거짓·모름) 카드째 숨긴다(게임 탭과 같은 판단값).
export default function HomeGameEduCard() {
  if (!gameVisible(useGameAccess())) return null
  return (
    <section aria-labelledby="home-edu-title">
      <h2 id="home-edu-title" className="mb-2 text-lg font-bold text-ink">
        <span aria-hidden>🎮 </span>오늘의 실전 투자 교육
      </h2>
      <Card>
        <p className="text-sm text-ink">블로그에서 배운 투자 원칙, 실전 차트 게임과 퀴즈로 연습해 보세요.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
          <Link to="/game" className={`${btn} bg-brand`}>
            <span aria-hidden>📈&nbsp;</span>실시간 모의 트레이딩
          </Link>
          <Link to="/game" className={`${btn} bg-fill`}>
            <span aria-hidden>🧩&nbsp;</span>10초 차트 퀴즈
          </Link>
        </div>
      </Card>
    </section>
  )
}
