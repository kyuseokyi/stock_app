// 백엔드 pydantic 스키마와 1:1 대응하는 REST DTO 타입.
// 출처: backend/apps/auth/schemas.py, backend/apps/blog/schemas.py (datetime → ISO 문자열)

/** 경로 파라미터(useParams 문자열)와 숫자 id 를 모두 받는 식별자 */
export type Id = number | string

export type UserRole = 'FREE' | 'PREMIUM' | 'ADMIN'

// ---- auth ----
export interface UserOut {
  id: number
  email: string | null
  nickname: string | null
  role: UserRole
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: UserOut
}

// ---- board ----
export interface BoardOut {
  id: number
  name: string
  order_index: number
  is_active: boolean
  comments_enabled: boolean
  min_role_required: UserRole
  created_at: string
  updated_at: string
}

export interface BoardCreate {
  name: string
  order_index?: number
  is_active?: boolean
  comments_enabled?: boolean
  min_role_required?: UserRole
}

export interface BoardUpdate {
  name?: string | null
  order_index?: number | null
  is_active?: boolean | null
  comments_enabled?: boolean | null
  min_role_required?: UserRole | null
}

// ---- blog ----
export interface BlogOut {
  id: number
  board_id: number
  title: string
  content: string
  thumbnail_url: string | null
  author_id: number | null
  view_count: number
  featured_at: string | null
  created_at: string
  updated_at: string
}

export interface BlogCreate {
  board_id: number
  title: string
  content: string
  thumbnail_url?: string | null
  author_id?: number | null
}

export interface BlogUpdate {
  board_id?: number | null
  title?: string | null
  content?: string | null
  thumbnail_url?: string | null
  featured?: boolean | null
}

export interface BlogListOut {
  total: number
  page: number
  size: number
  items: BlogOut[]
}

// ---- comment ----
export interface CommentOut {
  id: number
  post_id: number
  author_id: number | null
  author_name: string | null
  content: string
  created_at: string
  updated_at: string
}

// ── 펀드 리포트 알림(blog /api/v1/admin) ──
export type PushSendMode = 'now' | 'test' | 'scheduled'
export type PushSendStatus = 'scheduled' | 'sending' | 'done' | 'failed' | 'cancelled'

export interface PushSendOut {
  id: number
  kind: string
  mode: PushSendMode
  ref_date: string
  title: string
  body: string
  status: PushSendStatus
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  target_count: number
  success_count: number
  failure_count: number
  template_id: number | null
  created_by: number | null
  created_by_nickname: string | null
  created_at: string
}

export interface PushSendListOut {
  items: PushSendOut[]
  total: number
}

export interface FundNoticePreviewOut {
  target_count: number
  my_device_count: number
  already_sent: boolean
  last_send: PushSendOut | null
}

export interface FundNoticeCreate {
  date: string
  title: string
  body: string
  mode: PushSendMode
  scheduled_at?: string
  template_id?: number | null
  force?: boolean
}

export interface PushTemplateOut {
  id: number
  title: string
  body: string
  last_sent_at: string | null
  created_at: string
  updated_at: string
}

export interface PushTemplateIn {
  title: string
  body: string
}
