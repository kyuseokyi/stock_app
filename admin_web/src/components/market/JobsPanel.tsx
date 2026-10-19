import { useCallback, useEffect, useState } from 'react'
import { getJobs, runJob } from '../../api/marketAdmin'
import { apiErrorDetail, apiErrorMessage } from '../../lib/apiError'
import { formatDateTime } from '../../lib/marketFormat'
import { showToast } from '../../lib/toast'
import type { AdminJob, JobStatus, JobsOverview } from '../../types/marketAdmin'

const POLL_MS = 5000
const JOB_STATUS: Record<JobStatus, string> = { idle: '실행', queued: '대기 중', running: '실행 중' }
const RUN_STATE: Record<string, string> = {
  PENDING: '대기 중',
  RECEIVED: '대기 중',
  STARTED: '실행 중',
  RETRY: '재시도 중',
  SUCCESS: '완료',
  FAILURE: '실패',
  REVOKED: '취소됨',
  UNKNOWN: '결과 만료',
}
const stateClass = (s: string): string =>
  s === 'FAILURE' ? 'text-red-600' : s === 'SUCCESS' ? 'text-emerald-600' : 'text-slate-500'

export default function JobsPanel() {
  const [data, setData] = useState<JobsOverview | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  // 폴링 중 오류는 조용히(5초마다 토스트가 쌓이지 않게)
  const load = useCallback(async (silent = false) => {
    try {
      setData(await getJobs())
    } catch (e) {
      if (!silent) showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const active = data?.jobs.some((j) => j.status !== 'idle') ?? false
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void load(true), POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, load])

  const run = async (job: AdminJob) => {
    if (!window.confirm(`${job.label}을(를) 실행할까요?\n예상 시간: ${job.eta} · KIS 호출 없음`)) return
    setSending(job.key)
    try {
      await runJob(job.key)
      showToast(`${job.label} 실행을 요청했어요`)
    } catch (e) {
      const d = apiErrorDetail(e)
      if (d?.code === 'JOB_RUNNING') {
        showToast(`이미 실행 중이에요(${formatDateTime(d.requested_at as string | null)} 시작)`, { icon: '⏳' })
      } else {
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      }
    } finally {
      setSending(null)
      await load()
    }
  }

  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-800">계산 수동 실행</h2>
        <p className="text-sm text-slate-500">
          KIS 를 호출하지 않는 계산만 실행할 수 있어요. 같은 작업은 한 번에 하나만 돌아요. 수집 작업은 다음 단계에서 추가돼요.
        </p>
      </div>
      {!data ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.jobs.map((job) => (
              <div key={job.key} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{job.label}</p>
                    {job.status !== 'idle' && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {JOB_STATUS[job.status]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-keep text-xs text-slate-500">{job.description}</p>
                  <p className="mt-1 text-xs text-slate-400">예상 {job.eta} · KIS 호출 없음</p>
                </div>
                <button
                  type="button"
                  disabled={job.status !== 'idle' || sending === job.key}
                  onClick={() => void run(job)}
                  className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {JOB_STATUS[job.status]}
                </button>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                  <th className="px-4 py-2">요청 시각</th>
                  <th>작업</th>
                  <th>실행자</th>
                  <th>상태</th>
                  <th className="pr-4">결과</th>
                </tr>
              </thead>
              <tbody>
                {data.history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-center text-slate-400">
                      실행 기록이 없어요
                    </td>
                  </tr>
                ) : (
                  data.history.map((h) => (
                    <tr key={h.task_id} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(h.requested_at)}</td>
                      <td>{h.label}</td>
                      <td className="text-xs">{h.actor ?? '—'}</td>
                      <td className={`text-xs font-semibold ${stateClass(h.state)}`}>{RUN_STATE[h.state] ?? h.state}</td>
                      <td className="max-w-[240px] truncate pr-4 text-xs text-slate-500" title={h.result_summary ?? ''}>
                        {h.result_summary ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
