import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  analyze, batchTop, getCatalog, getQuantPreview, getReport,
  type AiReport, type QuantPreview, type ReportSummary, type SkillMeta,
} from '../api/aiLab'
import ConfirmDialog from '../components/aiLab/ConfirmDialog'
import FullScreenSheet from '../components/aiLab/FullScreenSheet'
import NewsCard from '../components/aiLab/NewsCard'
import QuantCard from '../components/aiLab/QuantCard'
import ReportCard from '../components/aiLab/ReportCard'
import ReportHistory from '../components/aiLab/ReportHistory'
import VerifyStockPicker from '../components/market/VerifyStockPicker'
import PageHeader from '../leaders/components/ui/PageHeader'
import { useMediaQuery } from '../leaders/hooks/useMediaQuery'
import {
  analyzeErrorMessage, batchErrorMessage, httpStatus, parseCapital, parseRisk, skillsParam, won,
} from '../lib/aiLab'
import { hasPermission } from '../lib/permissions'
import { showToast } from '../lib/toast'
import { useMeStore } from '../store/me'

// 관리자 'AI 종목 심층 분석(AI Lab)' — 정량 미리 보기(비용 0원) → AI 분석(같은 기준일 저장분 재사용) → 리포트·히스토리.
// 네이버 뉴스는 AI 와 분리된 별도 카드. 설계 docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 4절
type Pending = { kind: 'force' } | { kind: 'batch'; source: 'surge' | 'leaders' } | null

const BATCH_LABEL = { surge: '급등 Top 5', leaders: '주도주 Top 5' } as const

