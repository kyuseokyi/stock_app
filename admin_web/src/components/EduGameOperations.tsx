import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { advanceEduDay, createEduSeason, getEduSeason, setEduRegime } from '../api/eduGameAdmin'
import { gameErrorMessage } from '../lib/gameApiError'
import { showToast } from '../lib/toast'
import type { EduAdminSeason, EduAdvanceResult, EduRegime } from '../types/game'

// [교육용 종가 게임 운영] 카드 — 명세 docs/edu_synthetic_daily_game_spec_and_plan.md Step 4.
// 현재 시즌(Day N·국면·남은 봉·지정 국면·참가자 수) + 다음 봉 즉시 진행 + 다음 국면 지정 + 새 시즌 생성.

const REGIMES: { value: EduRegime; label: string }[] = [
  { value: 'ACCUMULATION', label: '매집 횡보' },
  { value: 'UPTREND', label: '상승 추세' },
  { value: 'DISTRIBUTION', label: '고점 분산' },
  { value: 'DOWNTREND', label: '하락 조정' },
]
const regimeLabel = (r: string | null): string => (r ? (REGIMES.find((x) => x.value === r)?.label ?? r) : '자동')

const advanceMessage = (r: EduAdvanceResult): { text: string; icon: string } => {
  if (r.status === 'advanced') {
    const close = r.close === null ? '' : ` · 종가 ${r.close.toLocaleString('ko-KR')}원`
    return { text: `Day ${r.day_index ?? '?'} 생성${close} · 정산 ${r.settled}건(청산 ${r.closed}건)`, icon: '✅' }
  }
  if (r.status === 'skipped') return { text: '이미 진행 중이거나 오늘 정산이 끝나 건너뛰었습니다.', icon: 'ℹ️' }
  if (r.status === 'no_season') return { text: '진행 중인 교육 시즌이 없습니다.', icon: '⚠️' }
  return { text: `결과: ${r.status}`, icon: 'ℹ️' }
}

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200'
const btnPrimary = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50'
const btnSecondary = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

