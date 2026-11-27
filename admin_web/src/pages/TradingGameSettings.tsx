import { useCallback, useEffect, useState } from 'react'
import { hasPermission } from '../lib/permissions'
import { useMeStore } from '../store/me'
import type { AxiosError } from 'axios'
import { GAME_API_URL } from '../config'
import { listFeatureFlags, updateFeatureFlag } from '../api/featureFlags'
import { showToast } from '../lib/toast'
import GameSeasonRewardSettings from '../components/GameSeasonRewardSettings'
import EduGameOperations from '../components/EduGameOperations'
import type { FeatureFlag, FeatureFlagKey } from '../types/game'
import { confirmAction } from '@/lib/confirm'

const FLAG_META: Record<FeatureFlagKey, { title: string; description: string }> = {
  QUIZ: {
    title: '🌙 야간 차트 퀴즈',
    description:
      '끄면 웹·앱 게임 화면에서 퀴즈 버튼과 야간 배너가 사라지고, 퀴즈 API도 "현재 운영하지 않음"을 응답합니다. 서버 재시작 없이 최대 30초 안에 반영됩니다(화면을 열어 둔 유저는 다시 들어올 때).',
  },
  STREAK: {
    title: '🔥 연속 출석(Streak)',
    description: '끄면 매매·퀴즈를 해도 연속 출석 일수가 갱신되지 않습니다. 기존 기록은 보존됩니다.',
  },
  REAL_MARKET: {
    title: '⚡ 실시간 게임 (ON: 사용자에게 실시간 게임만 표시 · OFF: 가상 데이터 게임 표시)',
    description:
      '게임 탭에 무엇을 보일지 정하는 스위치입니다. 켜면(실제 시세 공개 — KRX/코스콤 시세 라이선스 필요) 모든 사용자에게 실시간 게임만 보이고 가상 데이터 게임은 보이지 않습니다. 끄면(기본) 가상 데이터(교육용 종가) 게임만 보이며, 일반 사용자는 실시간 게임의 시세 스트림·분봉·장운영 상태·주문·퀴즈가 막힙니다(관리자·시세 열람 권한 회원은 API 이용은 가능하지만 화면에는 가상 데이터 게임이 보입니다). 정산·랭킹 등 서버 내부 작업은 영향이 없습니다.',
  },
  EDU_DAILY_GAME: {
    title: '📘 가상 데이터(교육용 종가) 게임 — 실시간 게임이 OFF 일 때 표시',
    description:
      '서버가 만든 가상 일봉으로 하루 1회 결정하는 교육용 게임입니다(시세 라이선스 불필요, 기본 켜짐). 위 실시간 게임 스위치가 OFF 일 때만 사용자에게 보입니다. 둘 다 끄면 게임 탭이 사라지고 참가·랭킹 API가 막힙니다. 아래 운영 카드(진행·국면·새 시즌)는 스위치와 무관하게 동작합니다.',
  },
}

const errorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return '게임 서버에 연결할 수 없습니다.'
}

/** 지금 사용자에게 보이는 게임 — 웹·앱 규칙과 같다: REAL_MARKET ON → 실시간, OFF 이고 EDU_DAILY_GAME ON → 가상 데이터, 둘 다 OFF → 없음.
 *  행이 없으면 서버 기본값(REAL_MARKET 꺼짐, EDU_DAILY_GAME 켜짐)으로 본다 */
function visibleGameLabel(flags: FeatureFlag[]): string {
  const on = (key: FeatureFlagKey, fallback: boolean) => flags.find((f) => f.key === key)?.enabled ?? fallback
  if (on('REAL_MARKET', false)) return '⚡ 실시간 게임'
  if (on('EDU_DAILY_GAME', true)) return '📘 가상 데이터 게임'
  return '없음 (게임 탭 숨김)'
}

const formatTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '변경 이력 없음'

function SettingsPanel() {
  // 실시간 게임 스위치 = 실시간 시세 공개 — 시세·스크리너 노출 스위치 권한이 있어야 바꿀 수 있다(서버도 403)
  const canSwitchRealMarket = hasPermission(useMeStore((s) => s.user), 'SCREENER_SETTINGS')
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<FeatureFlagKey | null>(null)

  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    listFeatureFlags()
      .then((rows) => setFlags(rows.filter((f): f is FeatureFlag => f.key in FLAG_META)))
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(errorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (flag: FeatureFlag) => {
    const next = !flag.enabled
    if (flag.key === 'REAL_MARKET' && next && !await confirmAction('실제 시세 게임을 모든 사용자에게 공개할까요?\nKRX/코스콤 시세 라이선스가 있어야 켤 수 있어요.')) return
    if (flag.key === 'EDU_DAILY_GAME' && !next && !await confirmAction('가상 데이터(교육용 종가) 게임을 닫을까요?\n실시간 게임 스위치도 꺼져 있으면 사용자에게 게임 탭이 사라집니다.')) return
    setPending(flag.key)
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: next } : f)))
    try {
      const saved = await updateFeatureFlag(flag.key, next)
      setFlags((prev) => prev.map((f) => (f.key === saved.key ? saved : f)))
      showToast(`${FLAG_META[flag.key].title} ${next ? '켜짐' : '꺼짐'}`, { icon: next ? '✅' : '⏸️' })
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: flag.enabled } : f))) // enabled 만 원상복구
      showToast(errorMessage(e), { icon: '⚠️' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">게임 설정</h2>
      <h3 className="mb-4 text-lg font-bold text-slate-900">기능 on/off</h3>
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : loadFailed ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center">
          <p className="text-sm text-slate-600">기능 설정을 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <>
        <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-3 text-sm text-slate-700">
          지금 사용자에게 보이는 게임: <strong className="text-slate-900">{visibleGameLabel(flags)}</strong>
        </p>
        <ul className="space-y-3">
          {flags.map((flag) => (
            <li
              key={flag.key}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <div>
                <p id={`flag-title-${flag.key}`} className="font-medium text-slate-900">{FLAG_META[flag.key].title}</p>
                <p className="mt-1 text-sm text-slate-500">{FLAG_META[flag.key].description}</p>
                <p className="mt-1 text-xs text-slate-400">마지막 변경: {formatTime(flag.updated_at)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                aria-labelledby={`flag-title-${flag.key}`}
                disabled={pending !== null || (flag.key === 'REAL_MARKET' && !canSwitchRealMarket)}
                title={flag.key === 'REAL_MARKET' && !canSwitchRealMarket ? '시세·스크리너 노출 스위치 권한이 없어요' : undefined}
                onClick={() => toggle(flag)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  flag.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                    flag.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
      <GameSeasonRewardSettings />
      <EduGameOperations />
    </div>
  )
}

export default function TradingGameSettings() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">게임 설정</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">
            VITE_GAME_API_URL 을 설정해 빌드하면 게임 설정을 사용할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }
  return <SettingsPanel />
}
