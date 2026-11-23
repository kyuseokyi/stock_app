import { useCallback, useEffect, useRef, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import AcademyModal from '../components/game/AcademyModal'
import NudgeToaster from '../components/game/NudgeToaster'
import EduChart from '../components/edu-game/EduChart'
import EduCrowdBar from '../components/edu-game/EduCrowdBar'
import EduDailyActionPanel from '../components/edu-game/EduDailyActionPanel'
import EduHistoryList from '../components/edu-game/EduHistoryList'
import EduLeaderboard from '../components/edu-game/EduLeaderboard'
import { getEduState, submitEduAction } from '../api/eduGame'
import { rememberEduEnabled } from '../hooks/useGameAccess'
import { useVisibleInterval } from '../hooks/useVisibleInterval'
import { eduErrorCode, eduErrorMessage, settlementLabel, settlementPassed, shouldReloadAfterError, sortedCandles } from '../lib/eduGame'
import { formatPct, formatPrice, formatWon, pnlClass } from '../lib/format'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'
import type { EduActionRequest, EduState } from '../types/eduGame'

// 교육용 합성 종가 게임 화면(/edu-game, /game 진입부 분기) — 명세 docs/edu_synthetic_daily_game_spec_and_plan.md 3·5절.
// 서버가 만든 가상 일봉이라 시세 라이선스와 무관. 비로그인도 차트·해설·순위는 보고, 결정 패널만 로그인 안내.
// 실시간 게임(GamePage 의 GameScreen)과 상태·스토어를 공유하지 않는다(아카데미 모달·토스트만 재사용).

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: EduState }

const NOW_TICK_MS = 30_000
const RELOAD_GAP_MS = 120_000 // 정산 시각이 지난 뒤 다시 묻는 최소 간격(정산이 늦어도 요청이 몰리지 않게)

