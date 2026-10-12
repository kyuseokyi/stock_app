import { useEffect, useState } from 'react'
import type { AxiosError } from 'axios'
import { GAME_API_URL } from '../config'
import { listFeatureFlags, updateFeatureFlag } from '../api/featureFlags'
import { showToast } from '../lib/toast'
import type { FeatureFlag, FeatureFlagKey } from '../types/game'

const FLAG_META: Record<FeatureFlagKey, { title: string; description: string }> = {
  QUIZ: {
    title: '🌙 야간 차트 퀴즈',
    description: '끄면 유저 퀴즈 API가 "현재 운영하지 않음"을 응답합니다. 서버 재시작 없이 바로 반영됩니다.',
  },
  STREAK: {
    title: '🔥 연속 출석(Streak)',
    description: '끄면 매매·퀴즈를 해도 연속 출석 일수가 갱신되지 않습니다. 기존 기록은 보존됩니다.',
  },
}

const errorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return '게임 서버에 연결할 수 없습니다.'
}

const formatTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '변경 이력 없음'

function SettingsPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<FeatureFlagKey | null>(null)

  useEffect(() => {
    listFeatureFlags()
      .then(setFlags)
      .catch((e: unknown) => showToast(errorMessage(e), { icon: '⚠️' }))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async (flag: FeatureFlag) => {
    const next = !flag.enabled
    setPending(flag.key)
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: next } : f)))
    try {
      const saved = await updateFeatureFlag(flag.key, next)
      setFlags((prev) => prev.map((f) => (f.key === saved.key ? saved : f)))
      showToast(`${FLAG_META[flag.key].title} ${next ? '켜짐' : '꺼짐'}`, { icon: next ? '✅' : '⏸️' })
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? flag : f))) // 원상복구
      showToast(errorMessage(e), { icon: '⚠️' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">기능 설정</h2>
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <ul className="space-y-3">
          {flags.map((flag) => (
            <li
              key={flag.key}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <div>
                <p className="font-medium text-slate-900">{FLAG_META[flag.key].title}</p>
                <p className="mt-1 text-sm text-slate-500">{FLAG_META[flag.key].description}</p>
                <p className="mt-1 text-xs text-slate-400">마지막 변경: {formatTime(flag.updated_at)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                aria-label={FLAG_META[flag.key].title}
                disabled={pending !== null}
                onClick={() => toggle(flag)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                  flag.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                    flag.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TradingGameSettings() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">기능 설정</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">
            VITE_GAME_API_URL 을 설정해 빌드하면 기능 설정을 사용할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }
  return <SettingsPanel />
}
