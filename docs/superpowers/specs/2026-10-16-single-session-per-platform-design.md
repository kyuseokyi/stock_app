# 플랫폼별 단일 세션(중복 로그인 처리) 설계

> 2026-10-16 · 사용자 요청 "중복로그인 처리 필요." → 정책 "웹 1 + 앱 1 허용", 방식 "조합 2(PG 원본 + Redis Pub/Sub 즉시 끊기)"

## 1. 목표 / 비목표

**목표**
- 같은 계정은 플랫폼(`web`·`app`·`admin`)마다 **마지막으로 로그인한 1곳만** 유효. 노트북 웹 + 폰 앱 동시 사용은 허용.
- 밀려난 기기: REST 는 다음 요청에서 `401 SESSION_REPLACED`, 게임 WS 는 **즉시** 끊김, 인증 요청이 없는 화면은 **시작·복귀 시 `/auth/me` 확인**(7-1)으로 감지. 클라이언트는 로그아웃 + "다른 기기에서 로그인되어 로그아웃됐어요" 안내.
- 정확성은 PostgreSQL 이 보장, Redis 는 반응 속도(즉시 끊기)만 담당 — Redis 장애 시에도 REST 검증은 그대로 동작.

**비목표**
- 기기 목록/원격 로그아웃 UI, 서버측 로그아웃 엔드포인트, refresh 토큰.
- admin_web 의 401 안내 문구 변경(기존 401 처리 그대로 — 관리자는 다른 admin 세션 로그인 시 밀려남).
- blog SSE 연결의 즉시 끊기(SSE 는 인증 없음 — 해당 없음).

## 2. 데이터 모델

새 테이블 `user_sessions` (Alembic 마이그레이션, down_revision = 현재 head `f2a3b4c5d6e7`):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `user_id` | Integer FK `users.id` **ON DELETE CASCADE** | PK 1 |
| `platform` | String(16) (`web`/`app`/`admin`) | PK 2, CHECK 제약 |
| `sid` | String(64) | 현재 유효 세션 id(`secrets.token_urlsafe(24)`) |
| `created_at`/`updated_at` | TimestampMixin | |

- 복합 PK `(user_id, platform)` → 플랫폼당 1행. 로그인 = upsert(`INSERT … ON CONFLICT (user_id, platform) DO UPDATE SET sid=…`).
- 회원 탈퇴는 FK cascade 로 자동 정리(탈퇴 서비스 변경 불필요 — users 행 삭제 경로 확인만).
- 모델 위치: `shared/models.py` (`UserSession`), 상수 `SessionPlatform = Literal["web","app","admin"]`.

## 3. 토큰

`shared/security.create_access_token(*, subject, role, sid: str | None = None, platform: str | None = None)`
- `sid`·`platform` 은 **선택 kwargs**(기존 호출·테스트 호환). 주어지면 payload 에 `sid`, `plt` 추가.
- 만료(12h)·서명 방식 변경 없음.

## 4. 세션 서비스 (Router → Service 분리)

`shared/sessions.py` (auth 발급·모든 서비스 검증이 공유):

- `async start_session(db, user_id, platform) -> str` — 새 sid 생성 → upsert → **commit** → sid 반환.
- `async check_session(db, payload) -> SessionCheck` — 판정 규칙:
  | 토큰 | 결과 |
  |---|---|
  | `sid` 없음(배포 전 발급 토큰) | **허용**(레거시 유예, 최대 12h 후 자연 만료) |
  | `sid` 있음 + 행 없음 | 거부 `SESSION_REPLACED` |
  | `sid` 있음 + 행 sid 다름 | 거부 `SESSION_REPLACED` |
  | `sid` 있음 + 행 sid 같음 | 허용 |
- `async publish_session_replaced(redis, user_id, platform, sid)` — best-effort(예외는 로그만), 채널 상수 `SESSION_REPLACED_CHANNEL = "auth:session:replaced"`, 페이로드 `{"user_id", "platform", "sid"}`(sid = **새** 현재 sid).

로그인 순서(모든 발급 경로 공통): `start_session`(commit) → 토큰 생성 → `publish_session_replaced` → 응답.

## 5. 발급 경로별 platform 결정

