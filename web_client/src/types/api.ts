// 백엔드 pydantic 응답 스키마와 1:1 대응하는 REST DTO 타입(web_client 사용분만).
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

// ---- SSE ----
/** blog SSE `notification` 이벤트 data(새 글). 출처: backend/apps/blog/routers/blogs.py publish_event */
export interface NewPostEvent {
  type: 'new_post'
  post_id: number
  board_id: number
  title: string
}
