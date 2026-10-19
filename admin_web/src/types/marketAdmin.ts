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

export interface JobsOverview {
  jobs: AdminJob[]
  history: JobRun[]
}
