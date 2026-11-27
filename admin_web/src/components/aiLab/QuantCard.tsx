import type { Backtest, DartFacts, EarningsTrend, MarketBreadth, PeerValuation, Position, QuantPreview, Sepa, StopSuggestion } from '../../api/aiLab'
import {
  REGIME_CLASS, REGIME_LABEL, classOf, eok, isoDay, labelOf, passClass, passLabel, pct, ratioPct, signClass,
  splitCutMessage, times, won,
} from '../../lib/aiLab'
import Section from './Section'

// 정량 카드 — quant-preview(또는 저장 리포트의 quant_facts) 숫자를 그대로 보여 준다. 전부 파이썬 계산값(AI 없음).

const th = 'px-2 py-1.5 text-left text-xs font-medium text-ink-muted'
const td = 'px-2 py-1.5 tabular-nums'

const VALUE_LABEL: Record<string, string> = {
  close: '종가', ma50: '50일선', ma150: '150일선', ma200: '200일선', ma200_20ago: '20봉 전 200일선',
  low_52w: '52주 최저', high_52w: '52주 최고', ratio: '최저 대비', pct_from_high: '최고 대비', rs: 'RS',
}

function conditionValues(values: Record<string, number | null>): string {
  return Object.entries(values)
    .map(([k, v]) => {
      const name = VALUE_LABEL[k] ?? k
      if (v == null) return `${name} -`
      if (k === 'ratio') return `${name} ${times(v, 2)}`
      if (k === 'pct_from_high') return `${name} ${pct(v, 1)}`
      if (k === 'rs') return `${name} ${v.toFixed(0)}`
      return `${name} ${Math.round(v).toLocaleString('ko-KR')}`
    })
    .join(' · ')
}

