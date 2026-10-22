// 관리자 시장 데이터 응답 타입 — backend/apps/stock_api/routers/{themes_admin,market_admin}.py

export interface AdminTheme {
  id: number
  kis_code: string | null
  name: string
  source: 'kis' | 'admin'
  is_hidden: boolean
  description: string | null
  stock_count: number
}

export interface ThemeMetric {
  rank: number
  chg_1d: number | null // %
  value: number // 거래대금(원)
  members: number
  leader_ticker: string
  leader_name: string | null
}

export interface ThemeMetrics {
  as_of: string | null
  themes: Record<string, ThemeMetric> // 키: 테마 id 문자열
}

export interface ThemeStockRow {
  ticker: string
  source: 'kis' | 'admin'
  is_excluded: boolean
  reason: string | null
  name: string | null
  chg_1d: number | null
  value: number | null
}

export type DatasetStatus = 'ok' | 'stale' | 'warn' | 'empty' | 'off' | 'error'

export interface DatasetItem {
  code: string
  name?: string
  latest: string | null
  status: DatasetStatus
}

export interface Dataset {
  key: string
  label: string
  latest: string | null
  count: number | null
  unit: string
  status: DatasetStatus
  note: string
  items?: DatasetItem[]
}

export interface PipelineStep {
  name: string
  ok: boolean
  seconds: number
  summary: string
}

export interface PipelineRecord {
  started_at: string
  finished_at: string
  steps: PipelineStep[]
}

export interface MarketStatusReport {
  ref_date: string | null
  generated_at: string
  datasets: Dataset[]
  settings: { fred_key: boolean; q_cumulative: 'true' | 'false' | 'unset' }
  pipeline: PipelineRecord | null
}

export type JobStatus = 'idle' | 'queued' | 'running'

export interface AdminJob {
  key: string
  label: string
  description: string
  eta: string
  status: JobStatus
  task_id: string | null
  requested_at: string | null
  confirm: string | null // 실행 전 확인 창 문구(없으면 기본 문구)
  window_block: [string, string] | null // KST "HH:MM" [시작, 끝) 실행 불가
  uses_kis: boolean
}

export interface JobRun {
  job: string
  label: string
  task_id: string
  actor: string | null
  requested_at: string | null
  state: string // Celery 상태 | UNKNOWN(결과 만료)
  result_summary: string | null
}

export type BootstrapStepState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface BootstrapStep {
  key: string
  label: string
  state: BootstrapStepState
  seconds: number | null
  summary: string | null
  reason: string | null
}

// 초기 데이터 준비 진행 상황 — backend/apps/collector/tasks/bootstrap.py (Redis admin:bootstrap:progress)
export interface BootstrapProgress {
  task_id: string | null
  started_at: string
  finished_at: string | null
  months: number
  end_date: string | null
  skipped: string | null
  steps: BootstrapStep[]
}

export interface JobsOverview {
  jobs: AdminJob[]
  history: JobRun[]
  bootstrap: BootstrapProgress | null
}

// 데이터 검증 GET /api/v1/admin/market/verify — backend/apps/stock_api/services/verify_ticker.py
export interface VerifyProfile {
  name: string
  market: string
  is_active: boolean
  sector_code: string | null
  sector_name: string | null
  listed_shares_k: number | null // 천 주
  is_halted: boolean | null
}

export interface VerifyBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface VerifyComputed {
  close: number | null
  chg_1d: number | null // %
  chg_5d: number | null
  chg_20d: number | null
  value: number | null // 거래대금(원, 종가×거래량 근사)
  mcap: number | null // 원
  sector_m: string
}

export interface VerifyInvestor {
  prsn_qty: number | null
  frgn_qty: number | null
  orgn_qty: number | null
  prsn_amt: number | null // KIS 원값(단위 변환 없음)
  frgn_amt: number | null
  orgn_amt: number | null
}

export interface VerifyFundamentalRow {
  stac_yymm: string
  eps: number | null
  bps: number | null
  sps: number | null
  roe: number | null
  sales_growth: number | null
  op_growth: number | null
  ni_growth: number | null
  debt_ratio: number | null
}

export interface VerifyFundamentals {
  quarterly: VerifyFundamentalRow[] // 최신이 앞
  annual: VerifyFundamentalRow[]
}

// c~m: 1 통과 · 0 미달 · -1 판단 불가 · -2 준비 중 (backend/apps/collector/canslim/rules.py)
export interface VerifyCanslim {
  score: number
  pass_count: number
  liquid: number
  c: number
  a: number
  n: number
  s: number
  l: number
  i: number
  m: number
  c_growth: number | null
  c_quarter: string
  c_turnaround: number
  a_cagr: number | null
  a_roe: number | null
  n_pct_from_high: number | null
  n_high_52w: number | null
  s_ud_ratio: number | null
  l_rs: number | null
  l_rs_raw: number | null
  sector_rs_rank: number | null
  sector_rs_count: number | null
  i_net_qty: number | null
  i_buy_days: number | null
  m_dist_days: number | null
  avg_value_20d: number | null
}

export interface VerifyMembership {
  kind: 'theme' | 'sector'
  group_id: string
  name: string
  rank: number | null // 0 = 순위 제외(3종목 미만), null = 그날 계산 행 없음
  chg_1d: number | null
  members: number | null
}

export interface VerifyLink {
  label: string
  url: string
}

export type VerifySection =
  | 'date'
  | 'profile'
  | 'bars'
  | 'computed'
  | 'investor'
  | 'fundamentals'
  | 'canslim'
  | 'memberships'

export interface VerifyReport {
  ticker: string
  date: string | null // 결정된 기준일
  requested_date: string | null
  profile: VerifyProfile | null
  bars: VerifyBar[] | null // 최신이 앞
  computed: VerifyComputed | null
  investor: VerifyInvestor | null
  fundamentals: VerifyFundamentals | null
  canslim: VerifyCanslim | null
  memberships: VerifyMembership[] | null
  links: VerifyLink[]
  notes: Partial<Record<VerifySection, string>> // 섹션별 실패·없음 안내
}
