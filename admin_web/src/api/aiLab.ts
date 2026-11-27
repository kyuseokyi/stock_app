import { stockAdminClient as http } from './client'

// AI Lab(관리자 AI 종목 심층 분석) REST — backend/apps/ai_analyst/skills/router.py
// 설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md (A단계 정량 미리 보기, B단계 추론·저장, C단계 화면)
// 숫자는 모두 파이썬 계산값이고, AI 는 문장(해석)만 만든다.
const BASE = '/api/v1/admin/ai-skills'

/** quant-preview 서버 허용 범위(벗어나면 422) */
export const CAPITAL_MIN = 100_000
export const CAPITAL_MAX = 100_000_000_000
export const RISK_MIN = 0.1
export const RISK_MAX = 5.0

export interface SkillMeta {
  id: string
  name: string
  description: string
  source_repo: string
  license: string
  uses_facts: string[] | string
}

// ---------------------------------------------------------------- 정량 미리 보기(quant-preview)
export interface SepaCondition {
  no: number
  key: string
  label: string
  /** true 통과 · false 실패 · null 자료 부족 */
  pass: boolean | null
  values: Record<string, number | null>
}

export interface Sepa {
  evaluable: boolean
  reason: string | null
  bars: number
  conditions: SepaCondition[]
  pass_count: number
  evaluable_count: number
  all_pass: boolean
  stage: number | null
  /** 리포트(sepa_analysis)에만 — AI 해석 문장 */
  comment?: string
}

export interface Horizon {
  win_rate: number | null
  avg_return: number | null
}

export interface SetupStat {
  label: string
  count: number
  excluded_recent: number
  skipped_cooldown: number
  horizons: Record<string, Horizon>
  mfe_avg: number | null
  mae_avg: number | null
  last_signal_date: string | null
  signal_dates: string[]
}

export interface Backtest {
  bars: number
  cooldown: number
  setups: Record<string, SetupStat>
  today: string[]
}

export type Regime = 'BULL' | 'CHOPPY' | 'BEAR'

export interface MarketBreadth {
  count: number
  pct_above_ma20: number | null
  pct_above_ma50: number | null
  regime: Regime | null
  risk_range_pct: number[] | null
  market: string | null
  date: string
}

export interface StopSuggestion {
  close: number
  stop: number
  basis: string
  pct_stop: number
  low_10: number
  stop_distance_pct: number | null
}

export interface Position {
  capital: number
  risk_pct: number
  entry: number
  stop: number
  risk_amount: number
  shares: number
  amount: number
  weight_pct: number
  max_loss: number
  stop_distance_pct: number
  capped_by_capital: boolean
}

export interface DartDisclosure {
  title: string
  rcept_dt: string | null
  rcept_no: string | null
  url: string | null
  tag: 'positive' | 'negative' | null
  labels: string[]
  corrected: boolean
  cancelled: boolean
}

export interface DartFacts {
  available: boolean
  days: number
  items: DartDisclosure[]
  positive_count: number
  negative_count: number
  overhang: boolean
  fatal: boolean
}

export type Ratios = { per: number | null; pbr: number | null; roe: number | null }

export interface PeerValuation {
  target: Ratios
  median: Ratios
  gap_pct: Ratios
  sample: { per: number; pbr: number; roe: number }
  sector_m: string | null
}

export interface QuarterRow {
  stac_yymm: string
  op_growth: number | null
  sales_growth: number | null
  ni_growth: number | null
}

export interface EarningsTrend {
  quarters: QuarterRow[]
  op_growth_series: (number | null)[]
  accelerating: boolean | null
  decelerating: boolean | null
  latest: (QuarterRow & { debt_ratio: number | null }) | null
}

export interface AnnualFacts {
  stac_yymm: string | null
  eps: number | null
  bps: number | null
  roe: number | null
  sales_growth: number | null
  op_growth: number | null
  ni_growth: number | null
  debt_ratio: number | null
}

export interface SplitCut {
  date: string
  jump_pct: number | null
  dropped: number
}

export interface QuantPreview {
  ticker: string
  name: string | null
  market: string | null
  sector_m: string | null
  as_of: string
  close: number
  bars_used: number
  split_cut: SplitCut | null
  liquidity: { rs: number | null; avg_value_20d: number | null; canslim_date: string | null }
  sepa: Sepa
  backtest: Backtest
  market_breadth: MarketBreadth
  stop: StopSuggestion | null
  position: Position | null
  position_error: string | null
  dart: DartFacts
  peer_valuation: PeerValuation
  earnings_trend: EarningsTrend
  annual: AnnualFacts | null
}

