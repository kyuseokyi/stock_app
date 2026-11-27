import type { AiReport } from '../../api/aiLab'
import {
  CONFIDENCE_LABEL, IMPACT_LABEL, SCENARIO_LABEL, SIGNAL_CLASS, SIGNAL_LABEL, VERDICT_CLASS, VERDICT_LABEL, classOf,
  isoDay, kstDateTime, labelOf, pct, ratioPct, sentiment, signClass, stars, summaryLines, won,
} from '../../lib/aiLab'
import Section from './Section'

// AI 리포트 카드 — 숫자(목표가·확률·기대수익률·별점·감성)는 파이썬이 검증·재계산한 저장값, 문장은 AI 해석.
// 네이버 뉴스는 이 카드에 절대 넣지 않는다(AI 입력도 아님) — 뉴스는 별도 카드(NewsCard).

const CHAIN = [
  { key: 'trigger', no: '①', label: '트리거' },
  { key: 'business', no: '②', label: '사업 변화' },
  { key: 'earnings_flow', no: '③', label: '실적·수급' },
  { key: 'price_momentum', no: '④', label: '주가 모멘텀' },
] as const

const SCENARIOS = ['bull', 'base', 'bear'] as const

export default function ReportCard({ report, saved }: { report: AiReport; saved: boolean }) {
  const lc = report.logic_chain_and_thesis?.logic_chain
  const thesis = report.logic_chain_and_thesis?.thesis
  const ev = report.ev_scenarios
  const lines = summaryLines(report.executive_summary)
  const comments = [
    ['SEPA', report.sepa_analysis?.comment],
    ['포지션', report.exposure_and_sizing?.comment],
    ['가치·공시', report.k_dart_and_valuation?.comment],
  ].filter((x): x is [string, string] => typeof x[1] === 'string' && x[1].trim() !== '')

  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface p-4 ring-1 ring-inset ring-brand-soft" aria-label="AI 리포트">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-ink">AI 리포트</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${classOf(VERDICT_CLASS, report.overall_verdict)}`}>
            {labelOf(VERDICT_LABEL, report.overall_verdict)}
            <span className="ml-1 text-xs font-normal opacity-75">{report.overall_verdict}</span>
          </span>
          {thesis?.signal && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classOf(SIGNAL_CLASS, thesis.signal)}`}>
              시그널 {labelOf(SIGNAL_LABEL, thesis.signal)}
            </span>
          )}
          {saved && <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-ink">저장된 리포트</span>}
        </div>
        <p className="text-xs text-ink-muted">
          {report.stock_name} {report.ticker} · 기준일 {report.as_of_date} · 모델 {report.model_name || '-'} · 갱신 {kstDateTime(report.updated_at ?? report.created_at)}
        </p>
        <p className="rounded-field bg-fill px-3 py-2 text-xs text-ink-muted">
          숫자는 파이썬 계산값, 문장은 AI 해석입니다. AI 입력은 정량 자료와 DART 공시뿐이며 네이버 뉴스는 쓰지 않습니다.
        </p>
      </header>

      {lines.length > 0 && (
        <Section title="3줄 요약" label="3줄 요약">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink">
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </Section>
      )}

      {lc && (
        <Section title="인과 사슬" label="인과 사슬">
          <ol className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
            {CHAIN.map((c, i) => {
              const node = lc[c.key]
              return (
                <li key={c.key} className="relative flex flex-col gap-1 rounded-field bg-fill p-3 text-sm">
                  <span className="text-xs text-ink-muted">{c.no} {c.label}{i < CHAIN.length - 1 ? ' →' : ''}</span>
                  <strong className="text-ink">{node?.title ?? '-'}</strong>
                  {node?.evidence && <span className="text-xs text-ink-muted">{node.evidence}</span>}
                </li>
              )
            })}
          </ol>
        </Section>
      )}

      {thesis && (
        <Section title="투자 가설" label="투자 가설">
          <p className="text-sm text-ink">{thesis.hypothesis}</p>
          {thesis.kill_switch?.length > 0 && (
            <div className="rounded-field bg-danger-soft px-3 py-2">
              <p className="text-xs font-bold text-danger">가설 기각 조건 (Kill Switch)</p>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-sm text-ink">
                {thesis.kill_switch.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            </div>
          )}
        </Section>
      )}

      {ev?.scenarios && (
        <Section title="3시나리오 기대값 (EV)" label="EV 시나리오"
          aside={`기준 종가 ${won(ev.base_close)}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-2 py-1.5 font-medium">시나리오</th>
                  <th className="px-2 py-1.5 font-medium">목표가</th>
                  <th className="px-2 py-1.5 font-medium">확률</th>
                  <th className="px-2 py-1.5 font-medium">수익률</th>
                  <th className="px-2 py-1.5 font-medium">신뢰도</th>
                  <th className="px-2 py-1.5 font-medium">근거(AI)</th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((k) => {
                  const s = ev.scenarios[k]
                  if (!s) return null
                  return (
                    <tr key={k} className="border-b border-line align-top">
                      <td className="px-2 py-1.5 text-ink">{SCENARIO_LABEL[k]}</td>
                      <td className="px-2 py-1.5 tabular-nums">{won(s.target_price)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{ratioPct(s.probability_pct, 0)}</td>
                      <td className={`px-2 py-1.5 tabular-nums ${signClass(s.expected_return_pct)}`}>{pct(s.expected_return_pct, 1)}</td>
                      <td className="px-2 py-1.5">{labelOf(CONFIDENCE_LABEL, s.confidence)}</td>
                      <td className="px-2 py-1.5 text-xs text-ink-muted">{s.rationale}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink">
            확률 가중 기대수익률 <strong className={signClass(ev.weighted_ev_pct)}>{pct(ev.weighted_ev_pct, 2)}</strong>
            <span className="text-xs text-ink-muted"> (파이썬 재계산 = Σ (목표가 ÷ 기준 종가 − 1) × 확률)</span>
          </p>
          {ev.normalized && (
            <p className="text-xs text-danger">AI 확률 합이 {ev.prob_sum_raw}%라 비율대로 100%로 맞췄습니다.</p>
          )}
        </Section>
      )}

      <Section title="DART 공시 촉매 랭킹" label="DART 촉매 랭킹">
        {report.dart_catalysts?.length ? (
          <ul className="flex flex-col">
            {report.dart_catalysts.map((c) => (
              <li key={c.rcept_no} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-ink">
                    <span className="mr-1 rounded bg-fill px-1.5 py-0.5 text-xs text-ink">{labelOf(IMPACT_LABEL, c.impact_grade)}</span>
                    {c.title}
                  </p>
                  <p className="text-xs text-ink-muted">
                    <span className="text-brand-strong" aria-label={`별점 ${c.stars}점`}>{stars(c.stars)}</span>
                    {' · '}감성 <span className={signClass(c.sentiment)}>{sentiment(c.sentiment)}</span>
                    {' · '}{isoDay(c.rcept_dt)}
                  </p>
                  {c.interpretation && <p className="text-xs text-ink-muted">{c.interpretation}</p>}
                </div>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-brand-strong hover:underline">DART 원문</a>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-muted">랭킹에 올릴 공시가 없습니다.</p>}
      </Section>

      {comments.length > 0 && (
        <Section title="항목별 해석" label="항목별 해석">
          <dl className="flex flex-col gap-1 text-sm">
            {comments.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-16 shrink-0 text-ink-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </section>
  )
}
