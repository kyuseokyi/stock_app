import { useCallback, useEffect, useMemo, useState } from 'react'
import { listSeasons } from '../api/coach'
import { getGameSettings, updateGameSettings } from '../api/gameSettings'
import { gameErrorMessage } from '../lib/gameApiError'
import { showToast } from '../lib/toast'
import type { GameSettings, SeasonOption, SeasonPeriod, StreakRewardKey } from '../types/game'

// 시즌 기간·보상 금액 설정 섹션 (spec 2026-10-14 §5). 바뀐 최상위 키만 PUT 한다.

const MAX_AMOUNT = 100_000_000
const STREAK_KEYS: StreakRewardKey[] = ['3', '7', '14', '30']
const RANKS = [0, 1, 2] as const
const PERIOD_LABEL: Record<SeasonPeriod, string> = { month: '월간', quarter: '분기' }

interface FormState {
  next_season_period: SeasonPeriod
  weekly_rewards: string[]
  monthly_rewards: string[]
  streak_rewards: Record<StreakRewardKey, string>
}

const toForm = (s: GameSettings): FormState => ({
  next_season_period: s.next_season_period,
  weekly_rewards: s.weekly_rewards.map(String),
  monthly_rewards: s.monthly_rewards.map(String),
  streak_rewards: Object.fromEntries(STREAK_KEYS.map((k) => [k, String(s.streak_rewards[k] ?? 0)])) as Record<
    StreakRewardKey,
    string
  >,
})

/** 정수 0~1억이면 숫자, 아니면 null */
const parseAmount = (raw: string): number | null => {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n <= MAX_AMOUNT ? n : null
}

const withComma = (raw: string): string => (raw === '' ? '' : Number(raw).toLocaleString('ko-KR'))

const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }) // YYYY-MM-DD
const formatKst = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/** KST 날짜 기준 남은 일수 → "D-3" / "D-Day" / "종료 +2일" */
const dDay = (endIso: string): string => {
  const toUtcDay = (d: Date) => {
    const [y, m, day] = KST_DATE.format(d).split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  const diff = Math.round((toUtcDay(new Date(endIso)) - toUtcDay(new Date())) / 86_400_000)
  if (diff > 0) return `D-${diff}`
  if (diff === 0) return 'D-Day'
  return `종료 +${-diff}일`
}

function AmountInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (raw: string) => void
  disabled: boolean
}) {
  const invalid = parseAmount(value) === null
  return (
    <div>
      <div
        className={`flex items-center rounded-lg border bg-white px-3 py-2 focus-within:ring-2 ${
          invalid ? 'border-rose-400 focus-within:ring-rose-200' : 'border-slate-300 focus-within:ring-indigo-200'
        }`}
      >
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          value={withComma(value)}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 10))}
          className="w-full min-w-0 bg-transparent text-right text-sm text-slate-900 outline-none disabled:opacity-50"
        />
        <span className="ml-1 shrink-0 text-sm text-slate-500">원</span>
      </div>
      {invalid && <p className="mt-1 text-xs text-rose-500">0 ~ 100,000,000 사이 정수</p>}
    </div>
  )
}