// ---------------------------------------------------------------- 리포트(B단계 저장분)
export type Verdict = 'STRONG_SETUP' | 'WATCH_PULLBACK' | 'HOLD_WAIT' | 'AVOID_RISK'
export type Signal = 'STRENGTHEN' | 'MAINTAIN' | 'WEAKEN' | 'FALSIFY'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type ImpactGrade = 'regulation' | 'deal_funding' | 'tech' | 'earnings' | 'general'

export interface ChainNode {
  title: string
  evidence: string
}

export interface LogicChainAndThesis {
  logic_chain: { trigger: ChainNode; business: ChainNode; earnings_flow: ChainNode; price_momentum: ChainNode }
  thesis: { signal: Signal; hypothesis: string; kill_switch: string[] }
}

export interface Scenario {
  target_price: number
  probability_pct: number
  /** 파이썬이 (목표가 ÷ 기준 종가 − 1) 로 다시 계산한 값 */
  expected_return_pct: number
  rationale: string
  confidence: Confidence
}

export interface EvScenarios {
  base_close: number
  scenarios: { bull: Scenario; base: Scenario; bear: Scenario }
  weighted_ev_pct: number
  prob_sum_raw: number
  /** AI 확률 합이 100±1 밖이라 비율대로 100 으로 맞췄는지 */
  normalized: boolean
}

export interface DartCatalyst {
  rcept_no: string
  title: string
  rcept_dt: string | null
  url: string
  impact_grade: ImpactGrade
  stars: number
  sentiment: number
  interpretation: string
}

export interface AiReport {
  id: number
  ticker: string
  stock_name: string
  as_of_date: string
  quant_facts: QuantPreview
  sepa_analysis: Sepa & { stop?: StopSuggestion | null; split_cut?: SplitCut | null; comment?: string }
  vibe_backtest: Backtest
  exposure_and_sizing: { comment?: string } & Record<string, unknown>
  logic_chain_and_thesis: LogicChainAndThesis
  ev_scenarios: EvScenarios
  k_dart_and_valuation: { comment?: string } & Record<string, unknown>
  dart_catalysts: DartCatalyst[]
  overall_verdict: Verdict
  /** 3줄 요약 — 줄바꿈(\n)으로 이은 문자열 */
  executive_summary: string
  model_name: string
  created_at: string | null
  updated_at: string | null
  /** analyze 응답에만 — true 면 저장분(AI 미호출) */
  cached?: boolean
}

export interface ReportSummary {
  id: number
  ticker: string
  stock_name: string
  as_of_date: string
  overall_verdict: Verdict
  signal: Signal | null
  weighted_ev_pct: number | null
  headline: string
  model_name: string
  created_at: string | null
  updated_at: string | null
}

export interface ReportPage {
  items: ReportSummary[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface BatchAccepted {
  task_id: string
  source: 'surge' | 'leaders'
  limit: number
}

// ---------------------------------------------------------------- 호출
export const getCatalog = async (): Promise<SkillMeta[]> => (await http.get<SkillMeta[]>(`${BASE}/catalog`)).data

/** 정량 미리 보기 — AI 호출 없음(비용 0원) */
export const getQuantPreview = async (ticker: string, capital: number, riskPct: number): Promise<QuantPreview> =>
  (await http.get<QuantPreview>(`${BASE}/quant-preview/${encodeURIComponent(ticker)}`,
    { params: { capital, risk_pct: riskPct } })).data

/** AI 분석 — 같은 (종목, 기준일) 저장분이 있으면 AI 를 부르지 않고 돌려준다(cached). skills 를 빼면 전체 스킬. */
export const analyze = async (ticker: string, opts: { force?: boolean; skills?: string[] } = {}): Promise<AiReport> => {
  const params: Record<string, string | boolean> = {}
  if (opts.force) params.force = true
  if (opts.skills && opts.skills.length) params.skills = opts.skills.join(',')
  return (await http.post<AiReport>(`${BASE}/analyze/${encodeURIComponent(ticker)}`, null, { params })).data
}

export const listReports = async (page: number, pageSize: number, ticker?: string): Promise<ReportPage> =>
  (await http.get<ReportPage>(`${BASE}/reports`, {
    params: { page, page_size: pageSize, ...(ticker ? { ticker } : {}) },
  })).data

/** 저장된 리포트 한 건 — as_of 를 빼면 그 종목의 최신 */
export const getReport = async (ticker: string, asOf?: string): Promise<AiReport> =>
  (await http.get<AiReport>(`${BASE}/reports/${encodeURIComponent(ticker)}`,
    { params: asOf ? { as_of: asOf } : {} })).data

/** 일괄 분석(급등 Top / 주도주 Top) — 202 + task id, 이미 돌고 있으면 409 ALREADY_RUNNING */
export const batchTop = async (source: 'surge' | 'leaders', limit = 5): Promise<BatchAccepted> =>
  (await http.post<BatchAccepted>(`${BASE}/batch-top`, null, { params: { source, limit } })).data
