import type { ReactNode } from 'react'
import { formatAmount, formatNum, formatPct, pctClass } from '../../lib/marketFormat'
import type {
  VerifyCanslim,
  VerifyComputed,
  VerifyInvestor,
  VerifyLink,
  VerifyProfile,
} from '../../types/marketAdmin'

interface CardProps {
  title: string
  note?: string // 섹션 실패·없음 안내(서버 notes)
  hint?: string // 비교할 때 주의할 점(고정 문구)
  className?: string
  children: ReactNode
}

export function VerifyCard({ title, note, hint, className = '', children }: CardProps) {
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {hint && <p className="mt-1 break-keep text-xs text-slate-400">{hint}</p>}
      {note && <p className="mt-2 break-keep rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function Empty() {
  return <p className="text-sm text-slate-400">값이 없어요</p>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-keep text-right">{children}</dd>
    </div>
  )
}

export function ProfileCard({ data, note }: { data: VerifyProfile | null; note?: string }) {
  return (
    <VerifyCard title="기본 정보" note={note}>
      {data ? (
        <dl className="space-y-1.5 text-sm">
          <Row label="이름">{data.name}</Row>
          <Row label="시장">{data.market}</Row>
          <Row label="업종">{data.sector_code ? `${data.sector_name ?? '이름 없음'} (${data.sector_code})` : '—'}</Row>
          <Row label="상장주식수">{data.listed_shares_k == null ? '—' : `${formatNum(data.listed_shares_k)}천 주`}</Row>
          <Row label="상태">
            {[data.is_active ? '활성' : '비활성', data.is_halted ? '거래정지' : null].filter(Boolean).join(' · ')}
          </Row>
        </dl>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const CHANGES: { key: 'chg_1d' | 'chg_5d' | 'chg_20d'; label: string }[] = [
  { key: 'chg_1d', label: '1일 등락' },
  { key: 'chg_5d', label: '5일 등락' },
  { key: 'chg_20d', label: '20일 등락' },
]

export function ComputedCard({ data, note }: { data: VerifyComputed | null; note?: string }) {
  return (
    <VerifyCard title="계산값(market_stock_daily)" note={note} hint="거래대금은 종가×거래량 근사, 시총은 종가×상장주식수">
      {data ? (
        <dl className="space-y-1.5 text-sm">
          <Row label="종가">{formatNum(data.close)}</Row>
          {CHANGES.map((c) => (
            <Row key={c.key} label={c.label}>
              <span className={pctClass(data[c.key])}>{formatPct(data[c.key])}</span>
            </Row>
          ))}
          <Row label="거래대금">{formatAmount(data.value)}</Row>
          <Row label="시가총액">{formatAmount(data.mcap)}</Row>
        </dl>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const INVESTORS: { label: string; qty: keyof VerifyInvestor; amt: keyof VerifyInvestor }[] = [
  { label: '개인', qty: 'prsn_qty', amt: 'prsn_amt' },
  { label: '외국인', qty: 'frgn_qty', amt: 'frgn_amt' },
  { label: '기관', qty: 'orgn_qty', amt: 'orgn_amt' },
]

export function InvestorCard({ data, note }: { data: VerifyInvestor | null; note?: string }) {
  return (
    <VerifyCard
      title="투자자 순매수(investor_daily)"
      note={note}
      hint="금액은 KIS 원값 그대로(단위 변환 없음) — 수량으로 비교하세요"
    >
      {data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="whitespace-nowrap px-3 py-1 text-left font-medium">주체</th>
                <th className="whitespace-nowrap px-3 py-1 text-right font-medium">수량(주)</th>
                <th className="whitespace-nowrap px-3 py-1 text-right font-medium">금액(원값)</th>
              </tr>
            </thead>
            <tbody>
              {INVESTORS.map((r) => (
                <tr key={r.qty} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-1">{r.label}</td>
                  <td className={`whitespace-nowrap px-3 py-1 text-right ${pctClass(data[r.qty])}`}>
                    {formatNum(data[r.qty])}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 text-right">{formatNum(data[r.amt])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const LETTERS = ['c', 'a', 'n', 's', 'l', 'i', 'm'] as const

const markInfo = (v: number): { label: string; className: string } =>
  v === 1
    ? { label: '통과', className: 'bg-emerald-100 text-emerald-700' }
    : v === 0
      ? { label: '미달', className: 'bg-red-100 text-red-700' }
      : v === -1
        ? { label: '판단 불가', className: 'bg-slate-100 text-slate-500' }
        : { label: '준비 중', className: 'bg-slate-100 text-slate-400' }

export function CanslimCard({ data, note }: { data: VerifyCanslim | null; note?: string }) {
  return (
    <VerifyCard title="CANSLIM(canslim_daily)" note={note}>
      {data ? (
        <>
          <p className="text-sm">
            점수 <b className="text-lg">{data.score}</b> · 통과 {data.pass_count}/7 · 유동성{' '}
            {data.liquid ? '충족' : '미달'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LETTERS.map((k) => {
              const m = markInfo(data[k])
              return (
                <span key={k} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${m.className}`}>
                  {k.toUpperCase()} {m.label}
                </span>
              )
            })}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="c_growth · c_quarter">
              {`${formatNum(data.c_growth, 1)}% · ${data.c_quarter || '—'}${data.c_turnaround ? ' · 흑자 전환' : ''}`}
            </Row>
            <Row label="a_cagr · a_roe">{`${formatNum(data.a_cagr, 1)}% · ${formatNum(data.a_roe, 1)}%`}</Row>
            <Row label="n_pct_from_high · n_high_52w">
              {`${formatNum(data.n_pct_from_high, 1)}% · ${formatNum(data.n_high_52w)}`}
            </Row>
            <Row label="s_ud_ratio">{formatNum(data.s_ud_ratio, 2)}</Row>
            <Row label="l_rs (l_rs_raw)">{`${formatNum(data.l_rs)} (${formatNum(data.l_rs_raw, 3)})`}</Row>
            <Row label="업종 RS 순위">
              {data.sector_rs_rank == null ? '—' : `${data.sector_rs_rank} / ${formatNum(data.sector_rs_count)}`}
            </Row>
            <Row label="i_net_qty · i_buy_days">{`${formatNum(data.i_net_qty)} · ${formatNum(data.i_buy_days)}`}</Row>
            <Row label="m_dist_days">{formatNum(data.m_dist_days, 1)}</Row>
            <Row label="20일 평균 거래대금">{formatAmount(data.avg_value_20d)}</Row>
          </dl>
        </>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

export function LinksCard({ links }: { links: VerifyLink[] }) {
  return (
    <VerifyCard title="외부 사이트에서 비교" hint="새 탭에서 열려요">
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-indigo-600 hover:bg-slate-50"
            >
              {l.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </VerifyCard>
  )
}
