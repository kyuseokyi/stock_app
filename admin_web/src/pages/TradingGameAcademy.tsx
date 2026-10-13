import { useCallback, useEffect, useState } from 'react'
import { GAME_API_URL } from '../config'
import {
  createAcademyQuestion,
  deleteAcademyQuestion,
  listAcademyQuestions,
  updateAcademyQuestion,
} from '../api/academyAdmin'
import { gameErrorMessage } from '../lib/gameApiError'
import { showToast } from '../lib/toast'
import type { AcademyQuestionAdmin, AcademyQuestionBody } from '../types/game'

const MIN_CHOICES = 2
const MAX_CHOICES = 6

interface FormState {
  id: number | null // null = 새 문항
  question: string
  choices: string[]
  answer: number
  explanation: string
  sort_order: string
  is_active: boolean
}

const emptyForm = (nextOrder: number): FormState => ({
  id: null,
  question: '',
  choices: ['', ''],
  answer: 0,
  explanation: '',
  sort_order: String(nextOrder),
  is_active: true,
})

const toForm = (q: AcademyQuestionAdmin): FormState => ({
  id: q.id,
  question: q.question,
  choices: [...q.choices],
  answer: q.answer,
  explanation: q.explanation,
  sort_order: String(q.sort_order),
  is_active: q.is_active,
})

const toBody = (q: AcademyQuestionAdmin): AcademyQuestionBody => ({
  question: q.question,
  choices: q.choices,
  answer: q.answer,
  explanation: q.explanation,
  sort_order: q.sort_order,
  is_active: q.is_active,
})

