import { useEffect, useState } from 'react'
import { deleteNote, putNote } from '../../api/dailySurge'
import { apiErrorMessage } from '../../lib/apiError'
import { showToast } from '../../lib/toast'

// 이유 메모 — (날짜, 테마) 또는 (날짜, 종목)에 한 줄(300자). 관리자가 쓴 글이라 날짜별로 남는다(집계가 덮어쓰지 않음).
interface Props {
  date: string
  scope: 'stock' | 'theme'
  target: string
  /** 지금 저장된 메모(이 scope 의 것) */
  value: string | null
  /** 종목 화면에서 종목 메모가 없을 때 보여 줄 테마 공통 메모 */
  inherited?: { text: string; themeName: string | null } | null
  onSaved: () => void
}

export default function NoteEditor({ date, scope, target, value, inherited, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setText(value ?? ''); setEditing(false) }, [value, date, target])

  const save = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await putNote(date, scope, target, text.trim())
      setEditing(false)
      onSaved()
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await deleteNote(date, scope, target)
      onSaved()
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBusy(false)
    }
  }

  const shown = value ?? inherited?.text ?? null
  const scopeLabel = value ? (scope === 'theme' ? '테마 공통' : '종목') : inherited ? `테마 공통: ${inherited.themeName ?? ''}` : ''

  return (
    <section className="flex flex-col gap-2 rounded-field bg-brand-soft p-3" aria-label="이유 메모">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-brand-strong">
          이유 메모 {scopeLabel && <span className="font-normal">({scopeLabel})</span>}
        </h3>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className="min-h-[36px] rounded-btn bg-surface px-3 text-xs font-medium text-brand-strong">
            {value ? '수정' : scope === 'stock' ? '종목 메모 작성' : '작성'}
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${scope}-${target}`} className="sr-only">이유 메모</label>
          <textarea id={`note-${scope}-${target}`} value={text} maxLength={300} rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder="예: 한한령 해제 기대 — 중국 단체관광 재개 보도"
            className="w-full rounded-field bg-surface p-2 text-sm text-ink" />
          <div className="flex flex-wrap justify-end gap-2">
            {value && (
              <button type="button" onClick={remove} disabled={busy}
                className="min-h-[36px] rounded-btn px-3 text-xs text-danger">지우기</button>
            )}
            <button type="button" onClick={() => { setEditing(false); setText(value ?? '') }}
              className="min-h-[36px] rounded-btn bg-surface px-3 text-xs text-ink">취소</button>
            <button type="button" onClick={save} disabled={busy || !text.trim()}
              className="min-h-[36px] rounded-btn bg-brand px-3 text-xs font-medium text-ink disabled:opacity-50">저장</button>
          </div>
        </div>
      ) : (
        <p className={`text-sm ${shown ? 'text-ink' : 'text-ink-muted'}`}>
          {shown ?? '아직 메모가 없습니다. 아래 뉴스·공시를 보고 이유를 한 줄 적어 주세요.'}
        </p>
      )}
      <p className="text-xs text-ink-muted">날짜별로 저장됩니다. 종목 메모가 있으면 테마 메모보다 먼저 보입니다.</p>
    </section>
  )
}
