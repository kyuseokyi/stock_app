# web_client 토스 디자인 + 게임 대응 설계

- **작성일**: 2026-10-11
- **대상**: `web_client/` (React + Vite + TailwindCSS + react-router-dom + zustand + axios)
- **디자인 언어**: [`docs/mobile_design_language.md`](../../mobile_design_language.md) (토스 라이트 스타일 — 웹에도 동일 토큰 적용)
- **선행 참고**: 모바일 토대 완료([`2026-10-08-mobile-screen-architecture-design.md`](./2026-10-08-mobile-screen-architecture-design.md)), 트레이딩 게임([`docs/trading_game_plan.md`](../../trading_game_plan.md), [`docs/prompts/trading_game/06_phase6_frontend_ui.md`](../../prompts/trading_game/06_phase6_frontend_ui.md))

---

## 1. 배경 & 목표

`web_client`는 현재 **커뮤니티/블로그 리더**다: 상단 헤더(로고 + 로그인 모달) + 게시판 pill 탭 + 라우트(`/` → 첫 게시판 리다이렉트, `/boards/:id`, `/posts/:id`), SSE 알림 토스터, 닉네임 로그인 모달. Tailwind `theme.extend`는 비어 있어 기본 indigo/slate 팔레트를 쓴다. 홈 피드·프로필 페이지·게임은 없다.

모바일에 이미 적용한 **토스 디자인 언어**를 웹에도 통일하고, 신규 플래그십 **트레이딩 게임**의 진입점을 웹 네비에 마련한다.

**이 문서의 범위**: 웹의 디자인 토큰(Tailwind) 교체, 공통 UI 컴포넌트, 2단 네비(커뮤니티·게임) 도입, 게임 스켈레톤 페이지, 기존 커뮤니티 화면·로그인 모달의 토스화. **게임 실시간/주문/랭킹·간편로그인(소셜)은 범위 밖**(백엔드 Phase 1~5 / `/auth/social` 선행). 웹 홈 피드·프로필 페이지 신규 구현도 범위 밖.

**성공 기준**
1. Tailwind 테마가 토스 토큰으로 교체되고, 기존 화면이 토스 톤으로 보인다(indigo→토스 블루).
2. 헤더가 2단 네비(커뮤니티/게임)로 바뀌고 `/game` 라우트가 추가된다.
3. 게임 섹션이 "시즌 준비 중" 스켈레톤으로 열린다.
4. 공통 UI 컴포넌트가 커뮤니티·게임·로그인에서 재사용된다.
5. `npm run build`가 성공한다(웹 검증 수단).

---

## 2. 결정 사항 (brainstorming 확정)

| # | 결정 | 선택 |
| :-- | :-- | :-- |
| W1 | 범위 | **토스 리디자인 + 게임 "스켈레톤" 페이지** (게임 로직·실시간은 백엔드 후) |
| W2 | 웹 네비게이션 | **2단 네비** — 1차: 커뮤니티 · 게임 / 커뮤니티일 때만 게시판 탭. 새 홈·프로필 페이지 만들지 않음 |
| W3 | 디자인 | **토스 라이트 스타일** — `docs/mobile_design_language.md`의 토큰을 Tailwind로 이식 |
| W4 | 로그인 | 기존 **닉네임 로그인 모달 유지**(토스 스타일로만). 간편로그인(소셜)은 범위 밖 |

### 열린 결정(기본값으로 진행)
- **OW1 다크모드**: **라이트 고정**(웹 현행도 라이트, 토스 라이트퍼스트). Tailwind dark variant 미사용.
- **OW2 게임 비로그인 진입**: 스켈레톤은 누구나 열람 가능. 로그인 게이팅은 백엔드 후 후속.

---

## 3. Tailwind 토스 테마 (토큰)

`web_client/tailwind.config.js`의 `theme.extend`에 추가(모바일 `unistyles.ts`와 값 일치):
```js
theme: {
  extend: {
    colors: {
      brand: { DEFAULT: '#3182f6', soft: '#e8f1fe' }, // 토스 블루 / 연한 포인트
      up: '#f04452',   // 상승·수익 = 빨강 (국내 관례)
      down: '#3182f6', // 하락·손실 = 파랑
      ink: { DEFAULT: '#191f28', muted: '#8b95a1' }, // 본문 / 보조
      surface: '#f2f4f6',
      line: '#e5e8eb', // border
    },
    borderRadius: { card: '20px', btn: '14px', field: '12px' }, // chip은 rounded-full
  },
}
```
- `index.css`의 `body`를 `bg-white text-ink`로(현 `bg-slate-50 text-slate-800`에서 토스 배경). `.post-content` 링크색 indigo→`text-brand`, 기타 slate→ink/muted 매핑.
- 코드 전반의 `indigo-600`/`slate-*` 사용을 토스 토큰 유틸(`bg-brand`, `text-ink`, `text-ink-muted`, `border-line`, `bg-surface`)로 치환.

---