export default function GameSeasonRewardSettings() {
  const [saved, setSaved] = useState<GameSettings | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [season, setSeason] = useState<SeasonOption | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    // 시즌 목록 실패는 설정 편집을 막지 않는다
    listSeasons()
      .then((rows) => setSeason(rows.find((s) => s.status === 'ACTIVE') ?? null))
      .catch(() => setSeason(null))
    getGameSettings()
      .then((s) => {
        setSaved(s)
        setForm(toForm(s))
      })
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(gameErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const allValid = useMemo(() => {
    if (!form) return false
    return [...form.weekly_rewards, ...form.monthly_rewards, ...Object.values(form.streak_rewards)].every(
      (v) => parseAmount(v) !== null,
    )
  }, [form])

  // 원본과 다른 최상위 키만 모은 PUT 본문(리스트·딕셔너리는 통째로 보냄)
  const patch = useMemo((): Partial<GameSettings> => {
    if (!form || !saved || !allValid) return {}
    const out: Partial<GameSettings> = {}
    if (form.next_season_period !== saved.next_season_period) out.next_season_period = form.next_season_period
    const weekly = form.weekly_rewards.map(Number) as GameSettings['weekly_rewards']
    if (weekly.some((v, i) => v !== saved.weekly_rewards[i])) out.weekly_rewards = weekly
    const monthly = form.monthly_rewards.map(Number) as GameSettings['monthly_rewards']
    if (monthly.some((v, i) => v !== saved.monthly_rewards[i])) out.monthly_rewards = monthly
    const streak = Object.fromEntries(STREAK_KEYS.map((k) => [k, Number(form.streak_rewards[k])])) as GameSettings['streak_rewards']
    if (STREAK_KEYS.some((k) => streak[k] !== saved.streak_rewards[k])) out.streak_rewards = streak
    return out
  }, [form, saved, allValid])

  const dirty = Object.keys(patch).length > 0

  const save = async () => {
    if (!allValid) {
      showToast('보상 금액은 0 ~ 100,000,000 사이 정수로 입력하세요.', { icon: '⚠️' })
      return
    }
    if (!dirty) return
    setSaving(true)
    try {
      const next = await updateGameSettings(patch)
      setSaved(next)
      setForm(toForm(next))
      showToast('게임 설정을 저장했습니다.', { icon: '✅' })
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  const setList = (key: 'weekly_rewards' | 'monthly_rewards', idx: number, raw: string) =>
    setForm((f) => (f ? { ...f, [key]: f[key].map((v, i) => (i === idx ? raw : v)) } : f))

  const setStreak = (key: StreakRewardKey, raw: string) =>
    setForm((f) => (f ? { ...f, streak_rewards: { ...f.streak_rewards, [key]: raw } } : f))

  return (
    <section className="mt-10">
      <h3 className="mb-4 text-lg font-bold text-slate-900">시즌 기간 · 보상 금액</h3>

      {/* 현재 시즌 */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <p className="text-xs font-medium text-slate-500">현재 시즌</p>
        {season ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-slate-900">시즌 {season.season_number}</span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {PERIOD_LABEL[season.period ?? 'month'] ?? season.period}
            </span>
            <span className="text-sm text-slate-600">
              {formatKst(season.start_at)} ~ {season.end_at ? formatKst(season.end_at) : '종료일 미정'}
            </span>
            {season.end_at && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {dDay(season.end_at)}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-400">진행 중인 시즌이 없습니다.</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : loadFailed || !form ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center">
          <p className="text-sm text-slate-600">게임 설정을 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 다음 시즌 기간 */}
          <fieldset className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <legend className="sr-only">다음 시즌 기간</legend>
            <p className="font-medium text-slate-900">다음 시즌 기간</p>
            <div className="mt-2 flex gap-6">
              {(['month', 'quarter'] as SeasonPeriod[]).map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="next_season_period"
                    value={p}
                    checked={form.next_season_period === p}
                    disabled={saving}
                    onChange={() => setForm((f) => (f ? { ...f, next_season_period: p } : f))}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  {PERIOD_LABEL[p]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              분기 중간에 시작하면 그 분기 말(3·6·9·12월 말일)까지 진행돼요
            </p>
          </fieldset>

          {/* 보상 금액 */}
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <p className="font-medium text-slate-900">보상 금액</p>
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">주간 랭킹</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {RANKS.map((i) => (
                    <label key={i} className="block">
                      <span className="mb-1 block text-xs text-slate-500">{i + 1}위</span>
                      <AmountInput
                        label={`주간 ${i + 1}위 보상`}
                        value={form.weekly_rewards[i]}
                        onChange={(raw) => setList('weekly_rewards', i, raw)}
                        disabled={saving}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">
                  월간 랭킹 <span className="text-xs font-normal text-slate-400">· 분기 시즌에서만 사용</span>
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {RANKS.map((i) => (
                    <label key={i} className="block">
                      <span className="mb-1 block text-xs text-slate-500">{i + 1}위</span>
                      <AmountInput
                        label={`월간 ${i + 1}위 보상`}
                        value={form.monthly_rewards[i]}
                        onChange={(raw) => setList('monthly_rewards', i, raw)}
                        disabled={saving}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">연속 출석</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {STREAK_KEYS.map((k) => (
                    <label key={k} className="block">
                      <span className="mb-1 block text-xs text-slate-500">{k}일</span>
                      <AmountInput
                        label={`연속 출석 ${k}일 보상`}
                        value={form.streak_rewards[k]}
                        onChange={(raw) => setStreak(k, raw)}
                        disabled={saving}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              바뀐 금액은 다음 마감·다음 수령부터 적용돼요. 진행 중 시즌 기간은 바뀌지 않아요.
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || !allValid}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
