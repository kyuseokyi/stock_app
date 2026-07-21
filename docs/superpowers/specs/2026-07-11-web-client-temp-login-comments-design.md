# web_client 임시 로그인 + 댓글 작성 설계

- 작성일: 2026-07-11
- 관련: `docs/prompts/05_user_web.md`, `docs/architecture_plan.md`

## 배경 / 목표
web_client는 블로그 조회만 가능하고 댓글은 읽기 전용이다.
일반 유저가 **댓글을 작성**할 수 있게 하되, 카카오/구글 앱키는 아직 없으므로
**임시 로그인(닉네임 입력)**으로 먼저 동작시키고, 이후 실제 OAuth로 스왑한다.

## 현재 구조(재사용)
- 댓글 작성 API `POST /api/v1/blogs/{id}/comments`는 이미 존재하며 **JWT 인증(get_current_user)** 필요, author 자동 연결.
- blog 서비스(8000)는 공유 `JWT_SECRET_KEY`로 auth(8001) 발급 토큰을 검증(MSA).
- User: `email`(unique, nullable), `nickname`, `provider/provider_id`(nullable), `role`(FREE/PREMIUM/ADMIN).

## 핵심 결정
- **임시 로그인 = 닉네임만 입력** (비밀번호·외부키 불필요).
- **DB 마이그레이션 없음**: 임시 유저는 `provider=null`, `email = {slug(nickname)}@guest.local` 로 upsert(같은 닉네임=같은 계정), `role=FREE`.
- 기존 인증형 댓글 엔드포인트 **그대로 재사용**.
- 카카오/구글은 이후 "upsert → 토큰 발급" 동일 경로로 교체(스왑 가능).

## 백엔드 (auth 8001)
- 신규 `POST /api/v1/auth/guest`
  - Request: `{ nickname: str }` (1~20자, 공백 트림)
  - 로직: `email = slug(nickname)@guest.local` 로 User 조회→없으면 생성(nickname, role=FREE, is_active=True) → `create_access_token(subject=user.id, role=...)` → `TokenResponse` 반환.
- 스키마 `GuestLoginRequest { nickname }` 추가. 응답은 기존 `TokenResponse` 재사용.

## 프론트 (web_client 3000)
- `store/auth.js` — zustand + localStorage 영속. `{ user, token, login(nickname), logout() }`
- `api/client.js` — 요청 인터셉터로 Bearer 자동 부착(조회 무해/작성 필수), 401 → 로그아웃+재로그인 유도
- `api/auth.js` — `guestLogin(nickname)`
- `api/blog.js` — `createComment(blogId, content)` 추가
- `components/LoginModal.jsx` — 닉네임 입력("닉네임으로 시작") *(임시)*
- `components/Layout.jsx` — 헤더에 로그인/로그아웃 + 닉네임
- `pages/PostDetailPage.jsx` — 댓글 폼
  - 로그인 + comments_enabled → 입력폼(작성 후 목록 갱신)
  - 미로그인 → "로그인하고 댓글 작성" 버튼(모달)
  - 댓글 비활성 게시판 → 기존 안내 유지

## 데이터 흐름
```
닉네임 입력 → auth:8001 /auth/guest → JWT+user 저장(localStorage)
→ 댓글 작성 POST blog:8000 /blogs/{id}/comments (Bearer)
→ 공유 secret 검증 → author=유저 → 목록 갱신
```

## 에러 처리
- 닉네임 빈값/길이 초과 → 프론트 검증
- 401(토큰 만료/무효) → 로그아웃 후 재로그인 유도
- 403(댓글 비활성) → 안내 문구

## 비범위 (이후)
- 실제 카카오/구글 OAuth (앱키 준비 후, 동일 토큰 경로로 교체)
- 좋아요, 프로필, 관심종목, 댓글 수정/삭제 UI(백엔드는 이미 존재)
