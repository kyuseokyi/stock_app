import { formatNum, formatPct, pctClass } from '../../lib/marketFormat'
import type {
  VerifyBar,
  VerifyFundamentalRow,
  VerifyFundamentals,
  VerifyMembership,
} from '../../types/marketAdmin'
import { Empty, VerifyCard } from './VerifyCards'

const TH = 'whitespace-nowrap px-3 py-1 text-right font-medium'
const TH_LEFT = 'whitespace-nowrap px-3 py-1 text-left font-medium'
const TD = 'whitespace-nowrap px-3 py-1 text-right'
const TD_LEFT = 'whitespace-nowrap px-3 py-1'
const BAR_HINT =
  '우리 일봉은 KRX+넥스트레이드 통합 시세 — 시가·거래량은 KRX 단독 사이트와 다를 수 있음(고가≥, 저가≤, 거래량≥ 가 정상)'
const GROUP_HINT = '테마·업종 등락은 구성 종목 단순 평균 — 사이트별 정의가 달라 흐름만 비교'
const FUND_HINT = '분기 EPS 는 원값 그대로 — 분기마다 계속 커지면 누적(연초부터), 들쭉날쭉하면 단독 분기로 보세요'

interface TableCardProps<T> {
  rows: T | null
  note?: string
  className?: string
}

export function BarsCard({ rows, note, className }: TableCardProps<VerifyBar[]>) {
  return (
    <VerifyCard title="일봉(daily_prices, 최근 5행)" note={note} hint={BAR_HINT} className={className}>
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>날짜</th>
                {['시가', '고가', '저가', '종가', '거래량'].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.date} className="border-t border-slate-100">
                  <td className={TD_LEFT}>{b.date}</td>
                  <td className={TD}>{formatNum(b.open)}</td>
                  <td className={TD}>{formatNum(b.high)}</td>
                  <td className={TD}>{formatNum(b.low)}</td>
                  <td className={TD}>{formatNum(b.close)}</td>
                  <td className={TD}>{formatNum(b.volume)}</td>
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

type FundKey = Exclude<keyof VerifyFundamentalRow, 'stac_yymm'>

const FUND_COLS: { key: FundKey; label: string; digits: number }[] = [
  { key: 'eps', label: 'EPS', digits: 0 },
  { key: 'bps', label: 'BPS', digits: 0 },
  { key: 'sps', label: 'SPS', digits: 0 },
  { key: 'roe', label: 'ROE %', digits: 2 },
  { key: 'sales_growth', label: '매출 증가 %', digits: 2 },
  { key: 'op_growth', label: '영업이익 증가 %', digits: 2 },
  { key: 'ni_growth', label: '순이익 증가 %', digits: 2 },
  { key: 'debt_ratio', label: '부채비율 %', digits: 2 },
]

function FundTable({ title, rows }: { title: string; rows: VerifyFundamentalRow[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-slate-600">{title}</p>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>결산</th>
                {FUND_COLS.map((c) => (
                  <th key={c.key} className={TH}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stac_yymm} className="border-t border-slate-100">
                  <td className={TD_LEFT}>{r.stac_yymm}</td>
                  {FUND_COLS.map((c) => (
                    <td key={c.key} className={TD}>
                      {formatNum(r[c.key], c.digits)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function FundamentalsCard({ rows, note, className }: TableCardProps<VerifyFundamentals>) {
  return (
    <VerifyCard title="재무(fundamentals_periodic)" note={note} hint={FUND_HINT} className={className}>
      {rows ? (
        <div className="space-y-4">
          <FundTable title="분기(최근 8개)" rows={rows.quarterly} />
          <FundTable title="연간(최근 5개)" rows={rows.annual} />
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const rankText = (rank: number | null): string =>
  rank == null ? '—' : rank === 0 ? '제외(3종목 미만)' : `${rank}위`

export function MembershipsCard({ rows, note, className }: TableCardProps<VerifyMembership[]>) {
  return (
    <VerifyCard
      title="소속 그룹(market_group_daily)"
      note={note}
      hint={`${GROUP_HINT}. '—' 는 그날 계산 행이 없다는 뜻이에요.`}
      className={className}
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>종류</th>
                <th className={TH_LEFT}>이름</th>
                <th className={TH}>순위</th>
                <th className={TH}>1일 등락</th>
                <th className={TH}>구성 수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.kind}:${m.group_id}`} className="border-t border-slate-100">
                  <td className={TD_LEFT}>{m.kind === 'sector' ? '업종' : '테마'}</td>
                  <td className="min-w-[8rem] break-keep px-3 py-1">
                    {m.name} <span className="text-xs text-slate-400">{m.group_id}</span>
                  </td>
                  <td className={TD}>{rankText(m.rank)}</td>
                  <td className={`${TD} ${pctClass(m.chg_1d)}`}>{formatPct(m.chg_1d)}</td>
                  <td className={TD}>{formatNum(m.members)}</td>
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
