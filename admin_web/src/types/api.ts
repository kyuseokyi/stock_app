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
