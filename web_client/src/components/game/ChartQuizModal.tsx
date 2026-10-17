import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import QuizExplanation from './QuizExplanation'
import QuizMiniChart, { QUIZ_MA_COLORS } from './QuizMiniChart'
import { getRandomQuiz, submitQuiz } from '../../api/game'
import { formatKrw, formatPct, pnlClass } from '../../lib/format'
import { apiErrorCode, gameErrorMessage } from '../../lib/gameErrors'
import { quizSecondsLeft } from '../../lib/quiz'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { QuizChoice, QuizQuestion, QuizResult } from '../../types/game'

const TICK_MS = 200

// result === null → 0초까지 고르지 않아 제출하지 않은 로컬 시간 초과(정답 미공개)
type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'playing'; quiz: QuizQuestion; startedAt: number }
  | { kind: 'submitting'; quiz: QuizQuestion; choice: QuizChoice }
  | { kind: 'result'; result: QuizResult | null; choice: QuizChoice | null; quiz: QuizQuestion | null }
  | { kind: 'error'; message: string; retryable: boolean }
  | { kind: 'exhausted' }

const choiceLabel = (c: QuizChoice): string => (c === 'UP' ? '📈 상승' : '📉 하락')

function rewardLine(r: QuizResult): string | null {
  if (r.rewarded) return `+${formatKrw(r.reward_cash)} 지급`
  if (r.timed_out) return '시간 초과로 보상 없음'
  if (r.correct) return '정답이에요! 이번에는 보상이 지급되지 않았어요 (하루 3회 한도 또는 보상 지급 불가)'
  return null
}

