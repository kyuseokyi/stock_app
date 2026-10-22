import { formatDateTime, formatSeconds } from '../../lib/marketFormat'
import type { BootstrapProgress, BootstrapStepState } from '../../types/marketAdmin'

// 초기 데이터 준비 단계 목록 — 진행 중이면 JobsPanel 폴링으로 갱신, 끝나면 마지막 결과를 그대로 보여준다
const STEP_ICON: Record<BootstrapStepState, string> = {
  pending: '○',
  running: '⏳',
  ok: '✅',
  failed: '❌',
  skipped: '⏭️',
}
const STEP_TEXT: Record<BootstrapStepState, string> = {
  pending: '대기',
  running: '진행 중',
  ok: '완료',
  failed: '실패',
  skipped: '건너뜀',
}
const stepClass = (s: BootstrapStepState): string =>
  s === 'failed' ? 'text-red-600' : s === 'ok' ? 'text-emerald-600' : s === 'running' ? 'text-indigo-600' : 'text-slate-400'

export default function BootstrapProgressPanel({
  progress,
  jobActive,
  jobTaskId,
}: {
  progress: BootstrapProgress
  jobActive: boolean
  jobTaskId: string | null // 지금 대기·실행 중인 bootstrap 작업의 task_id(없으면 null)
}) {
  // 작업 잠금이 풀렸는데 끝 시각이 없으면 워커 재시작 등으로 중단된 것 — '진행 중'으로 계속 보이지 않게
  const interrupted = !progress.finished_at && !jobActive
  // 대기·실행 중인 작업이 이 기록의 작업이 아니면(새로 눌렀는데 아직 시작 전) 보이는 건 이전 기록
  const waiting = jobActive && !!jobTaskId && progress.task_id !== jobTaskId
  const title = waiting ? '대기 중(이전 기록)' : progress.finished_at ? '마지막 결과' : interrupted ? '중단됨' : '진행 중'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">
          초기 데이터 준비 — {title}
          {interrupted && <span className="ml-2 text-xs font-normal text-red-600">끝나지 않고 멈췄어요. 다시 실행하면 이어서 채워져요</span>}
        </p>
        <p className="text-xs text-slate-400">
          시작 {formatDateTime(progress.started_at)}
          {progress.finished_at && ` · 종료 ${formatDateTime(progress.finished_at)}`}
          {progress.end_date && ` · 일봉 ${progress.months}개월, ${progress.end_date}까지`}
        </p>
      </div>
      {progress.skipped && (
        <p className="mt-2 text-xs text-amber-600">
          {progress.skipped_at && `${formatDateTime(progress.skipped_at)} `}
          {progress.skipped}
        </p>
      )}
      <ol className="mt-3 space-y-1.5">
        {progress.steps.map((s, i) => {
          // 중단된 기록의 running 단계는 실제로는 멈춘 것
          const stopped = interrupted && s.state === 'running'
          return (
          <li key={s.key} className="flex min-w-0 items-start gap-2 text-xs">
            <span className="w-5 shrink-0 text-center" aria-hidden>
              {stopped ? '⛔' : (STEP_ICON[s.state] ?? '·')}
            </span>
            <span className="w-40 shrink-0 text-slate-700">
              {i + 1}. {s.label}
            </span>
            <span className={`w-14 shrink-0 font-semibold ${stopped ? 'text-red-600' : stepClass(s.state)}`}>
              {stopped ? '중단' : (STEP_TEXT[s.state] ?? s.state)}
            </span>
            <span className="w-16 shrink-0 text-slate-500">{s.seconds != null ? formatSeconds(s.seconds) : ''}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500" title={s.reason ?? s.summary ?? ''}>
              {s.reason ?? s.summary ?? ''}
            </span>
          </li>
          )
        })}
      </ol>
    </div>
  )
}