| 경로 | 호출자 | platform |
|---|---|---|
| `POST /auth/login` | admin_web 전용 | `admin` 고정 |
| `POST /auth/guest` | web_client·mobile | 요청 바디 `platform: "web"\|"app"`(선택, **기본 `web`**). web_client 는 `web`, mobile 은 `app` 을 보내도록 수정. 게스트는 개발용이라 구 앱 빌드가 `web` 으로 취급되는 영향은 수용 |
| `GET /auth/social/callback` → `POST /auth/social/exchange` | web_client·mobile | OAuth state 의 `client`(`web`/`app`)를 **교환 코드 grant 에 함께 저장**하고 exchange 가 grant 에서 읽는다. 요청 바디에서 받지 않는다(클라이언트가 임의 선택 불가) |

- `SocialStore.issue_exchange_code(user_id, cc, client)` / grant 에 `client` 필드 추가. 배포 시점에 남아 있던(10분 TTL) 구 grant 에 `client` 가 없으면 `web` 으로 처리.

## 6. 검증 지점

1. **REST** — `shared/auth.get_current_user`: 기존 decode·User 조회 뒤 `check_session`. 거부 시 `401 detail={"code":"SESSION_REPLACED","message":"다른 기기에서 로그인되어 로그아웃됐어요."}`. (blog·stock_api·trading_game·auth 모두 이 의존성을 사용)
2. **게임 WS 핸드셰이크** — `ws_gateway.game_stream`: 기존 검증 뒤 `check_session`, 거부 시 `accept` → `close(code=4401, reason="SESSION_REPLACED")`.
3. **게임 WS 즉시 끊기**
   - `ConnectionManager` 가 로그인 소켓마다 `(platform, sid)` 를 보관(`connect(user_id, ws, platform=None, sid=None)`). 레거시 토큰(plt/sid 없음) 소켓은 끊기 대상에서 제외.
   - 새 메서드 `close_replaced(user_id, platform, current_sid)` — 해당 유저·플랫폼 소켓 중 **sid ≠ current_sid** 만 `close(4401, "SESSION_REPLACED")`. (방금 새로 붙은 소켓은 보존)
   - `ws_bus.run_subscriber`: `SESSION_REPLACED_CHANNEL` 을 같은 구독 연결로 받아 페이로드를 **async 핸들러**에 넘긴다(기존 `extra_channels` 는 무인자 동기 콜백 → 페이로드 전달용 확장 `payload_channels: dict[str, Callable[[dict], Awaitable[None]]]` 추가, 기존 동작 불변). 핸들러는 로컬 매니저의 `close_replaced` 호출 — 모든 인스턴스가 구독하므로 수평 확장에서도 동작.
   - 사용자 채널(`game:ws:user:{uid}`)은 쓰지 않는다(그 채널 메시지는 클라이언트로 그대로 전달됨).
   - auth·trading_game 은 같은 `REDIS_URL` 을 쓴다(Pub/Sub 은 DB 번호 무관, 호스트만 같으면 됨).

**WS 종료 코드는 새로 만들지 않고 4401 재사용**: 설치된 앱·웹 훅이 4401 에서만 재연결을 멈추므로, 사유는 close `reason` 으로 구분한다.

## 7. 클라이언트

**web_client**
- `store/auth.expireSession(rejectedToken, reason?: 'expired' | 'replaced')` — 문구: expired "로그인이 만료되었어요. 다시 로그인해 주세요" / replaced "다른 기기에서 로그인되어 로그아웃됐어요".
- `api/client.ts`·`api/gameClient.ts` 401 인터셉터: `response.data.detail.code === 'SESSION_REPLACED'` 이면 `replaced`.
- `useGameWebSocket`: 4401 콜백에 `e.reason` 전달 → `GamePage` 가 `expireSession(token, reason === 'SESSION_REPLACED' ? 'replaced' : 'expired')`.
- 게스트 로그인 요청에 `platform: 'web'`.

**mobile** (새 빌드 필요)
- `lib/api/http.ts` 401 → `notifyUnauthorized(reason)` (응답 detail.code 로 판정), auth store 핸들러가 로그아웃 + `showToast`(전역 토스트) 문구 구분.
- `game.tsx` 의 `useGameSocket` 4401 콜백: 현재는 토스트만 → **로그아웃 + 안내**(웹 `4d5f8a9` 와 같은 결함 수정). `use-game-socket` 이 close reason 전달.
- 게스트 로그인 요청에 `platform: 'app'`.

**admin_web**: 변경 없음(기존 401 처리).