export default function MarketAiLab() {
  const canBatch = hasPermission(useMeStore((s) => s.user), 'DATA_PIPELINE')
  // 넓은 화면은 오른쪽 히스토리 + 왼쪽 상세, 좁은 화면은 히스토리 행을 누르면 전체 화면 상세
  const wide = useMediaQuery('(min-width: 1024px)')
  const [params, setParams] = useSearchParams()
  const ticker = (params.get('ticker') ?? '').trim().toUpperCase()

  const [capitalInput, setCapitalInput] = useState('10,000,000')
  const [riskInput, setRiskInput] = useState('1.0')
  const [catalog, setCatalog] = useState<SkillMeta[]>([])
  const [skills, setSkills] = useState<string[]>([])

  const [preview, setPreview] = useState<QuantPreview | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [report, setReport] = useState<AiReport | null>(null)
  const [reportSaved, setReportSaved] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [pending, setPending] = useState<Pending>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)
  const [historyReport, setHistoryReport] = useState<AiReport | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const seq = useRef(0) // 늦게 온 옛 응답이 새 종목 화면을 덮지 않게
  const inputs = useRef({ capitalInput, riskInput })
  inputs.current = { capitalInput, riskInput }

  useEffect(() => {
    getCatalog()
      .then((c) => { setCatalog(c); setSkills(c.map((s) => s.id)) })
      .catch(() => setCatalog([]))
  }, [])

  const runPreview = useCallback(async (t: string) => {
    const capital = parseCapital(inputs.current.capitalInput)
    const risk = parseRisk(inputs.current.riskInput)
    if (capital == null || risk == null) {
      setPreviewState('failed')
      setPreviewError('자본(10만~1,000억 원)과 리스크(0.1~5%)를 숫자로 넣으세요.')
      return
    }
    const my = ++seq.current
    setPreviewState('loading')
    setPreviewError(null)
    try {
      const q = await getQuantPreview(t, capital, risk)
      if (my !== seq.current) return
      setPreview(q)
      setPreviewState('ok')
      // 같은 기준일 저장분이 있으면 AI 를 부르지 않고 바로 보여 준다(없으면 404 — 조용히 넘김)
      try {
        const saved = await getReport(t, q.as_of)
        if (my === seq.current) { setReport(saved); setReportSaved(true) }
      } catch {
        if (my === seq.current) setReport((cur) => (cur && cur.ticker === t && cur.as_of_date === q.as_of ? cur : null))
      }
    } catch (e) {
      if (my !== seq.current) return
      setPreview(null)
      setPreviewState('failed')
      setPreviewError(httpStatus(e) === 404 ? '종목 없음 — 일봉 자료가 없는 종목입니다.' : analyzeErrorMessage(e))
    }
  }, [])

  // 주소의 ?ticker= 가 바뀌면 그 종목을 바로 미리 보기
  useEffect(() => {
    setReport(null)
    setReportSaved(false)
    setAnalyzeError(null)
    if (!ticker) { seq.current++; setPreview(null); setPreviewState('idle'); return }
    void runPreview(ticker)
  }, [ticker, runPreview])

  const pick = (t: string) => {
    setHistoryReport(null)
    if (t === ticker) void runPreview(t)
    else setParams({ ticker: t })
  }

  const skillsArg = catalog.length ? skillsParam(skills, catalog.map((s) => s.id)) : undefined
  const canAnalyze = !!ticker && previewState === 'ok' && skillsArg !== null && !analyzing

  const doAnalyze = async (force: boolean) => {
    if (!ticker || skillsArg === null) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const r = await analyze(ticker, { force, skills: skillsArg })
      setReport(r)
      setReportSaved(!!r.cached)
      setHistoryKey((k) => k + 1)
      if (r.cached) showToast('같은 기준일에 저장된 리포트를 보여 줍니다(AI 호출 안 함).', { icon: '💾' })
    } catch (e) {
      setAnalyzeError(analyzeErrorMessage(e))
    } finally {
      setAnalyzing(false)
    }
  }

  const doBatch = async (source: 'surge' | 'leaders') => {
    setBatchBusy(true)
    try {
      await batchTop(source, 5)
      showToast(`작업 등록됨 — ${BATCH_LABEL[source]} 일괄 분석을 시작했습니다. 몇 분 뒤 히스토리를 새로 고치세요.`, { icon: '🧠' })
    } catch (e) {
      showToast(batchErrorMessage(e), { icon: '⚠️' })
    } finally {
      setBatchBusy(false)
    }
  }

  const confirmPending = () => {
    const p = pending
    setPending(null)
    if (p?.kind === 'force') void doAnalyze(true)
    else if (p?.kind === 'batch') void doBatch(p.source)
  }

  const openHistory = async (r: ReportSummary) => {
    setHistoryLoading(true)
    try {
      setHistoryReport(await getReport(r.ticker, r.as_of_date))
    } catch (e) {
      showToast(analyzeErrorMessage(e), { icon: '⚠️' })
    } finally {
      setHistoryLoading(false)
    }
  }

  const toggleSkill = (id: string) =>
    setSkills((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  // 히스토리에서 연 리포트 — 정량 카드는 그 리포트 기준일의 quant_facts(현재 미리 보기와 숫자가 섞이지 않게)
  const historyDetail = historyReport && (
    <div className="flex flex-col gap-4">
      <ReportCard report={historyReport} saved />
      {historyReport.quant_facts && <QuantCard q={historyReport.quant_facts} />}
      <NewsCard ticker={historyReport.ticker} date={historyReport.as_of_date} />
    </div>
  )

  const workspace = (
    <div className="flex flex-col gap-4">
      {previewState === 'idle' && (
        <p className="rounded-card bg-surface p-6 text-center text-sm text-ink-muted">
          종목을 검색하거나 6자리 코드를 넣고 Enter 를 누르면 정량 미리 보기(비용 0원)를 보여 줍니다.
        </p>
      )}
      {previewState === 'loading' && <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">정량 자료를 계산하는 중…</p>}
      {previewState === 'failed' && previewError && (
        <p className="rounded-card bg-danger-soft p-4 text-sm text-danger">{previewError}</p>
      )}
      {analyzeError && <p role="alert" className="rounded-card bg-danger-soft p-4 text-sm text-danger">{analyzeError}</p>}
      {analyzing && <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">AI 분석 중… (수십 초 걸릴 수 있습니다)</p>}
      {report && report.ticker === ticker && <ReportCard report={report} saved={reportSaved} />}
      {previewState === 'ok' && preview && <QuantCard q={preview} />}
      {previewState === 'ok' && preview && <NewsCard ticker={preview.ticker} date={preview.as_of} />}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI 종목 심층 분석"
        description="정량 자료(SEPA·셋업 백테스트·시장 폭·포지션 크기·업종 비교·실적)는 파이썬이 계산하고, AI 는 정량 자료와 DART 공시만 받아 해석합니다. 관리자 전용." />

      <section className="flex flex-col gap-3 rounded-card bg-surface p-4" aria-label="분석 조건">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[220px] flex-[2_1_260px] flex-col gap-1">
            <span className="text-xs text-ink-muted">종목{ticker ? ` — 현재 ${preview?.name ?? ''} ${ticker}` : ''}</span>
            <VerifyStockPicker onPick={pick} />
          </div>
          <label className="flex flex-[1_1_150px] flex-col gap-1">
            <span className="text-xs text-ink-muted">기준 자본(원)</span>
            <input value={capitalInput} onChange={(e) => setCapitalInput(e.target.value)} inputMode="numeric"
              onBlur={() => { const c = parseCapital(capitalInput); if (c != null) setCapitalInput(c.toLocaleString('ko-KR')) }}
              className="h-10 rounded-field bg-fill px-3 text-sm tabular-nums text-ink" />
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-xs text-ink-muted">리스크(%)</span>
            <input value={riskInput} onChange={(e) => setRiskInput(e.target.value)} inputMode="decimal"
              className="h-10 rounded-field bg-fill px-3 text-sm tabular-nums text-ink" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!ticker || previewState === 'loading'} onClick={() => ticker && void runPreview(ticker)}
            className="h-11 rounded-btn bg-fill px-4 text-sm font-medium text-ink disabled:opacity-50">
            정량 미리 보기 <span className="ml-1 text-xs text-ink-muted">비용 0원</span>
          </button>
          <button type="button" disabled={!canAnalyze} onClick={() => void doAnalyze(false)}
            className="h-11 rounded-btn bg-brand px-4 text-sm font-semibold text-ink disabled:opacity-50">
            {analyzing ? 'AI 분석 중…' : 'AI 분석'}
          </button>
          <button type="button" disabled={!canAnalyze} onClick={() => setPending({ kind: 'force' })}
            className="h-11 rounded-btn bg-surface px-4 text-sm text-ink ring-1 ring-inset ring-line disabled:opacity-50">
            다시 분석
          </button>
          <span className="text-xs text-ink-muted">
            같은 기준일 저장분이 있으면 'AI 분석'은 저장분을 보여 줍니다. 스킬 선택을 바꿨다면 '다시 분석'에만 반영됩니다.
          </span>
        </div>

        {catalog.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-ink-muted">
              사용할 스킬 ({skills.length} / {catalog.length})
              <button type="button" className="ml-2 text-brand-strong hover:underline" onClick={() => setSkills(catalog.map((s) => s.id))}>전체 선택</button>
            </legend>
            <div className="flex flex-wrap gap-2">
              {catalog.map((s) => (
                <label key={s.id} title={`${s.description} (참고: ${s.source_repo}, ${s.license})`}
                  className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm ${
                    skills.includes(s.id) ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink-muted'}`}>
                  <input type="checkbox" checked={skills.includes(s.id)} onChange={() => toggleSkill(s.id)} className="accent-brand" />
                  {s.name}
                </label>
              ))}
            </div>
            {skills.length === 0 && <p className="text-xs text-danger">스킬을 하나 이상 고르세요.</p>}
          </fieldset>
        )}

        {canBatch && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-muted">일괄 분석(백그라운드)</span>
            {(['surge', 'leaders'] as const).map((src) => (
              <button key={src} type="button" disabled={batchBusy} onClick={() => setPending({ kind: 'batch', source: src })}
                className="h-10 rounded-btn bg-fill px-3 text-sm text-ink disabled:opacity-50">
                {src === 'surge' ? '🔥' : '🏆'} {BATCH_LABEL[src]} 분석
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0">
          {wide && historyReport ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-brand-soft px-4 py-2 text-sm text-brand-strong">
                <span>히스토리 리포트 보기 — {historyReport.stock_name} {historyReport.ticker} · 기준일 {historyReport.as_of_date}</span>
                <button type="button" onClick={() => setHistoryReport(null)}
                  className="h-9 rounded-btn bg-surface px-3 text-sm text-ink">작업 화면으로</button>
              </div>
              {historyDetail}
            </div>
          ) : workspace}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto" aria-label="리포트 히스토리 목록">
          <ReportHistory reloadKey={historyKey} selectedId={historyReport?.id ?? null}
            onOpen={(r) => void openHistory(r)} />
          {historyLoading && <p className="mt-2 text-xs text-ink-muted">리포트를 여는 중…</p>}
        </aside>
      </div>

      {!wide && historyReport && (
        <FullScreenSheet title={`${historyReport.stock_name} · ${historyReport.as_of_date} 리포트`} onClose={() => setHistoryReport(null)}>
          {historyDetail}
        </FullScreenSheet>
      )}

      <ConfirmDialog open={pending !== null} onCancel={() => setPending(null)} onConfirm={confirmPending}
        title={pending?.kind === 'batch' ? `${BATCH_LABEL[pending.source]} 일괄 분석` : 'AI 다시 분석'}
        confirmLabel={pending?.kind === 'batch' ? '작업 등록' : '다시 분석'}>
        {pending?.kind === 'batch' ? (
          <p>대상 종목(최대 5개)마다 Gemini 를 한 번씩 불러 <strong>비용이 듭니다</strong>. 오늘 리포트가 이미 있는 종목은 건너뜁니다. 등록할까요?</p>
        ) : (
          <p>
            저장분을 무시하고 Gemini 를 다시 불러 <strong>비용이 듭니다</strong>. 같은 기준일 리포트를 새 결과로 덮어씁니다.
            {preview ? ` (${preview.name ?? ticker} · 기준일 ${preview.as_of} · 종가 ${won(preview.close)})` : ''} 계속할까요?
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
