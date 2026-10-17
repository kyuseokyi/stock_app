import { useEffect, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import AcademyModal from '../components/game/AcademyModal'
import ActivePositionCard from '../components/game/ActivePositionCard'
import ChartQuizModal from '../components/game/ChartQuizModal'
import CoachBanner from '../components/game/CoachBanner'
import MarketStatusBanner from '../components/game/MarketStatusBanner'
import GameHeader from '../components/game/GameHeader'
import GameRulesModal from '../components/game/GameRulesModal'
import LeaderboardModal from '../components/game/LeaderboardModal'
import NudgeToaster from '../components/game/NudgeToaster'
import OrderPanel from '../components/game/OrderPanel'
import QuestModal from '../components/game/QuestModal'
import QuizBanner from '../components/game/QuizBanner'
import SentimentBar from '../components/game/SentimentBar'
import StreakRewardModal from '../components/game/StreakRewardModal'
import TradingChart from '../components/game/TradingChart'
import { useGameRules } from '../hooks/useGameRules'
import { useGameWebSocket } from '../hooks/useGameWebSocket'
import { isQuizPrimeTime } from '../lib/quiz'
import { useAuthStore } from '../store/auth'
import { useTradingGameStore } from '../store/tradingGame'
import type { Leverage, OrderOptions, Ratio, Side } from '../types/game'

const RANK_POLL_MS = 30_000
const PRIME_CHECK_MS = 60_000

type ActiveModal = 'ranking' | 'rules' | 'quest' | 'academy' | 'quiz' | 'streak' | null
type PrivateModal = Exclude<ActiveModal, 'ranking' | 'rules' | null>

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면
// 모달은 한 번에 하나(activeModal). 랭킹·규칙은 공개, 퀘스트·아카데미·퀴즈는 로그인 필요.
export default function GamePage() {
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const expireSession = useAuthStore((s) => s.expireSession)
  const loggedIn = token !== null
  const {
    status, season, account, position, myRank, coach, academyUnlocked, streak, quizDisabled, lastPrice, sentiment,
    submitting, closing, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition,
    marketStatus, loadMarketStatus, streamEpoch,
  } = useTradingGameStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()))
  const rulesState = useGameRules() // 공개 /rules — 페이지당 1회 요청(규칙 모달·수수료 안내·심리 바 주기)
  const ready = status === 'ready'

  useEffect(() => {
    loadSeason()
  }, [loadSeason])

  // 장운영 상태 배너 초기값 — 화면을 열 때·WS 재연결/화면 복귀(streamEpoch) 때. 이후 변화는 WS market_status
  useEffect(() => {
    if (ready) void loadMarketStatus()
  }, [ready, season?.ticker, streamEpoch, loadMarketStatus])

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return
    if (loggedIn) loadPrivate()
    else resetPrivate()
  }, [ready, loggedIn, loadPrivate, resetPrivate])

  // 로그아웃 시 로그인 전용 모달 닫기(랭킹·규칙은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' || m === 'rules' ? m : null))
  }, [loggedIn])

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신
  useEffect(() => {
    if (!ready || !loggedIn) return
    const t = setInterval(() => refreshRank(), RANK_POLL_MS)
    return () => clearInterval(t)
  }, [ready, loggedIn, refreshRank])

  // 장 마감 후/주말 퀴즈 배너 — 1분마다 재판정(페이지를 켜 둔 채 15:30 을 넘기는 경우)
  useEffect(() => {
    const t = setInterval(() => setPrimeTime(isQuizPrimeTime(new Date())), PRIME_CHECK_MS)
    return () => clearInterval(t)
  }, [])

  // 4401 → 로그아웃 + 안내(reason 'SESSION_REPLACED' = 다른 기기 로그인, 그 외 만료)
  useGameWebSocket(token, ready, (reason) =>
    expireSession(token, reason === 'SESSION_REPLACED' ? 'replaced' : 'expired'),
  )

  if (status === 'unavailable' || status === 'no-season') {
    return (
      <EmptyState
        emoji="🎮"
        title="시즌을 준비하고 있어요"
        description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
      />
    )
  }
  if (status === 'error') {
    return (
      <EmptyState
        emoji="🔌"
        title="게임 서버에 연결할 수 없어요"
        description="잠시 후 다시 시도해 주세요."
        action={<Button onClick={() => loadSeason()}>다시 시도</Button>}
      />
    )
  }
  if (!ready || !season) return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage, opts?: OrderOptions) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    placeOrder(side, ratio, leverage, opts)
  }

  const openPrivate = (m: PrivateModal) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    setActiveModal(m)
  }
  const closeModal = () => setActiveModal(null)

  return (
    // lg 미만은 OrderPanel 이 화면 아래 고정 바 → 마지막 내용이 가리지 않게 그 높이만큼 아래 여백.
    // lg 이상은 2단(왼쪽 차트·정보 / 오른쪽 주문 패널이 스크롤을 따라옴) — 노트북에서도 버튼이 늘 보이게
    <div className="space-y-3 pb-32 sm:space-y-4 lg:pb-0">
      <GameHeader
        season={season}
        account={account}
        myRank={myRank}
        loggedIn={loggedIn}
        streak={streak}
        showQuiz={!quizDisabled}
        onOpenRanking={() => setActiveModal('ranking')}
        onOpenQuest={() => openPrivate('quest')}
        onOpenQuiz={() => openPrivate('quiz')}
        onOpenStreak={() => openPrivate('streak')}
        onOpenRules={() => setActiveModal('rules')}
      />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4">
        <div className="space-y-3 sm:space-y-4">
          {/* 차트를 위로 — 모바일에서 차트와 하단 주문 바가 한 화면에 들어오게. 코치·심리·안내는 차트 아래 */}
          <MarketStatusBanner status={marketStatus} />
          <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
          {position && (
            <ActivePositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => closePosition()} />
          )}
          {!loggedIn && <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">로그인하면 주문할 수 있어요</p>}
          <CoachBanner coach={coach} />
          <SentimentBar sentiment={sentiment} intervalSec={rulesState.rules?.sentiment_interval_sec} />
          {primeTime && !quizDisabled && <QuizBanner onOpen={() => openPrivate('quiz')} />}
        </div>
        {/* top: 고정 헤더(약 101px) 아래 여백 */}
        <aside className="lg:sticky lg:top-[7.5rem]">
          <OrderPanel
            hasPosition={position !== null}
            academyUnlocked={academyUnlocked}
            submitting={submitting}
            onOrder={handleOrder}
            onLockedLeverage={() => openPrivate('academy')}
            feePct={rulesState.rules?.fee_roundtrip_pct ?? null}
            onOpenRules={() => setActiveModal('rules')}
          />
        </aside>
      </div>
      {/* 모달은 NudgeToaster 보다 먼저 렌더 — 같은 z-40 에서 토스트가 모달 위에 보이게 */}
      {activeModal === 'ranking' && <LeaderboardModal seasonId={season.id} seasonPeriod={season.period} myUserId={userId} onClose={closeModal} />}
      {activeModal === 'rules' && <GameRulesModal rulesState={rulesState} season={season} onClose={closeModal} />}
      {activeModal === 'quest' && <QuestModal onClose={closeModal} />}
      {activeModal === 'academy' && <AcademyModal onClose={closeModal} />}
      {activeModal === 'quiz' && <ChartQuizModal onClose={closeModal} />}
      {activeModal === 'streak' && <StreakRewardModal onClose={closeModal} />}
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