// 야간 10초 차트 퀴즈 — intro → loading → playing → submitting → result (오류 시 error).
// 판정은 서버 시각 기준(10초 + 유예 3초). 프론트 카운트다운은 연출이며 0초가 되면 제출하지 않고 시간 초과 처리.
export default function ChartQuizModal({ onClose }: { onClose: () => void }) {
  const markQuizDisabled = useTradingGameStore((s) => s.markQuizDisabled)
  const setStreak = useTradingGameStore((s) => s.setStreak)
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' })
  const [now, setNow] = useState(() => Date.now())
  const aliveRef = useRef(true) // 언마운트 후 늦은 응답이 화면 전환·onClose 를 부르지 않도록
  const busyRef = useRef(false) // 시작/제출 중복 클릭 방지(리렌더 전 연타 대비)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 카운트다운 — playing 동안만 200ms 간격 갱신. 단계가 바뀌거나 언마운트되면 정리
  const playing = phase.kind === 'playing'
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [playing])

  const secondsLeft = phase.kind === 'playing' ? quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, now) : 0

  // 0초 도달(미선택) → 서버에 제출하지 않고 로컬 시간 초과. playing 에서만 전환(submitting 중엔 무시)
  useEffect(() => {
    if (phase.kind === 'playing' && secondsLeft === 0) setPhase({ kind: 'result', result: null, choice: null, quiz: phase.quiz })
  }, [phase, secondsLeft])

  const handleError = (err: unknown) => {
    const code = apiErrorCode(err)
    if (code === 'FEATURE_DISABLED') {
      markQuizDisabled()
      pushToast({ kind: 'info', icon: '🧩', message: gameErrorMessage(err) })
      if (aliveRef.current) onClose()
      return
    }
    if (!aliveRef.current) return
    if (code === 'NO_QUIZ_AVAILABLE') setPhase({ kind: 'exhausted' }) // 오류가 아니라 '다 풀었다' 안내
    else setPhase({ kind: 'error', message: gameErrorMessage(err), retryable: true })
  }

  const start = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ kind: 'loading' })
    try {
      const quiz = await getRandomQuiz()
      if (!aliveRef.current) return
      const t = Date.now() // 응답 도착 시점부터 카운트(서버 served_at 보다 늦게 시작 — 유예 3초가 흡수)
      if (quiz.chart_snapshot.length === 0) {
        setPhase({ kind: 'error', message: '문제를 불러오지 못했어요. 다시 시도해 주세요', retryable: true })
        return
      }
      setNow(t)
      setPhase({ kind: 'playing', quiz, startedAt: t })
    } catch (err) {
      handleError(err)
    } finally {
      busyRef.current = false
    }
  }

  const choose = async (choice: QuizChoice) => {
    if (phase.kind !== 'playing' || busyRef.current) return
    if (quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, Date.now()) === 0) return
    busyRef.current = true
    const quiz = phase.quiz
    const gen = currentPrivateGen()
    setPhase({ kind: 'submitting', quiz, choice })
    try {
      const result = await submitQuiz(quiz.id, choice)
      if (result.streak) setStreak(result.streak, gen)
      if (result.rewarded && gen === currentPrivateGen()) void refreshTrading() // 보상 → 헤더 자본금 반영
      if (aliveRef.current) setPhase({ kind: 'result', result, choice, quiz })
      else if (result.rewarded && gen === currentPrivateGen()) {
        // 제출 중 모달이 닫힌 경우 — 결과 화면이 없으므로 토스트로 보상 알림
        pushToast({ kind: 'nudge', icon: '🎁', message: `퀴즈 정답! +${formatKrw(result.reward_cash)} 지급됐어요` })
      }
    } catch (err) {
      handleError(err)
    } finally {
      busyRef.current = false
    }
  }

  const footer = (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <Button onClick={() => void start()}>다음 문제</Button>
      <Button variant="secondary" onClick={onClose}>
        닫기
      </Button>
    </div>
  )

  return (
    <Modal title="🧩 야간 10초 차트 퀴즈" onClose={onClose}>
      {phase.kind === 'intro' && (
        <div>
          <ul className="space-y-2 text-sm text-ink">
            <li>📊 날짜·종목을 가린 차트를 보고 며칠(3·5·10거래일) 뒤 주가 방향을 맞혀요.</li>
            <li>⏱ 제한 시간은 10초. 시간 안에 고르지 않으면 제출되지 않아요.</li>
            <li>🎁 정답이면 +₩200,000 (보상은 하루 3회까지).</li>
          </ul>
          <Button full className="mt-5" onClick={() => void start()}>
            시작
          </Button>
        </div>
      )}

      {phase.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">문제를 불러오는 중…</p>}

      {(phase.kind === 'playing' || phase.kind === 'submitting') && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold text-ink">{phase.quiz.horizon_bars}거래일 뒤 주가는?</p>
            {phase.kind === 'playing' ? (
              <span
                className={`text-lg font-bold tabular-nums ${secondsLeft <= 3 ? 'text-up' : 'text-ink'}`}
                aria-live="polite"
              >
                ⏱ {secondsLeft}초
              </span>
            ) : (
              <span className="text-sm text-ink-muted">채점 중…</span>
            )}
          </div>
          <QuizMiniChart candles={phase.quiz.chart_snapshot} />
          <p className="mt-1 text-xs text-ink-muted">
            <span style={{ color: QUIZ_MA_COLORS[5] }}>━ 5일선</span>{' '}
            <span style={{ color: QUIZ_MA_COLORS[20] }}>━ 20일선</span> · 아래 막대 = 거래량
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={phase.kind !== 'playing'}
              onClick={() => void choose('UP')}
              className="h-14 rounded-btn bg-up-soft text-base font-bold text-up transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              오를까? 📈
            </button>
            <button
              type="button"
              disabled={phase.kind !== 'playing'}
              onClick={() => void choose('DOWN')}
              className="h-14 rounded-btn bg-down-soft text-base font-bold text-down transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              내릴까? 📉
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'result' && phase.result === null && (
        <div>
          <p className="py-4 text-center text-2xl font-bold text-ink">⏰ 시간 초과</p>
          <p className="text-center text-sm text-ink-muted">선택하지 않아 제출되지 않았어요. 정답은 공개되지 않아요.</p>
          {footer}
        </div>
      )}

      {phase.kind === 'result' && phase.result !== null && (
        <div>
          <p className={`py-4 text-center text-2xl font-bold ${phase.result.correct ? 'text-up' : 'text-ink'}`}>
            {phase.result.correct ? '⭕ 정답이에요!' : phase.result.timed_out ? '⏰ 시간 초과' : '❌ 아쉽게 틀렸어요'}
          </p>
          <div className="space-y-1.5 text-sm text-ink">
            <p>
              정답 {choiceLabel(phase.result.answer)}
              {phase.choice !== null && <span className="text-ink-muted"> · 내 선택 {choiceLabel(phase.choice)}</span>}
            </p>
            <p>
              실제 {phase.quiz?.horizon_bars ?? 5}일 등락{' '}
              <span className={`font-semibold ${pnlClass(phase.result.actual_change)}`}>
                {formatPct(phase.result.actual_change)}
              </span>
            </p>
            <p>패턴 {phase.result.pattern_type}</p>
            {rewardLine(phase.result) !== null && (
              <p className={phase.result.rewarded ? 'font-semibold text-up' : 'text-ink-muted'}>{rewardLine(phase.result)}</p>
            )}
          </div>
          {phase.result.outcome !== null && (
            <p className="mt-3 rounded-field bg-canvas px-3 py-2 text-sm font-medium text-ink">{phase.result.outcome}</p>
          )}
          {phase.result.future_snapshot.length > 0 && phase.quiz !== null && (
            <div className="mt-3">
              <QuizMiniChart candles={phase.quiz.chart_snapshot} future={phase.result.future_snapshot} />
              <p className="mt-1 text-xs text-ink-muted">
                옅은 봉 = 이후 {phase.quiz.horizon_bars}거래일 · <span style={{ color: QUIZ_MA_COLORS[5] }}>━ 5일선</span>{' '}
                <span style={{ color: QUIZ_MA_COLORS[20] }}>━ 20일선</span>
              </p>
            </div>
          )}
          <QuizExplanation markdown={phase.result.explanation} />
          <p className="mt-2 text-xs text-ink-muted">
            종목 {phase.result.ticker} · 기준일 {phase.result.base_date}
          </p>
          {footer}
        </div>
      )}

      {phase.kind === 'exhausted' && (
        <div className="py-6 text-center">
          <p className="text-4xl" aria-hidden="true">🎉</p>
          <p className="mt-3 font-semibold text-ink">준비된 문제를 모두 풀었어요</p>
          <p className="mt-1 text-sm text-ink-muted">매일 밤 9시에 새 문제가 올라와요. 내일 다시 도전해 보세요!</p>
          <Button full className="mt-5" variant="secondary" onClick={onClose}>
            닫기
          </Button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="py-6 text-center">
          <p className="text-sm text-ink">{phase.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            {phase.retryable && <Button onClick={() => void start()}>다시 시도</Button>}
            <Button variant="secondary" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