export default function EduGameOperations() {
  const [season, setSeason] = useState<EduAdminSeason | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<'advance' | 'regime' | 'season' | null>(null)
  const [regime, setRegime] = useState<EduRegime | ''>('')
  const [title, setTitle] = useState('[교육 지수] AI·반도체 모멘텀 가상그룹')
  const [theme, setTheme] = useState('IT/반도체')
  const [hideName, setHideName] = useState(false)
  const [startPrice, setStartPrice] = useState<50000 | 100000>(50000)

  const apply = (s: EduAdminSeason | null) => {
    setSeason(s)
    setRegime((s?.next_regime_override as EduRegime | null) ?? '')
  }

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    getEduSeason()
      .then(apply)
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(gameErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const advance = async () => {
    if (!confirm('다음 종가 캔들 1개를 지금 만들고 모든 참가자의 포지션을 정산할까요?\n전 유저 계좌에 바로 반영되며 되돌릴 수 없습니다.')) return
    setBusy('advance')
    try {
      const r = await advanceEduDay()
      const m = advanceMessage(r)
      showToast(m.text, { icon: m.icon })
      load()
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(null)
    }
  }

  const saveRegime = async () => {
    setBusy('regime')
    try {
      apply(await setEduRegime(regime === '' ? null : regime))
      showToast(regime === '' ? '국면 지정을 해제했습니다(자동 전이).' : `다음 봉부터 '${regimeLabel(regime)}' 국면을 적용합니다.`, { icon: '✅' })
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(null)
    }
  }

  const newSeason = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !theme.trim()) {
      showToast('테마명과 분류를 입력하세요.', { icon: '⚠️' })
      return
    }
    const closing = season ? `\n현재 시즌 ${season.season_number}기는 종료(CLOSED)되고 참가자 계좌도 새 시즌으로 바뀝니다.` : ''
    if (!confirm(`새 교육 시즌을 만들까요?${closing}`)) return
    setBusy('season')
    try {
      apply(await createEduSeason({ title: title.trim(), theme_category: theme.trim(), hide_name: hideName, start_price: startPrice }))
      showToast('새 교육 시즌을 만들었습니다(워밍업 120봉 생성).', { icon: '✅' })
    } catch (err) {
      showToast(gameErrorMessage(err), { icon: '⚠️' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-10">
      <h3 className="mb-4 text-lg font-bold text-slate-900">📘 교육용 종가 게임 운영</h3>
      <div className="space-y-4">
        {/* 현재 시즌 */}
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-slate-500">현재 교육 시즌</p>
          {loading ? (
            <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
          ) : loadFailed ? (
            <div className="mt-2 flex items-center gap-3">
              <p className="text-sm text-slate-600">교육 시즌을 불러오지 못했습니다.</p>
              <button type="button" onClick={load} className={btnSecondary}>다시 시도</button>
            </div>
          ) : season === null ? (
            <p className="mt-2 text-sm text-slate-600">
              진행 중인 시즌이 없습니다. 사용자가 게임 화면을 열거나 아래에서 진행·생성하면 자동으로 만들어집니다.
            </p>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-900">시즌 {season.season_number}기</span>
                <span className="text-sm text-slate-700">{season.title}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{season.theme_category}</span>
                {season.hide_name && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">블라인드(이름 숨김)</span>
                )}
                <span className="text-xs text-slate-400">{season.synthetic_code} · {season.status}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="현재 캔들" value={`Day ${season.current_day_index}`} />
                <Stat label="현재 국면" value={regimeLabel(season.current_regime)} />
                <Stat label="국면 남은 봉" value={`${season.regime_days_left}봉`} />
                <Stat label="지정 국면(다음 봉)" value={regimeLabel(season.next_regime_override)} />
                <Stat label="참가자" value={`${season.participants.toLocaleString('ko-KR')}명`} />
                <Stat label="마지막 정산일" value={season.last_advanced_date ?? '없음'} />
              </dl>
            </>
          )}
        </div>

        {/* 진행·국면 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <p className="font-medium text-slate-900">다음 종가 캔들 즉시 생성 & 정산</p>
            <p className="mt-1 text-sm text-slate-500">
              평일 20:00 자동 정산과 같은 작업을 지금 1회 실행합니다(테스트·운영용). 모든 참가자의 손절·익절·평가손익이 바로 바뀝니다.
            </p>
            <button type="button" onClick={advance} disabled={busy !== null} className={`${btnPrimary} mt-3`}>
              {busy === 'advance' ? '진행 중…' : '+1일 진행'}
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <label htmlFor="edu-regime" className="font-medium text-slate-900">다음 국면 지정</label>
            <p className="mt-1 text-sm text-slate-500">다음 봉부터 적용할 시장 국면입니다. 한 번 적용되면 자동으로 해제됩니다.</p>
            <div className="mt-3 flex gap-2">
              <select
                id="edu-regime"
                value={regime}
                onChange={(e) => setRegime(e.target.value as EduRegime | '')}
                disabled={busy !== null}
                className={input}
              >
                <option value="">자동(지정 해제)</option>
                {REGIMES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <button type="button" onClick={saveRegime} disabled={busy !== null} className={`${btnSecondary} shrink-0`}>
                {busy === 'regime' ? '저장 중…' : '적용'}
              </button>
            </div>
          </div>
        </div>

        {/* 새 시즌 */}
        <form onSubmit={newSeason} className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <p className="font-medium text-slate-900">새 시즌 생성</p>
          <p className="mt-1 text-sm text-slate-500">현재 시즌을 종료하고 가상 테마로 새 시즌(워밍업 120봉)을 만듭니다.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-slate-600">가상 테마명</span>
              <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">분류</span>
              <input value={theme} maxLength={50} onChange={(e) => setTheme(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">시작 가격</span>
              <select
                value={startPrice}
                onChange={(e) => setStartPrice(Number(e.target.value) === 100000 ? 100000 : 50000)}
                className={`${input} mt-1`}
              >
                <option value={50000}>50,000원</option>
                <option value={100000}>100,000원</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={hideName} onChange={(e) => setHideName(e.target.checked)} className="h-4 w-4" />
              종목명 숨김(블라인드 차트)
            </label>
          </div>
          <button type="submit" disabled={busy !== null} className={`${btnPrimary} mt-3`}>
            {busy === 'season' ? '생성 중…' : '새 시즌 생성'}
          </button>
        </form>
      </div>
    </section>
  )
}