## 4. 공통 UI 컴포넌트 (`web_client/src/components/ui/`)

Tailwind 클래스를 캡슐화한 작은 프레젠테이션 컴포넌트(모바일 `src/ui`와 역할 대응):
- **`Button.jsx`**: `variant` `primary`(bg-brand text-white) | `secondary`(bg-surface text-ink), `rounded-btn`, 높이 ~44–48, `disabled`/`loading`. 풀폭 옵션.
- **`Card.jsx`**: `bg-surface rounded-card p-4`, children.
- **`Chip.jsx`**: `rounded-full`, 선택 시 `bg-brand-soft text-brand`, 미선택 `bg-surface text-ink-muted`. (게시판 탭·향후 게임 칩 공용) — 주의: `colors.brand={DEFAULT,soft}`이므로 유틸은 `bg-brand-soft`(슬래시 `/`는 불투명도 문법이라 쓰지 않음).
- **`EmptyState.jsx`**: 큰 이모지 + 제목 + 안내문(+선택적 액션 버튼). 게임 스켈레톤·빈 목록에 사용.

> 범위 최소화(YAGNI): 위 4개만. 게임 주문패널/랭킹 등 게임 전용 컴포넌트는 백엔드 후 Phase 6에서.

---

## 5. 2단 네비게이션 (`src/components/Layout.jsx` 개편 + 라우트)

- 헤더 구조(토스):
  - 좌: 로고(📈 StockApp).
  - 중앙/좌측 1차 네비: **커뮤니티 · 게임** (활성 섹션은 토스 블루 밑줄/굵게). 커뮤니티 → `/`(첫 게시판), 게임 → `/game`.
  - 우: 로그인/로그아웃(기존 로직 유지, 토스 버튼).
  - 커뮤니티 섹션일 때만 그 아래 **게시판 탭 줄**(기존 `boards` 매핑, `Chip`으로). 게임 섹션에선 숨김.
- "현재 섹션"은 라우트로 판별: `/game` 경로면 게임, 그 외면 커뮤니티(별도 상태 불필요).
- 라우트 추가(`src/App.jsx`): `<Route path="game" element={<GamePage />} />` (Layout 하위).

---

## 6. 게임 스켈레톤 페이지 (`src/pages/GamePage.jsx`)

- 백엔드 미연동 → 정적. `EmptyState`로 모바일과 동일한 문구:
  - 이모지 🎮, 제목 "시즌을 준비하고 있어요", 안내 "곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!".
- 중앙 정렬, 토스 여백. 추후 Phase 6(백엔드 후)에서 실시간 차트·주문 패널로 대체.

---

## 7. 기존 화면 토스화 (최소 변경, 회귀 방지)

- **PostListPage / PostDetailPage**: 글 카드·메타·버튼을 `Card`/`Button`/토큰 유틸로. `.post-content` 서식은 색만 토스 매핑(구조 유지).
- **LoginModal**: 닉네임 로그인 로직 그대로, 입력/버튼/모달을 토스 스타일(rounded-field, bg-brand CTA). (간편로그인 교체는 후속)
- **NotificationToaster**: 색/모서리만 토스 톤으로. SSE 동작 로직 불변.
- **API 계약·store 로직(auth/boards)·SSE 연결은 변경하지 않는다.** 변경은 스타일/네비/신규 라우트에 한정.

---

## 8. 단계 분할(구현 순서 제안)

1. Tailwind 토스 테마 + `index.css` body/서식 토큰화 → 토대.
2. 공통 UI 컴포넌트 `src/components/ui/`(Button·Card·Chip·EmptyState).
3. 게임 스켈레톤 페이지 + `/game` 라우트.
4. Layout 2단 네비 개편(커뮤니티/게임 + 게시판 탭 조건부).
5. 기존 화면(글목록·글상세·LoginModal·토스터) 토스화.
6. README 반영(web_client 섹션: 2단 네비·게임 스켈레톤·토스 테마).

각 단계 후 `npm run build` 성공 확인. (web_client은 별도 테스트 러너 없음 — 빌드 성공 + 육안 검증이 검증 수단.)

---

## 9. 검증

- `cd web_client && npm run build` 성공(각 단계).
- 로컬 `npm run dev`로 육안: 커뮤니티/게임 2단 네비 전환, 게시판 탭, 글목록/상세, 로그인 모달, 게임 스켈레톤이 토스 톤으로 정상.
- 회귀: 게시판/글/댓글/로그인/SSE 알림 동작 보존(스타일만 변경).

---

## 10. 범위 밖(후속)

- 간편로그인(소셜) 웹 적용 — 백엔드 `/auth/social` 후.
- 게임 실시간 플레이·주문·랭킹·지인리그·퀴즈 — 트레이딩 게임 Phase 1~6.
- 웹 홈 피드·프로필 페이지 신규 — 필요 시 별도 결정(현재 웹 IA엔 없음).
- 다크모드 — 현재 라이트 고정(OW1).
