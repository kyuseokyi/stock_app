import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { GAME_API_URL } from '../config'
import { listCoachMessages, listSeasons, upsertCoachMessage } from '../api/coach'
import { showToast } from '../lib/toast'
import type { CoachAction, CoachMessage, CoachType, SeasonOption } from '../types/game'

// KST 오늘(YYYY-MM-DD) — en-CA 로케일은 ISO 날짜 형식으로 포맷된다
const kstToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())

interface CoachForm {
  title: string
  summary_nudge: string
  support_price: string
  resistance_price: string
  content_md: string
}

const EMPTY_FORM: CoachForm = {
  title: '',
  summary_nudge: '',
  support_price: '',
  resistance_price: '',
  content_md: '',
}

const priceToInput = (v: string | null): string => (v === null ? '' : String(Number(v)))
const inputToPrice = (s: string): number | null => (s.trim() === '' ? null : Number(s))

const toForm = (m: CoachMessage): CoachForm => ({
  title: m.title,
  summary_nudge: m.summary_nudge,
  support_price: priceToInput(m.support_price),
  resistance_price: priceToInput(m.resistance_price),
  content_md: m.content_md,
})

const errorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return '입력값을 확인하세요.'
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return '게임 서버에 연결할 수 없습니다.'
}

const validate = (f: CoachForm): string | null => {
  if (!f.title.trim()) return '제목을 입력하세요.'
  if (!f.summary_nudge.trim()) return '한 줄 넛지를 입력하세요.'
  if (!f.content_md.trim()) return '상세 시황을 입력하세요.'
  const s = inputToPrice(f.support_price)
  const r = inputToPrice(f.resistance_price)
  if ((s !== null && !(s > 0)) || (r !== null && !(r > 0))) return '지지/저항선은 0보다 큰 숫자여야 합니다.'
  if (s !== null && r !== null && s >= r) return '지지선은 저항선보다 낮아야 합니다.'
  return null
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

function CoachEditor() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [coachType, setCoachType] = useState<CoachType>('MORNING')
  const [targetDate, setTargetDate] = useState<string>(kstToday)
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM)
  const [current, setCurrent] = useState<CoachMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  // 시즌 목록 — 기본은 ACTIVE 시즌
  useEffect(() => {
    listSeasons()
      .then((rows) => {
        setSeasons(rows)
        const active = rows.find((s) => s.status === 'ACTIVE') ?? rows[0]
        setSeasonId(active ? active.id : null)
      })
      .catch((e: unknown) => showToast(errorMessage(e), { icon: '⚠️' }))
  }, [])

  // 슬롯(시즌·날짜·모닝/이브닝) 변경 시 기존 내용 불러오기
  useEffect(() => {
    if (seasonId === null) return
    let cancelled = false
    setLoading(true)
    listCoachMessages(seasonId, targetDate)
      .then((rows) => {
        if (cancelled) return
        const found = rows.find((m) => m.coach_type === coachType) ?? null
        setCurrent(found)
        setForm(found ? toForm(found) : EMPTY_FORM)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setCurrent(null)
        setForm(EMPTY_FORM)
        showToast(errorMessage(e), { icon: '⚠️' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seasonId, targetDate, coachType])

  // 미리보기 — marked(동기 모드) → DOMPurify 로 XSS 제거
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(form.content_md, { async: false })),
    [form.content_md],
  )

  const isPublished = current?.status === 'PUBLISHED'
  const setField = (k: keyof CoachForm) => (value: string) => setForm((f) => ({ ...f, [k]: value }))

  const submit = async (action: CoachAction) => {
    const err = validate(form)
    if (err) {
      showToast(err, { icon: '⚠️' })
      return
    }
    if (seasonId === null) {
      showToast('시즌을 선택하세요.', { icon: '⚠️' })
      return
    }
    setSaving(true)
    try {
      const saved = await upsertCoachMessage({
        season_id: seasonId,
        target_date: targetDate,
        coach_type: coachType,
        title: form.title.trim(),
        summary_nudge: form.summary_nudge.trim(),
        content_md: form.content_md,
        support_price: inputToPrice(form.support_price),
        resistance_price: inputToPrice(form.resistance_price),
        action,
      })
      setCurrent(saved)
      setForm(toForm(saved))
      showToast(action === 'publish' ? '브리핑을 실시간 발행했습니다.' : '임시저장했습니다.', {
        icon: action === 'publish' ? '🚀' : '✅',
      })
    } catch (e) {
      showToast(errorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  const typeBtn = (t: CoachType, label: string) => (
    <button
      type="button"
      onClick={() => setCoachType(t)}
      aria-pressed={coachType === t}
      disabled={saving}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
        coachType === t ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-slate-900">데일리 코치</h2>
        {current && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isPublished
              ? `발행됨 · ${current.published_at ? new Date(current.published_at).toLocaleString('ko-KR') : ''}`
              : '임시저장(초안)'}
          </span>
        )}
      </div>

      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">시즌</label>
            <select
              value={seasonId ?? ''}
              onChange={(e) => setSeasonId(e.target.value === '' ? null : Number(e.target.value))}
              disabled={saving}
              className={`${inputCls} disabled:opacity-50`}
            >
              {seasons.length === 0 && <option value="">시즌 없음</option>}
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.season_number}기 · {s.stock_name}({s.ticker}) · {s.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">날짜</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              disabled={saving}
              className={`${inputCls} disabled:opacity-50`}
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">브리핑</span>
            <div className="flex gap-2" role="group" aria-label="브리핑 종류">
              {typeBtn('MORNING', '🌅 모닝 시황')}
              {typeBtn('EVENING', '🌙 이브닝 복기')}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">제목</label>
              <input
                value={form.title}
                maxLength={100}
                onChange={(e) => setField('title')(e.target.value)}
                placeholder="예: 반도체 강세 속 외국인 순매수 전환"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1 flex justify-between text-sm font-medium text-slate-600">
                <span>한 줄 넛지 (차트 상단 롤링 멘트)</span>
                <span className="text-xs font-normal text-slate-400">{form.summary_nudge.length}/200</span>
              </label>
              <input
                value={form.summary_nudge}
                maxLength={200}
                onChange={(e) => setField('summary_nudge')(e.target.value)}
                placeholder="예: 72,000원 지지 확인 전까지 추격 매수 자제"
                className={inputCls}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">지지선 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={form.support_price}
                  onChange={(e) => setField('support_price')(e.target.value)}
                  placeholder="비우면 표시 안 함"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">저항선 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={form.resistance_price}
                  onChange={(e) => setField('resistance_price')(e.target.value)}
                  placeholder="비우면 표시 안 함"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">상세 시황 (마크다운)</span>
                <div className="flex gap-1 lg:hidden" role="tablist">
                  {(['write', 'preview'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        tab === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {t === 'write' ? '작성' : '미리보기'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <textarea
                  value={form.content_md}
                  onChange={(e) => setField('content_md')(e.target.value)}
                  placeholder={'## 오늘의 시황\n- 외국인 순매수 전환\n- 72,000원 지지 여부 주목'}
                  className={`${inputCls} min-h-[320px] font-mono ${tab === 'write' ? '' : 'hidden'} lg:block`}
                />
                <div
                  className={`prose max-w-none min-h-[320px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm ${
                    tab === 'preview' ? '' : 'hidden'
                  } lg:block`}
                  // DOMPurify 로 정화된 HTML 만 주입
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {isPublished && (
                <p className="mr-auto text-xs text-slate-400">발행된 브리핑은 다시 발행해서 수정합니다.</p>
              )}
              <button
                type="button"
                onClick={() => submit('draft')}
                disabled={saving || isPublished}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                임시저장
              </button>
              <button
                type="button"
                onClick={() => submit('publish')}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? '처리 중…' : '🚀 실시간 발행하기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function TradingGameCoach() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">데일리 코치</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">
            VITE_GAME_API_URL 을 설정해 빌드하면 데일리 코치를 사용할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }
  return <CoachEditor />
}