function SepaTable({ sepa }: { sepa: Sepa }) {
  return (
    <Section title="SEPA 추세 템플릿 8조건" label="SEPA 8조건"
      aside={sepa.evaluable ? `${sepa.pass_count} / 8 통과 · 단계 ${sepa.stage ?? '-'}` : undefined}>
      {!sepa.evaluable ? (
        <p className="rounded-field bg-fill px-3 py-2 text-sm text-ink-muted">{sepa.reason ?? '판정할 수 없습니다.'}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sepa.conditions.map((c) => (
            <li key={c.no} className="flex items-start justify-between gap-3 py-1.5 text-sm">
              <div className="min-w-0">
                <p className="text-ink">{c.no}. {c.label}</p>
                <p className="text-xs text-ink-muted">{conditionValues(c.values)}</p>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${passClass(c.pass)}`}>{passLabel(c.pass)}</span>
            </li>
          ))}
        </ul>
      )}
      {sepa.evaluable && (
        <p className="text-xs text-ink-muted">
          단계: 1 = 바닥 다지기 · 2 = 상승 추세 · 3 = 고점 다지기 · 4 = 하락 추세(150·200일선 위치로 단순 판정).
        </p>
      )}
    </Section>
  )
}

function BacktestTable({ bt }: { bt: Backtest }) {
  const keys = Object.keys(bt.setups)
  const horizons = ['d3', 'd5', 'd10', 'd20']
  return (
    <Section title="셋업 백테스트 (신호일 종가 진입)" label="셋업 백테스트" aside={`${bt.bars.toLocaleString('ko-KR')}봉`}>
      {bt.today.length > 0 ? (
        <p className="rounded-field bg-brand-soft px-3 py-2 text-sm text-brand-strong">
          오늘 해당 셋업: {bt.today.map((k) => `${k} ${bt.setups[k]?.label ?? ''}`).join(', ')}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">오늘 해당하는 셋업이 없습니다.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>셋업</th>
              <th className={th}>발생</th>
              {horizons.map((h) => <th key={h} className={th}>D+{h.slice(1)} 승률·평균</th>)}
              <th className={th}>MFE · MAE</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const s = bt.setups[k]
              return (
                <tr key={k} className={`border-b border-line ${bt.today.includes(k) ? 'bg-brand-soft/50' : ''}`}>
                  <td className="px-2 py-1.5">
                    <span className="font-bold text-ink">{k}</span>
                    <span className="block text-xs text-ink-muted">{s.label}</span>
                  </td>
                  <td className={td}>{s.count}회</td>
                  {horizons.map((h) => {
                    const v = s.horizons[h]
                    return (
                      <td key={h} className={td}>
                        {v?.win_rate == null ? '-' : ratioPct(v.win_rate, 0)}
                        <span className={`block text-xs ${signClass(v?.avg_return)}`}>{pct(v?.avg_return, 1)}</span>
                      </td>
                    )
                  })}
                  <td className={td}>
                    <span className={signClass(s.mfe_avg)}>{pct(s.mfe_avg, 1)}</span>
                    <span className={`block text-xs ${signClass(s.mae_avg)}`}>{pct(s.mae_avg, 1)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        승률 = 수익률 0 초과 비율. MFE·MAE = D+1~D+20 최고가·최저가 기준 평균. 같은 셋업이 직전 집계 신호 뒤 {bt.cooldown}봉 안에
        다시 나오면 겹침을 막으려고 집계에서 뺍니다(쿨다운 {bt.cooldown}봉). D+20 봉이 아직 없는 최근 신호도 뺍니다.
      </p>
    </Section>
  )
}

function Exposure({ breadth, stop, position, positionError }: {
  breadth: MarketBreadth; stop: StopSuggestion | null; position: Position | null; positionError: string | null
}) {
  return (
    <Section title="시장 폭 · 손절 · 포지션 크기" label="시장 폭과 포지션 크기">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">시장 폭{breadth.market ? `(${breadth.market})` : ''}</span>
        {breadth.regime ? (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${classOf(REGIME_CLASS, breadth.regime)}`}>
            {labelOf(REGIME_LABEL, breadth.regime)}
          </span>
        ) : <span className="text-ink-muted">자료 없음</span>}
        {breadth.count > 0 && (
          <span className="text-ink">
            20일선 위 {ratioPct(breadth.pct_above_ma20)} · 50일선 위 {ratioPct(breadth.pct_above_ma50)}
            <span className="text-ink-muted"> ({breadth.count.toLocaleString('ko-KR')}종목)</span>
          </span>
        )}
      </div>
      {breadth.risk_range_pct && (
        <p className="text-sm text-ink">
          권장 리스크 {breadth.risk_range_pct[0]}~{breadth.risk_range_pct[1]}% <span className="text-ink-muted">(1회 매매에서 잃어도 되는 자본 비율)</span>
        </p>
      )}
      {stop ? (
        <p className="text-sm text-ink">
          손절가 제안 <strong>{won(stop.stop)}</strong>
          <span className={signClass(stop.stop_distance_pct)}> ({pct(stop.stop_distance_pct, 1)})</span>
          <span className="text-ink-muted"> · 근거: {stop.basis}</span>
        </p>
      ) : <p className="text-sm text-ink-muted">손절가를 계산할 수 없습니다.</p>}
      {position ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {([
            ['자본', won(position.capital)],
            ['리스크', `${position.risk_pct}% (${won(position.risk_amount)})`],
            ['진입가(종가)', won(position.entry)],
            ['권장 주식 수', `${position.shares.toLocaleString('ko-KR')}주`],
            ['투입 금액', `${won(position.amount)} (${ratioPct(position.weight_pct)})`],
            ['손절 시 최대 손실', won(position.max_loss)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line py-1">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="text-right tabular-nums text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">포지션 크기를 계산할 수 없습니다{positionError ? ` — ${positionError}` : ''}.</p>
      )}
      {position?.capped_by_capital && (
        <p className="rounded-field bg-danger-soft px-3 py-2 text-xs text-danger">
          리스크 기준 주식 수가 자본으로 살 수 있는 양을 넘어, 자본 한도까지로 줄였습니다(자본 한도 적용).
        </p>
      )}
    </Section>
  )
}

function DartList({ dart }: { dart: DartFacts }) {
  return (
    <Section title={`DART 공시 분류 (최근 ${dart.days}일)`} label="DART 공시 분류"
      aside={dart.available ? `호재 ${dart.positive_count} · 악재 ${dart.negative_count}` : undefined}>
      {!dart.available && <p className="text-sm text-ink-muted">DART 키가 없거나 불러오지 못해 공시를 넣지 못했습니다.</p>}
      {dart.available && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-medium ${dart.overhang ? 'bg-danger-soft text-danger' : 'bg-fill text-ink-muted'}`}>
            오버행 {dart.overhang ? '있음(증자·CB·BW·EB 등)' : '없음'}
          </span>
          {dart.fatal && <span className="rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger">감사의견·관리종목 경고</span>}
        </div>
      )}
      {dart.available && dart.items.length === 0 && <p className="text-sm text-ink-muted">공시가 없습니다.</p>}
      {dart.items.length > 0 && (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {dart.items.map((d, i) => (
            <li key={d.rcept_no ?? i} className="flex items-start justify-between gap-3 border-b border-line py-1.5 text-sm">
              <div className="min-w-0">
                <p className="text-ink">
                  {d.tag === 'positive' && <span className="mr-1 rounded bg-up-soft px-1.5 py-0.5 text-xs text-up">호재</span>}
                  {d.tag === 'negative' && <span className="mr-1 rounded bg-down-soft px-1.5 py-0.5 text-xs text-down">악재</span>}
                  {d.title}
                </p>
                <p className="text-xs text-ink-muted">
                  {isoDay(d.rcept_dt)}{d.labels.length ? ` · ${d.labels.join(', ')}` : ''}{d.corrected ? ' · 정정' : ''}
                </p>
              </div>
              {d.url && (
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-brand-strong hover:underline">원문 보기</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Peers({ pv }: { pv: PeerValuation }) {
  const rows: { key: 'per' | 'pbr' | 'roe'; label: string; fmt: (v: number | null) => string }[] = [
    { key: 'per', label: 'PER', fmt: (v) => times(v) },
    { key: 'pbr', label: 'PBR', fmt: (v) => times(v, 2) },
    { key: 'roe', label: 'ROE', fmt: (v) => ratioPct(v) },
  ]
  return (
    <Section title={`업종 비교${pv.sector_m ? ` (${pv.sector_m})` : ''}`} label="업종 비교">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>지표</th><th className={th}>이 종목</th><th className={th}>업종 중앙값</th>
            <th className={th}>괴리율</th><th className={th}>표본</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line">
              <td className="px-2 py-1.5 text-ink">{r.label}</td>
              <td className={td}>{r.fmt(pv.target[r.key])}</td>
              <td className={td}>{r.fmt(pv.median[r.key])}</td>
              <td className={td}>{pct(pv.gap_pct[r.key], 1)}</td>
              <td className={td}>{pv.sample[r.key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted">PER = 종가 ÷ 연간 EPS, PBR = 종가 ÷ BPS(EPS·BPS 0 이하 종목은 표본에서 제외).</p>
    </Section>
  )
}

function Earnings({ et }: { et: EarningsTrend }) {
  return (
    <Section title="분기 실적 추세 (최근 4분기, 전년 같은 분기 대비)" label="분기 실적 추세"
      aside={et.accelerating ? '영업이익 증가율 가속' : et.decelerating ? '영업이익 증가율 감속' : undefined}>
      {et.quarters.length === 0 ? <p className="text-sm text-ink-muted">분기 실적 자료가 없습니다.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>분기</th><th className={th}>매출</th><th className={th}>영업이익</th><th className={th}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {et.quarters.map((q) => (
              <tr key={q.stac_yymm} className="border-b border-line">
                <td className="px-2 py-1.5 text-ink">{q.stac_yymm.slice(0, 4)}.{q.stac_yymm.slice(4, 6)}</td>
                <td className={`${td} ${signClass(q.sales_growth)}`}>{pct(q.sales_growth, 1)}</td>
                <td className={`${td} ${signClass(q.op_growth)}`}>{pct(q.op_growth, 1)}</td>
                <td className={`${td} ${signClass(q.ni_growth)}`}>{pct(q.ni_growth, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {et.latest?.debt_ratio != null && <p className="text-xs text-ink-muted">최근 분기 부채비율 {ratioPct(et.latest.debt_ratio)}</p>}
    </Section>
  )
}

export default function QuantCard({ q }: { q: QuantPreview }) {
  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface p-4" aria-label="정량 분석">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">
            {q.name ?? q.ticker} <span className="text-sm font-normal text-ink-muted">{q.ticker}{q.market ? ` · ${q.market}` : ''}</span>
          </h2>
          <span className="rounded-full bg-fill px-2 py-0.5 text-xs text-ink-muted">정량 · 파이썬 계산</span>
        </div>
        <p className="text-sm text-ink-muted">
          기준일 {q.as_of} · 종가 {won(q.close)} · 업종 {q.sector_m ?? '-'} · RS {q.liquidity.rs ?? '-'} · 20일 평균 거래대금 {eok(q.liquidity.avg_value_20d)}
        </p>
      </header>
      {q.split_cut && (
        <p role="note" className="rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">⚠️ {splitCutMessage(q.split_cut)}</p>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <SepaTable sepa={q.sepa} />
        <Exposure breadth={q.market_breadth} stop={q.stop} position={q.position} positionError={q.position_error} />
      </div>
      <BacktestTable bt={q.backtest} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Peers pv={q.peer_valuation} />
        <Earnings et={q.earnings_trend} />
      </div>
      <DartList dart={q.dart} />
    </section>
  )
}
