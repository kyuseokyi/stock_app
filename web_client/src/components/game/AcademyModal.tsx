import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Modal from '../ui/Modal'
import { getAcademyQuiz, submitAcademy } from '../../api/game'
import { gameErrorMessage } from '../../lib/gameErrors'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { AcademyQuiz, AcademySubmitResult } from '../../types/game'

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

// 아카데미 모달 — 리스크 관리 3문항. 모두 맞히면 5배 레버리지 해금(재응시 무제한). 로그인 전용.
export default function AcademyModal({ onClose }: { onClose: () => void }) {
  const setAcademyUnlocked = useTradingGameStore((s) => s.setAcademyUnlocked)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [state, setState] = useState<Load<AcademyQuiz>>({ kind: 'loading' })
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<AcademySubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const gen = currentPrivateGen()
    setState({ kind: 'loading' })
    getAcademyQuiz()
      .then((data) => {
        if (cancelled) return
        setState({ kind: 'ok', data })
        if (data.unlocked) setAcademyUnlocked(true, gen) // 다른 기기에서 해금한 경우 동기화
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, setAcademyUnlocked])

  const submit = async () => {
    if (submitting) return
    const gen = currentPrivateGen()
    setSubmitting(true)
    try {
      const res = await submitAcademy(answers)
      setResult(res)
      if (res.unlocked) {
        setAcademyUnlocked(true, gen)
        pushToast({ kind: 'info', icon: '🔓', message: '5배 레버리지가 해금됐어요' })
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
  }

  return (
    <Modal title="🎓 아카데미" onClose={onClose}>
      {state.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{state.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}
      {state.kind === 'ok' && state.data.unlocked && result === null && (
        <p className="py-10 text-center font-semibold text-ink">🔓 5배 레버리지가 해금됐어요</p>
      )}
      {state.kind === 'ok' && (!state.data.unlocked || result !== null) && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">세 문제를 모두 맞히면 5배 레버리지가 열려요.</p>
          {state.data.questions.map((q, qi) => {
            const r = result?.results.find((x) => x.id === q.id) ?? null
            return (
              <Card key={q.id} as="fieldset">
                <legend className="sr-only">문항 {qi + 1}</legend>
                <p className="font-semibold text-ink">
                  {qi + 1}. {q.question}
                  {r && <span className="ml-1">{r.correct ? '✅' : '❌'}</span>}
                </p>
                <div className="mt-2 space-y-1.5">
                  {q.choices.map((c, ci) => (
                    <label key={ci} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name={`academy-${q.id}`}
                        className="mt-1"
                        checked={answers[q.id] === ci}
                        disabled={result !== null || submitting}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
                {r && (
                  <div className="mt-3 rounded-field bg-white p-3 text-sm">
                    <p className="font-semibold text-ink">정답: {q.choices[r.answer] ?? '—'}</p>
                    <p className="mt-1 text-ink-muted">{r.explanation}</p>
                  </div>
                )}
              </Card>
            )
          })}
          {result === null ? (
            <Button
              full
              disabled={state.data.questions.some((q) => answers[q.id] === undefined)}
              loading={submitting}
              loadingText="채점 중…"
              onClick={() => void submit()}
            >
              제출
            </Button>
          ) : result.unlocked ? (
            <p className="text-center font-semibold text-brand">🔓 5배 레버리지가 해금됐어요</p>
          ) : (
            <Button full variant="secondary" onClick={retry}>
              다시 도전
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