// 백엔드 검증과 동일(앞뒤 공백 제거 후 길이)
const validate = (f: FormState): string | null => {
  const q = f.question.trim()
  if (q.length < 1 || q.length > 500) return '질문은 1~500자로 입력하세요.'
  if (f.choices.length < MIN_CHOICES || f.choices.length > MAX_CHOICES) return '선택지는 2~6개여야 합니다.'
  if (f.choices.some((c) => c.trim().length < 1 || c.trim().length > 200)) return '선택지는 각각 1~200자로 입력하세요.'
  if (f.answer < 0 || f.answer >= f.choices.length) return '정답을 선택하세요.'
  const e = f.explanation.trim()
  if (e.length < 1 || e.length > 1000) return '해설은 1~1000자로 입력하세요.'
  const order = Number(f.sort_order)
  if (!Number.isInteger(order) || order < 0 || order > 10000) return '순서는 0~10000 정수여야 합니다.'
  return null
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

function QuestionEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: FormState
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [saving, setSaving] = useState(false)

  const setChoice = (idx: number, value: string) =>
    setForm((f) => ({ ...f, choices: f.choices.map((c, i) => (i === idx ? value : c)) }))

  const addChoice = () =>
    setForm((f) => (f.choices.length >= MAX_CHOICES ? f : { ...f, choices: [...f.choices, ''] }))

  const removeChoice = (idx: number) =>
    setForm((f) => {
      if (f.choices.length <= MIN_CHOICES) return f
      const choices = f.choices.filter((_, i) => i !== idx)
      // 정답 인덱스 보정: 삭제한 선택지가 정답이면 첫 선택지로, 앞쪽 삭제면 한 칸 당김
      const answer = f.answer === idx ? 0 : f.answer > idx ? f.answer - 1 : f.answer
      return { ...f, choices, answer }
    })

  const save = async () => {
    const invalid = validate(form)
    if (invalid) {
      showToast(invalid, { icon: '⚠️' })
      return
    }
    const body: AcademyQuestionBody = {
      question: form.question.trim(),
      choices: form.choices.map((c) => c.trim()),
      answer: form.answer,
      explanation: form.explanation.trim(),
      sort_order: Number(form.sort_order),
      is_active: form.is_active,
    }
    setSaving(true)
    try {
      if (form.id === null) await createAcademyQuestion(body)
      else await updateAcademyQuestion(form.id, body)
      showToast(form.id === null ? '문항을 추가했습니다.' : '문항을 저장했습니다.', { icon: '✅' })
      onSaved()
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-indigo-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{form.id === null ? '새 문항' : `문항 #${form.id} 편집`}</h3>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">질문</span>
        <textarea
          className={inputCls}
          rows={2}
          maxLength={500}
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">
          선택지 ({form.choices.length}/{MAX_CHOICES}) — 정답을 라디오로 선택
        </legend>
        <div className="space-y-2">
          {form.choices.map((choice, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="radio"
                name="academy-answer"
                aria-label={`${idx + 1}번을 정답으로`}
                checked={form.answer === idx}
                onChange={() => setForm((f) => ({ ...f, answer: idx }))}
              />
              <input
                className={inputCls}
                maxLength={200}
                placeholder={`선택지 ${idx + 1}`}
                value={choice}
                onChange={(e) => setChoice(idx, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeChoice(idx)}
                disabled={form.choices.length <= MIN_CHOICES}
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                aria-label={`선택지 ${idx + 1} 삭제`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addChoice}
          disabled={form.choices.length >= MAX_CHOICES}
          className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          + 선택지 추가
        </button>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">해설(채점 후 표시)</span>
        <textarea
          className={inputCls}
          rows={3}
          maxLength={1000}
          value={form.explanation}
          onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
        />
      </label>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          순서
          <input
            type="number"
            min={0}
            max={10000}
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            value={form.sort_order}
            onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          />
          활성(출제)
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}

function AcademyPanel() {
  const [questions, setQuestions] = useState<AcademyQuestionAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [editing, setEditing] = useState<FormState | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadFailed(false)
    listAcademyQuestions()
      .then(setQuestions)
      .catch((e: unknown) => {
        setLoadFailed(true)
        showToast(gameErrorMessage(e), { icon: '⚠️' })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeCount = questions.filter((q) => q.is_active).length
  const nextOrder = questions.reduce((m, q) => Math.max(m, q.sort_order), 0) + 1

  const toggleActive = async (q: AcademyQuestionAdmin) => {
    setPendingId(q.id)
    try {
      const saved = await updateAcademyQuestion(q.id, { ...toBody(q), is_active: !q.is_active })
      setQuestions((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setPendingId(null)
    }
  }

  const remove = async (q: AcademyQuestionAdmin) => {
    if (!window.confirm(`문항 #${q.id} 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return
    setPendingId(q.id)
    try {
      await deleteAcademyQuestion(q.id)
      setQuestions((prev) => prev.filter((x) => x.id !== q.id))
      if (editing?.id === q.id) setEditing(null)
      showToast('문항을 삭제했습니다.', { icon: '🗑️' })
    } catch (e) {
      showToast(gameErrorMessage(e), { icon: '⚠️' })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900">아카데미 문항</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyForm(nextOrder))}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + 문항 추가
        </button>
      </div>

      <div
        className={`mb-4 rounded-xl border px-5 py-3 text-sm ${
          activeCount === 0 ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600'
        }`}
      >
        활성 문항 <strong>{activeCount}</strong>개 · 사용자는 <strong>활성 문항을 모두 맞혀야</strong> 5배 레버리지가
        해금됩니다. 이미 해금한 사용자는 문항을 바꿔도 유지됩니다.
        {activeCount === 0 && ' 활성 문항이 없으면 아카데미 제출이 막힙니다.'}
      </div>

      {editing && (
        <div className="mb-6">
          <QuestionEditor
            key={editing.id ?? 'new'}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : loadFailed ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center">
          <p className="text-sm text-slate-600">문항을 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            다시 시도
          </button>
        </div>
      ) : questions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
          등록된 문항이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="rounded-xl border border-slate-200 bg-white px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-400">
                    순서 {q.sort_order} · #{q.id}
                    {!q.is_active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">비활성</span>}
                  </p>
                  <p className="mt-1 font-medium text-slate-900">{q.question}</p>
                  <ol className="mt-2 space-y-0.5 text-sm text-slate-600">
                    {q.choices.map((c, i) => (
                      <li key={i} className={i === q.answer ? 'font-semibold text-indigo-700' : undefined}>
                        {i + 1}. {c}
                        {i === q.answer && ' ✓'}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={q.is_active}
                    aria-label={`문항 #${q.id} 활성`}
                    disabled={pendingId !== null}
                    onClick={() => toggleActive(q)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition disabled:opacity-50 ${
                      q.is_active ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                        q.is_active ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(toForm(q))}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => remove(q)}
                    className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TradingGameAcademy() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">아카데미 문항</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">VITE_GAME_API_URL 을 설정해 빌드하면 사용할 수 있습니다.</p>
        </div>
      </div>
    )
  }
  return <AcademyPanel />
}