### 7-1. 시작·복귀 시 세션 확인 (`GET /auth/me`)

밀려난(또는 만료된) 기기가 블로그·홈처럼 인증 요청이 없는 화면에 있으면, 헤더 닉네임이 저장값 그대로 남는다. 시작·복귀 시점에 한 번 확인한다.

- **시점**: 웹 = 앱 로드 시 + 탭 재포커스(`visibilitychange` → visible), 앱 = 실행 시 + 포그라운드 복귀(`AppState` → active).
- **조건**: 토큰이 있을 때만. 재포커스·복귀는 **마지막 확인 후 60초 이내면 생략**(탭 전환마다 요청하지 않도록).
- **결과 처리**
  - 200 → 응답 사용자로 저장된 user 갱신(닉네임 변경 반영).
  - 401 → 위 401 경로와 동일(`SESSION_REPLACED` 면 replaced 문구, 그 외 expired 문구로 로그아웃).
  - 네트워크 오류·5xx → 아무것도 하지 않음(오프라인에서 로그아웃시키지 않는다).
- **위치**
  - web: `store/auth.validateSession()` — auth 서비스 클라이언트(`api/auth.ts`)로 `GET /auth/me`, 401 이면 `expireSession(token, reason)`. `Layout` 에서 마운트 시 + `visibilitychange` 구독.
  - mobile: auth store `validateSession()` — `authApi.get('/api/v1/auth/me')`(http 클라이언트의 401 → `notifyUnauthorized(reason)` 경로 그대로). 루트 레이아웃에서 실행 시 + `AppState` active 구독.
- 서버 변경 없음(`/auth/me` 는 이미 `get_current_user` 사용 → 6장 1번의 세션 검증이 그대로 적용).

## 8. 에러 처리 / 장애

- `start_session` 실패(DB) → 로그인 실패(500) — 세션 없이 토큰을 내주지 않는다.
- Pub/Sub 발행 실패 → 로그만. 이전 기기 WS 는 유지되지만 그 기기의 다음 REST(게임 30초 순위 폴링 포함)와 WS 재접속에서 거부.
- 구독 연결 끊김 → 기존 지수 백오프 재연결(그동안의 이벤트는 유실, 위와 같이 REST 로 보완).

## 9. 테스트

**pytest (backend)**
- `start_session` upsert: 같은 플랫폼 재호출 시 sid 교체, 다른 플랫폼 행 독립.
- `get_current_user`: 같은 플랫폼 재로그인 후 이전 토큰 401 `SESSION_REPLACED` / 다른 플랫폼 토큰 유효 / sid 없는 레거시 토큰 허용 / 행 없는 sid 거부.
- 발급 경로: `/auth/login`→`admin`, `/auth/guest` platform 기본값·`app`, social exchange 가 grant 의 `client` 사용(바디 무시), 구 grant(client 없음)→`web`.
- 발행: 로그인 시 `SESSION_REPLACED_CHANNEL` 에 새 sid 발행(fakeredis), Redis 오류여도 로그인 성공.
- WS: 핸드셰이크 거부 4401+reason, `close_replaced` 가 sid 다른 소켓만 닫고 새 소켓·다른 플랫폼·레거시 소켓은 유지, 버스 디스패치 → 핸들러 호출.
- 회원 탈퇴 시 `user_sessions` 행 삭제(cascade).

**web**: `tsc --noEmit` + vite build, 브라우저에서 두 isolatedContext 로 같은 계정 게스트 로그인 → 이전 컨텍스트 WS 즉시 끊김·헤더 로그인 버튼·문구 확인 + 블로그 화면에서 새로고침·탭 재포커스 시 로그아웃 확인(개발 서버/로컬 기준).
**mobile**: `tsc --noEmit` + jest(401 reason 판정·4401 로그아웃·`validateSession` 의 200 갱신/401 로그아웃/네트워크 오류 무시/60초 생략).

## 10. 배포 / 롤아웃

- `backend/**` 변경 → deploy-server 가 `alembic upgrade head` 후 재기동. 레거시 토큰 유예로 일괄 로그아웃 없음.
- web 은 deploy-web, 앱은 새 빌드 설치 후 문구·4401 로그아웃 반영(구 빌드도 4401 에서 재연결은 멈춤).
- 롤백: 코드 되돌리기 시 sid 토큰은 구 코드에서도 유효(추가 클레임 무시), 테이블은 남겨도 무해.
