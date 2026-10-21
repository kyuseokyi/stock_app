import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { cancelPushSend, createFundNotice, listPushSends, previewFundNotice } from '../api/fundNotices'
import { createPushTemplate, deletePushTemplate, listPushTemplates, updatePushTemplate } from '../api/pushTemplates'
import { apiErrorDetail, apiErrorMessage } from '../lib/apiError'
import { minScheduleLocal, renderPushText, todayKst } from '../lib/pushText'
import { showToast } from '../lib/toast'
import type { FundNoticePreviewOut, PushSendMode, PushSendOut, PushTemplateOut } from '../types/api'

const MODE_LABEL: Record<PushSendMode, string> = { now: '즉시', test: '테스트', scheduled: '예약' }
const STATUS_LABEL: Record<PushSendOut['status'], string> = {
  scheduled: '예약됨', sending: '발송 중', done: '완료', failed: '실패', cancelled: '취소',
}
const STATUS_CLASS: Record<PushSendOut['status'], string> = {
  scheduled: 'bg-amber-100 text-amber-700',
  sending: 'bg-indigo-100 text-indigo-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-')

function errorCode(e: unknown): string | undefined {
  const d: unknown = apiErrorDetail(e)
  return typeof d === 'object' && d !== null && 'code' in d ? String((d as { code: unknown }).code) : undefined
}

// 펀드 리포트 알림 — 작성·발송(테스트/즉시/예약) · 발송 이력 · 문구 템플릿
export default function FundNoticesPage() {
  const [tab, setTab] = useState<'send' | 'templates'>('send')
  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">펀드 리포트 알림</h2>
      <div className="mb-4 flex gap-2">
        {(['send', 'templates'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
          >
            {t === 'send' ? '발송' : '문구 템플릿'}
          </button>
        ))}
      </div>
      {tab === 'send' ? <SendPanel /> : <TemplatesPanel />}
    </div>
  )
}

