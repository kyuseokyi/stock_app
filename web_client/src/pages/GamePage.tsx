import { useEffect, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import AcademyModal from '../components/game/AcademyModal'
import ActivePositionCard from '../components/game/ActivePositionCard'
import ChartQuizModal from '../components/game/ChartQuizModal'
import CoachBanner from '../components/game/CoachBanner'
import GameHeader from '../components/game/GameHeader'
import LeaderboardModal from '../components/game/LeaderboardModal'
import NudgeToaster from '../components/game/NudgeToaster'
import OrderPanel from '../components/game/OrderPanel'
import QuestModal from '../components/game/QuestModal'
import QuizBanner from '../components/game/QuizBanner'
import SentimentBar from '../components/game/SentimentBar'
import TradingChart from '../components/game/TradingChart'
import { useGameWebSocket } from '../hooks/useGameWebSocket'
import { isQuizPrimeTime } from '../lib/quiz'
import { useAuthStore } from '../store/auth'
import { useTradingGameStore } from '../store/tradingGame'
import type { Leverage, Ratio, Side } from '../types/game'

const RANK_POLL_MS = 30_000
const PRIME_CHECK_MS = 60_000

type ActiveModal = 'ranking' | 'quest' | 'academy' | 'quiz' | null
type PrivateModal = Exclude<ActiveModal, 'ranking' | null>

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면
// 모달은 한 번에 하나(activeModal). 랭킹은 공개, 퀘스트·아카데미·퀴즈는 로그인 필요.
export default function GamePage() {
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const loggedIn = token !== null
  const {
    status, season, account, position, myRank, coach, academyUnlocked, streak, quizDisabled, lastPrice, sentiment,
    submitting, closing, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, pushToast,
  } = useTradingGameStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()))
  const ready = status === 'ready'

  useEffect(() => {
    loadSeason()
  }, [loadSeason])

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return
    if (loggedIn) loadPrivate()
    else resetPrivate()
  }, [ready, loggedIn, loadPrivate, resetPrivate])

  // 로그아웃 시 로그인 전용 모달 닫기(랭킹은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' ? m : null))
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

  useGameWebSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
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

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    placeOrder(side, ratio, leverage)
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
    <div className="space-y-4">
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
      />
      <CoachBanner coach={coach} />
      {loggedIn ? (
        <SentimentBar sentiment={sentiment} />
      ) : (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">로그인하면 실시간 시세와 주문이 열려요</p>
      )}
      <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
      {position && (
        <ActivePositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => closePosition()} />
      )}
      {primeTime && !quizDisabled && <QuizBanner onOpen={() => openPrivate('quiz')} />}
      <OrderPanel
        hasPosition={position !== null}
        academyUnlocked={academyUnlocked}
        submitting={submitting}
        onOrder={handleOrder}
        onLockedLeverage={() => openPrivate('academy')}
      />
      {/* 모달은 NudgeToaster 보다 먼저 렌더 — 같은 z-40 에서 토스트가 모달 위에 보이게 */}
      {activeModal === 'ranking' && <LeaderboardModal seasonId={season.id} myUserId={userId} onClose={closeModal} />}
      {activeModal === 'quest' && <QuestModal onClose={closeModal} />}
      {activeModal === 'academy' && <AcademyModal onClose={closeModal} />}
      {activeModal === 'quiz' && <ChartQuizModal onClose={closeModal} />}
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
