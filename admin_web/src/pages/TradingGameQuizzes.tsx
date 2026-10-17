import { useCallback, useEffect, useState } from 'react'
import { GAME_API_URL } from '../config'
import { createQuiz, deleteQuiz, generateQuizzes, getQuiz, listQuizzes, updateQuiz } from '../api/quizAdmin'
import { getChartData, searchStocks } from '../api/stockClient'
import QuizChartPreview from '../components/QuizChartPreview'
import { gameErrorCode, gameErrorMessage } from '../lib/gameApiError'
import { showToast } from '../lib/toast'
import type { QuizAdminDetail, QuizAdminList } from '../types/game'
import type { Candle, Stock } from '../types/stock'

const PAGE_SIZE = 20
const DEFAULT_HORIZON = 5

type ActiveFilter = 'all' | 'active' | 'inactive'

const FILTER_PARAM: Record<ActiveFilter, boolean | undefined> = {
  all: undefined,
  active: true,
  inactive: false,
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

/** YYYY-MM-DD + n일 (UTC 기준 날짜 산술) */
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const formatChange = (v: string): string => {
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

const ANSWER_LABEL = { UP: '상승', DOWN: '하락' } as const

// ------------------------------------------------------------------ 상세(차트·편집·활성·삭제)
function QuizDetailPanel({
  quizId,
  onChanged,
  onDeleted,
}: {
  quizId: number
  onChanged: () => void
  onDeleted: () => void
}) {
  const [quiz, setQuiz] = useState<QuizAdminDetail | null>(null)
  const [future, setFuture] = useState<Candle[]>([])
  const [futureFailed, setFutureFailed] = useState(false)
  const [patternType, setPatternType] = useState('')
  const [explanation, setExplanation] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setQuiz(null)
    setFuture([])
    setFutureFailed(false)
    getQuiz(quizId)
      .then((q) => {
        if (cancelled) return
        setQuiz(q)
        setPatternType(q.pattern_type)
        setExplanation(q.explanation)
        // 이후 봉은 저장된 future_snapshot 우선. B2 이전 생성분은 stock_api 일봉으로 보충(실패 시 문제 구간만)
        if (q.future_snapshot && q.future_snapshot.length > 0) {
          setFuture(q.future_snapshot)
          return
        }
        const horizon = q.horizon_bars ?? DEFAULT_HORIZON
        getChartData(q.ticker, addDays(q.base_date, 1), addDays(q.base_date, horizon * 2 + 10))
          .then((chart) => {
            if (!cancelled) setFuture(chart.candles.filter((c) => c.date > q.base_date).slice(0, horizon))
          })
          .catch(() => {
            if (!cancelled) setFutureFailed(true)
          })
      })
      .catch((e: unknown) => {
        if (!cancelled) showToast(gameErrorMessage(e), { icon: '⚠️' })
      })
    return () => {
      cancelled = true
    }
  }, [quizId])

  if (!quiz) return <p className="text-sm text-slate-400">상세 불러오는 중…</p>

  const save = async () => {
    const p = patternType.trim()
    const e = explanation.trim()
    if (p.length < 1 || p.length > 50) return showToast('패턴은 1~50자로 입력하세요.', { icon: '⚠️' })
    if (e.length < 1 || e.length > 1000) return showToast('해설은 1~1000자로 입력하세요.', { icon: '⚠️' })
    setBusy(true)
    try {
      setQuiz(await updateQuiz(quiz.id, { pattern_type: p, explanation: e }))
      showToast('퀴즈를 저장했습니다.', { icon: '✅' })
      onChanged()
    } catch (err) {
      showToast(gameErrorMessage(err), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async () => {
    setBusy(true)
    try {
      setQuiz(await updateQuiz(quiz.id, { is_active: !quiz.is_active }))
      onChanged()
    } catch (err) {
      showToast(gameErrorMessage(err), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (quiz.attempt_count > 0) {
      showToast('시도 기록이 있는 퀴즈는 삭제할 수 없습니다. 비활성으로 전환하세요.', { icon: '⚠️' })
      return
    }
    if (!window.confirm(`퀴즈 #${quiz.id} 을(를) 삭제할까요?`)) return
    setBusy(true)
    try {
      await deleteQuiz(quiz.id)
      showToast('퀴즈를 삭제했습니다.', { icon: '🗑️' })
      onDeleted()
    } catch (err) {
      const msg =
        gameErrorCode(err) === 'HAS_ATTEMPTS'
          ? '그 사이 시도 기록이 생겨 삭제할 수 없습니다. 비활성으로 전환하세요.'
          : gameErrorMessage(err)
      showToast(msg, { icon: '⚠️' })
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">
            퀴즈 #{quiz.id} · {quiz.ticker} · 기준일 {quiz.base_date}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            정답 <strong className={quiz.answer === 'UP' ? 'text-red-600' : 'text-blue-600'}>{ANSWER_LABEL[quiz.answer]}</strong>{' '}
            ({formatChange(quiz.actual_change)}) · 차트 {quiz.window_bars ?? 60}봉 · 예측 {quiz.horizon_bars ?? DEFAULT_HORIZON}일 · 시도 {quiz.attempt_count}회 · 보상 {quiz.reward_cash.toLocaleString()}원
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={quiz.is_active}
            aria-label="출제 활성"
            disabled={busy}
            onClick={toggleActive}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition disabled:opacity-50 ${
              quiz.is_active ? 'bg-indigo-600' : 'bg-slate-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                quiz.is_active ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-slate-600">{quiz.is_active ? '출제 중' : '비활성'}</span>
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            title={quiz.attempt_count > 0 ? '시도 기록이 있어 삭제 불가 — 비활성으로 전환하세요' : undefined}
            className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            삭제
          </button>
        </div>
      </div>

      <QuizChartPreview
        snapshot={quiz.chart_snapshot}
        future={future}
        baseDate={quiz.base_date}
        horizon={quiz.horizon_bars ?? DEFAULT_HORIZON}
      />
      {futureFailed && (
        <p className="text-xs text-slate-400">이후 {quiz.horizon_bars ?? DEFAULT_HORIZON}거래일 일봉을 불러오지 못해 문제 구간만 표시합니다(stock_api 확인).</p>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">패턴</span>
        <input className={inputCls} maxLength={50} value={patternType} onChange={(e) => setPatternType(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">해설(마크다운, 제출 후 표시)</span>
        <textarea
          className={`${inputCls} font-mono`}
          rows={6}
          maxLength={1000}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 직접 출제
function DirectCreatePanel({ onCreated, onClose }: { onCreated: (id: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [searching, setSearching] = useState(false)
  const [stock, setStock] = useState<Stock | null>(null)
  const [baseDate, setBaseDate] = useState('')
  const [saving, setSaving] = useState(false)

  // 검색어 debounce → stock_api 종목 검색(국내만 — 일봉은 ClickHouse 국내 종목)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      searchStocks(q)
        .then((rows) => {
          if (!cancelled) setResults(rows.filter((s) => s.country === 'KR'))
        })
        .catch(() => {
          if (!cancelled) showToast('종목 검색에 실패했습니다. (stock_api 8002 확인)', { icon: '⚠️' })
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const submit = async () => {
    if (!stock) return showToast('종목을 선택하세요.', { icon: '⚠️' })
    if (!baseDate) return showToast('기준일을 선택하세요.', { icon: '⚠️' })
    setSaving(true)
    try {
      const created = await createQuiz(stock.symbol, baseDate)
      showToast(`퀴즈 #${created.id} 출제 완료 — 해설을 확인·수정하세요.`, { icon: '✅' })
      onCreated(created.id)
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border border-indigo-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">직접 출제</h3>
        <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
          닫기
        </button>
      </div>
      <p className="text-sm text-slate-500">
        기준일까지 60거래일 차트를 문제로, 이후 5거래일 종가 등락으로 정답·해설을 자동 계산합니다(등락 1% 미만·데이터
        부족·이상치는 거절).
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <input
            className={inputCls}
            placeholder="종목명 또는 코드 검색"
            value={stock ? `${stock.name} (${stock.symbol})` : query}
            onChange={(e) => {
              setStock(null)
              setQuery(e.target.value)
            }}
          />
          {!stock && query.trim() && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow">
              {searching ? (
                <li className="px-3 py-2 text-sm text-slate-400">검색 중…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-400">국내 종목 결과 없음</li>
              ) : (
                results.map((s) => (
                  <li key={s.symbol}>
                    <button
                      type="button"
                      onClick={() => setStock(s)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      {s.name} <span className="text-slate-400">{s.symbol} · {s.market}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={baseDate}
          onChange={(e) => setBaseDate(e.target.value)}
          aria-label="기준일"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? '출제 중…' : '출제'}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 목록
function QuizzesPanel() {
  const [filter, setFilter] = useState<ActiveFilter>('all')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<QuizAdminList | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [genCount, setGenCount] = useState('20')
  const [generating, setGenerating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    listQuizzes({ page, size: PAGE_SIZE, active: FILTER_PARAM[filter] })
      .then(setList)
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(gameErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [page, filter])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1

  const generate = async () => {
    const n = Number(genCount)
    if (!Number.isInteger(n) || n < 1 || n > 200) return showToast('생성 개수는 1~200 이어야 합니다.', { icon: '⚠️' })
    setGenerating(true)
    try {
      const r = await generateQuizzes(n)
      showToast(`${r.created}개 생성 (중복 건너뜀 ${r.skipped}개)`, { icon: '✅' })
      if (page === 1) load()
      else setPage(1)
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900">퀴즈 관리</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
            aria-label="자동 생성 개수"
          />
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {generating ? '생성 중…' : `${genCount || 'N'}개 자동 생성`}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            직접 출제
          </button>
        </div>
      </div>

      {showCreate && (
        <DirectCreatePanel
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            setSelectedId(id)
            if (page === 1) load()
            else setPage(1)
          }}
        />
      )}

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">상태</span>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as ActiveFilter)
            setPage(1)
          }}
        >
          <option value="all">전체</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>
        {list && <span className="text-slate-400">총 {list.total.toLocaleString()}개</span>}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          {loading && !list ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : loadFailed ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center">
              <p className="text-sm text-slate-600">퀴즈 목록을 불러오지 못했습니다.</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                다시 시도
              </button>
            </div>
          ) : list && list.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
              퀴즈가 없습니다.
            </p>
          ) : (
            list && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">종목</th>
                      <th className="px-3 py-2">기준일</th>
                      <th className="px-3 py-2">패턴</th>
                      <th className="px-3 py-2">차트·예측</th>
                      <th className="px-3 py-2">정답</th>
                      <th className="px-3 py-2 text-right">시도</th>
                      <th className="px-3 py-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((q) => (
                      <tr
                        key={q.id}
                        onClick={() => setSelectedId(q.id)}
                        className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                          selectedId === q.id ? 'bg-indigo-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-slate-400">{q.id}</td>
                        <td className="px-3 py-2">{q.ticker}</td>
                        <td className="px-3 py-2">{q.base_date}</td>
                        <td className="px-3 py-2">{q.pattern_type}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {q.window_bars ?? 60}봉 · {q.horizon_bars ?? DEFAULT_HORIZON}일
                        </td>
                        <td className={`px-3 py-2 ${q.answer === 'UP' ? 'text-red-600' : 'text-blue-600'}`}>
                          {ANSWER_LABEL[q.answer]} {formatChange(q.actual_change)}
                        </td>
                        <td className="px-3 py-2 text-right">{q.attempt_count}</td>
                        <td className="px-3 py-2">
                          {q.is_active ? (
                            <span className="text-emerald-600">활성</span>
                          ) : (
                            <span className="text-slate-400">비활성</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {list && list.total > 0 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-slate-600">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </div>

        <div>
          {selectedId === null ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
              목록에서 퀴즈를 선택하면 차트·해설이 표시됩니다.
            </p>
          ) : (
            <QuizDetailPanel
              key={selectedId}
              quizId={selectedId}
              onChanged={load}
              onDeleted={() => {
                setSelectedId(null)
                load()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function TradingGameQuizzes() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">퀴즈 관리</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">VITE_GAME_API_URL 을 설정해 빌드하면 사용할 수 있습니다.</p>
        </div>
      </div>
    )
  }
  return <QuizzesPanel />
}