export default function EduDailyGamePage() {
  const token = useAuthStore((s) => s.token)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [refreshKey, setRefreshKey] = useState(0)
  const [loginOpen, setLoginOpen] = useState(false)
  const [academyOpen, setAcademyOpen] = useState(false)
  const lastReloadRef = useRef(0)
  const seqRef = useRef(0)

  /** silent=true 면 화면을 비우지 않고 뒤에서 갱신(실패는 조용히) */
  const fetchState = useCallback(async (silent: boolean) => {
    const my = ++seqRef.current
    lastReloadRef.current = Date.now()
    if (!silent) setLoad({ kind: 'loading' })
    try {
      const data = await getEduState()
      if (my !== seqRef.current) return
      rememberEduEnabled(data.enabled, data.real_market_switch)
      setLoad({ kind: 'ok', data: { ...data, candles: sortedCandles(data.candles) } })
      setRefreshKey((k) => k + 1)
    } catch (e) {
      if (my !== seqRef.current) return
      if (!silent) setLoad({ kind: 'error', message: eduErrorMessage(e, '교육용 게임을 불러오지 못했어요.') })
    }
  }, [])

  // 처음·로그인/로그아웃(토큰 변경) 때 다시 받는다
  useEffect(() => {
    void fetchState(false)
  }, [fetchState, token])

  // 남은 시간 갱신 + 정산 시각이 지나면 새 봉을 받으러 간다
  useVisibleInterval(() => {
    const t = new Date()
    setNow(t)
    if (load.kind === 'ok' && settlementPassed(load.data.next_settlement_at, t) && Date.now() - lastReloadRef.current > RELOAD_GAP_MS) {
      void fetchState(true)
    }
  }, NOW_TICK_MS, true, { runOnVisible: true })

  const submit = async (req: EduActionRequest) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await submitEduAction(req)
      const bonus = res.bonus_cash_awarded > 0 ? ` (+${formatWon(res.bonus_cash_awarded)})` : ''
      const streak = res.streak ? ` · 🔥 연속 ${res.streak}일` : ''
      showToast(`${req.action === 'HOLD_WATCH' ? '👀 ' : '✅ '}${res.message}${bonus}${streak}`)
      await fetchState(true)
    } catch (e) {
      const code = eduErrorCode(e)
      const message = eduErrorMessage(e)
      setError(code === 'STALE_DAY' ? null : message) // 새 봉이 열렸으면 패널을 잠그지 않고 새 화면으로 갱신
      showToast(message)
      if (code === 'LEVERAGE_LOCKED') setAcademyOpen(true)
      if (shouldReloadAfterError(code)) await fetchState(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (load.kind === 'loading') return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>
  if (load.kind === 'error') {
    return (
      <EmptyState
        emoji="📘"
        title="교육용 종가 게임을 불러오지 못했어요"
        description={load.message}
        action={<Button onClick={() => void fetchState(false)}>다시 시도</Button>}
      />
    )
  }
  const s = load.data
  if (!s.enabled) {
    return <EmptyState emoji="📘" title="지금은 교육용 게임을 이용할 수 없어요" description="교육용 일일 종가 게임이 잠시 닫혀 있어요." />
  }
  if (!s.season || !s.today) {
    return <EmptyState emoji="📘" title="교육 시즌을 준비하고 있어요" description="잠시 후 다시 들어와 주세요." />
  }

  const settleAt = settlementLabel(s.next_settlement_at)
  const chip = !s.logged_in
    ? { text: '로그인하면 참가할 수 있어요', cls: 'bg-fill text-ink-muted' }
    : s.today_submitted
      ? { text: `오늘 참가 완료 ✅${settleAt ? ` (${settleAt} 정산)` : ''}`, cls: 'bg-brand-soft text-brand-strong' }
      : { text: '오늘 참가 가능 🟢', cls: 'bg-up-soft text-up' }
  const acc = s.account

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 헤더 — 배지·표시명·종가·등락·오늘 참가 상태 */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-sky-soft px-2 py-0.5 text-xs font-bold text-brand-strong">📘 교육용 종가 게임</span>
          <span className="text-xs text-ink-muted">시즌 {s.season.season_number} · Day {s.season.current_day_index}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-ink">{s.season.display_name}</h1>
            {!s.season.hide_name && s.season.theme_category && <p className="text-xs text-ink-muted">{s.season.theme_category}</p>}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-ink">{formatPrice(s.today.close)}원</p>
            <p className={`text-sm font-semibold ${pnlClass(s.today.change_pct)}`}>{formatPct(s.today.change_pct)}</p>
          </div>
        </div>
        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls}`}>{chip.text}</span>
        {acc && (
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center text-xs">
            <div>
              <dt className="text-ink-muted">총자산</dt>
              <dd className="mt-0.5 text-sm font-bold text-ink">{formatWon(acc.total_asset)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">수익률</dt>
              <dd className={`mt-0.5 text-sm font-bold ${pnlClass(acc.current_roi)}`}>{formatPct(acc.current_roi)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">참가 · 승/거래</dt>
              <dd className="mt-0.5 text-sm font-bold text-ink">{acc.participation_days}일 · {acc.win_trades}/{acc.total_trades}</dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4">
        <div className="space-y-3 sm:space-y-4">
          <EduChart candles={s.candles} today={s.today} position={acc?.position ?? null} />
          {s.disclaimer && <p className="text-xs text-ink-muted">ⓘ {s.disclaimer}</p>}
          {/* 오늘의 코치 해설 */}
          <Card className="bg-sky-soft">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-ink">🧑‍🏫 오늘의 차트 해설</h2>
              {s.today.pattern_tag && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-brand-strong">{s.today.pattern_tag}</span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-ink">{s.today.coach_comment ?? '오늘은 해설이 아직 없어요.'}</p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              {s.today.support_price !== null && <span>지지 {formatPrice(s.today.support_price)}</span>}
              {s.today.resistance_price !== null && <span>저항 {formatPrice(s.today.resistance_price)}</span>}
              {s.today.poc_price !== null && <span>POC {formatPrice(s.today.poc_price)}</span>}
            </p>
          </Card>
          {/* 참여자 비율 — 비로그인은 바로, 로그인 사용자는 제출 뒤(패널 안)에 공개(쏠림 방지) */}
          {!s.logged_in && (
            <Card>
              <h2 className="mb-2 text-base font-bold text-ink">👥 오늘 참가자들의 선택</h2>
              <EduCrowdBar crowd={s.crowd} />
            </Card>
          )}
        </div>
        <aside className="mt-3 space-y-3 sm:mt-4 sm:space-y-4 lg:sticky lg:top-[7.5rem] lg:mt-0">
          <EduDailyActionPanel
            state={s}
            submitting={submitting}
            error={error}
            now={now}
            onSubmit={(req) => void submit(req)}
            onLogin={() => setLoginOpen(true)}
            onOpenAcademy={() => (s.logged_in ? setAcademyOpen(true) : setLoginOpen(true))}
          />
        </aside>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <EduLeaderboard refreshKey={refreshKey} />
        {s.logged_in && <EduHistoryList refreshKey={refreshKey} />}
      </div>

      {academyOpen && (
        <AcademyModal
          onClose={() => {
            setAcademyOpen(false)
            void fetchState(true) // 퀴즈 통과로 5배가 열렸을 수 있다
          }}
        />
      )}
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