function SendPanel() {
  const [date, setDate] = useState(todayKst())
  const [templates, setTemplates] = useState<PushTemplateOut[]>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<FundNoticePreviewOut | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [sends, setSends] = useState<PushSendOut[]>([])

  const loadSends = useCallback(async () => {
    try {
      setSends((await listPushSends(30)).items)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await previewFundNotice(date))
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [date])

  const applyTemplate = (t: PushTemplateOut) => {
    setTemplateId(t.id)
    setTitle(t.title)
    setBody(t.body)
  }

  useEffect(() => {
    void listPushTemplates().then((list) => {
      setTemplates(list)
      if (list[0]) {
        setTemplateId(list[0].id)
        setTitle(list[0].title)
        setBody(list[0].body)
      }
    })
    void loadSends()
  }, [loadSends])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  // 발송 중 행이 있으면 5초마다 이력·미리보기 새로고침
  useEffect(() => {
    if (!sends.some((s) => s.status === 'sending')) return
    const id = setInterval(() => {
      void loadSends()
      void loadPreview()
    }, 5000)
    return () => clearInterval(id)
  }, [sends, loadSends, loadPreview])

  async function submit(mode: PushSendMode, force = false): Promise<void> {
    if (!title.trim() || !body.trim()) {
      showToast('제목과 본문을 입력하세요.', { icon: '⚠️' })
      return
    }
    if (mode === 'scheduled' && !scheduleAt) {
      showToast('예약 시각을 입력하세요.', { icon: '⚠️' })
      return
    }
    setBusy(true)
    try {
      await createFundNotice({
        date, title, body, mode, template_id: templateId, force,
        ...(mode === 'scheduled' ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
      })
      showToast(mode === 'test' ? '내 기기로 테스트 발송했어요.' : mode === 'now' ? '발송을 시작했어요.' : '예약했어요.', { icon: '✅' })
      await Promise.all([loadSends(), loadPreview()])
    } catch (e) {
      if (errorCode(e) === 'already_sent' && !force) {
        if (confirm('이 기준일에 이미 보냈거나 예약된 알림이 있어요. 그래도 보낼까요?')) await submit(mode, true)
      } else {
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onCancel(id: number) {
    if (!confirm('예약을 취소할까요?')) return
    try {
      await cancelPushSend(id)
      showToast('예약을 취소했어요.', { icon: '✅' })
      await Promise.all([loadSends(), loadPreview()])
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }

  const myDevices = preview?.my_device_count ?? 0

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-600">
            기준일
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm text-slate-600">
            템플릿
            <select
              value={templateId ?? ''}
              onChange={(e) => {
                const t = templates.find((x) => x.id === Number(e.target.value))
                if (t) applyTemplate(t)
                else setTemplateId(null)
              }}
              className={inputClass}
            >
              <option value="">직접 입력</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm text-slate-600">
          제목 <span className="text-slate-400">({title.length}/100)</span>
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm text-slate-600">
          본문 <span className="text-slate-400">({body.length}/500) · {'{date}'} 는 기준일(M월 D일)로 바뀝니다</span>
          <textarea value={body} maxLength={500} rows={2} onChange={(e) => setBody(e.target.value)} className={inputClass} />
        </label>

        <div className="rounded-xl bg-slate-100 p-3">
          <p className="mb-1 text-xs text-slate-500">폰 알림 미리보기</p>
          <div className="rounded-lg bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">{renderPushText(title, date) || '제목'}</p>
            <p className="text-sm text-slate-600">{renderPushText(body, date) || '본문'}</p>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          대상 기기 <b>{preview?.target_count ?? '-'}</b>대
          {preview?.already_sent && preview.last_send ? (
            <span className="ml-2 text-amber-600">
              · 이 기준일 {STATUS_LABEL[preview.last_send.status]} ({fmt(preview.last_send.scheduled_at ?? preview.last_send.started_at)})
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <button
            disabled={busy || myDevices === 0}
            onClick={() => void submit('test')}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title={myDevices === 0 ? '앱에서 관리자 계정으로 로그인·알림 허용한 기기가 없어요' : undefined}
          >
            테스트 발송 (내 기기 {myDevices}대)
          </button>
          <button
            disabled={busy}
            onClick={() => void submit('now')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            지금 발송
          </button>
          <label className="text-sm text-slate-600">
            예약 시각
            <input
              type="datetime-local"
              min={minScheduleLocal()}
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            disabled={busy || !scheduleAt}
            onClick={() => void submit('scheduled')}
            className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            예약 발송
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {['기준일', '제목', '종류', '상태', '대상', '성공/실패', '보낸 사람', '시각', ''].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sends.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">발송 이력이 없습니다.</td></tr>
            ) : (
              sends.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{s.ref_date}</td>
                  <td className="px-4 py-3">{renderPushText(s.title, s.ref_date)}</td>
                  <td className="px-4 py-3">{MODE_LABEL[s.mode]}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                  <td className="px-4 py-3">{s.target_count}</td>
                  <td className="px-4 py-3">{s.success_count}/{s.failure_count}</td>
                  <td className="px-4 py-3">{s.created_by_nickname ?? '-'}</td>
                  <td className="px-4 py-3">{fmt(s.mode === 'scheduled' ? s.scheduled_at : s.started_at)}</td>
                  <td className="px-4 py-3">
                    {s.status === 'scheduled' ? (
                      <button onClick={() => void onCancel(s.id)} className="text-sm font-medium text-red-500 hover:text-red-700">취소</button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function TemplatesPanel() {
  const [list, setList] = useState<PushTemplateOut[]>([])
  const [editing, setEditing] = useState<PushTemplateOut | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(async () => {
    try {
      setList(await listPushTemplates())
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(t: PushTemplateOut | null) {
    setEditing(t)
    setTitle(t?.title ?? '')
    setBody(t?.body ?? '')
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      showToast('제목과 본문을 입력하세요.', { icon: '⚠️' })
      return
    }
    try {
      if (editing) await updatePushTemplate(editing.id, { title, body })
      else await createPushTemplate({ title, body })
      showToast('템플릿을 저장했어요.', { icon: '✅' })
      startEdit(null)
      await load()
    } catch (err) {
      showToast(apiErrorMessage(err), { icon: '⚠️' })
    }
  }

  async function onDelete(t: PushTemplateOut) {
    if (!confirm(`'${t.title}' 템플릿을 삭제할까요?`)) return
    try {
      await deletePushTemplate(t.id)
      await load()
    } catch (err) {
      showToast(apiErrorMessage(err), { icon: '⚠️' })
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">{editing ? `템플릿 수정 (#${editing.id})` : '새 템플릿'}</p>
        <input value={title} maxLength={100} placeholder="제목" onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <textarea
          value={body}
          maxLength={500}
          rows={2}
          placeholder="본문 — {date} 는 기준일(M월 D일)로 바뀝니다"
          onChange={(e) => setBody(e.target.value)}
          className={inputClass}
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">저장</button>
          {editing ? (
            <button type="button" onClick={() => startEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">취소</button>
          ) : null}
        </div>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>{['제목', '본문', '마지막 발송', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{t.title}</td>
                <td className="px-4 py-3 text-slate-600">{t.body}</td>
                <td className="px-4 py-3">{fmt(t.last_sent_at)}</td>
                <td className="space-x-3 px-4 py-3 text-right">
                  <button onClick={() => startEdit(t)} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">수정</button>
                  <button onClick={() => void onDelete(t)} className="text-sm font-medium text-red-500 hover:text-red-700">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
