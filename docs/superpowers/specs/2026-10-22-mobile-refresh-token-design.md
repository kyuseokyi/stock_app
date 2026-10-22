# 모바일 리프레시 토큰 설계

- 작성: 2026-10-22 · 상태: 승인(사용자 "모바일은 B로 진행해줘" — 접근 토큰 짧게 + 리프레시 토큰 길게·서버 저장, 웹은 현재 방식 유지)
- 선행: 플랫폼별 단일 세션 `2026-10-16-single-session-per-platform-design.md`(user_sessions, sid, SESSION_REPLACED — 이 문서는 그 위에 얹는 확장), 간편 로그인 `2026-10-13-social-login-kakao-naver-design.md`
- 문제: 앱 접근 토큰이 로그인 시점부터 12시간(`JWT_EXPIRE_HOURS`) 고정이라, 쓰는 중이어도 12시간 뒤 다시 로그인해야 한다. 서버 로그아웃이 없어 토큰을 끊을 수도 없다.

## 1. 결정 사항
| 항목 | 결정 | 이유 |
|---|---|---|
| 대상 | `platform == "app"` 로그인만(게스트 `platform:"app"`, 소셜 state `client=app`). 웹·관리자는 그대로 | 모든 로그인이 `issue_login_token(db, redis, user, platform)` 를 지나므로 여기서 분기. 소셜은 서명된 state 값이라 위조 불가 |
| 접근 토큰(앱) | **60분** — env `JWT_APP_EXPIRE_MINUTES`(기본 60). 웹·관리자는 `JWT_EXPIRE_HOURS`(12) 그대로 | 짧을수록 유출 피해가 작다. 갱신이 자동이라 사용자는 느끼지 못함 |
| 리프레시 토큰 | **불투명 난수**(`secrets.token_urlsafe(32)`), 서버엔 **SHA-256 해시만** 저장. 수명 **30일** env `REFRESH_EXPIRE_DAYS`(기본 30), 갱신할 때마다 새 30일(슬라이딩) | JWT 로 만들면 typ 구분·같은 키 서명 문제가 생김. 해시 저장이면 DB 가 새도 토큰을 쓸 수 없음 |
| 세션과의 관계 | 리프레시 행은 로그인 때의 `sid` 에 묶인다. 갱신은 **sid 유지**(새 세션 아님, SESSION_REPLACED 발행 없음). 같은 플랫폼 재로그인으로 `user_sessions.sid` 가 바뀌면 이전 리프레시는 무효 | 기존 "앱은 기기 하나" 규칙과 일관. sid 를 바꾸면 자기 WS 를 끊게 됨 |
| 회전 | 갱신 성공 시 이전 토큰은 `used_at` 기록 + 새 토큰 발급(`replaced_by`). 동시 갱신·여러 인스턴스(auth replicas 2)는 **행 잠금(SELECT … FOR UPDATE) 또는 조건부 UPDATE** 로 원자 처리 | 같은 토큰으로 두 번 회전되지 않게 |
| 재사용 감지 | 이미 쓴 토큰이 다시 오면: 사용 후 **30초 이내**면 유예(네트워크로 응답을 못 받은 경우 — 그 토큰으로 다시 회전, 앞서 만든 후속 토큰은 폐기), 30초가 지났으면 **탈취로 보고 그 sid 의 리프레시 전부 폐기 + 앱 세션 삭제**(접근 토큰도 즉시 무효) → 401 `REFRESH_REUSED` | 표준 회전·재사용 감지. 유예는 모바일 망 끊김 대비 |
| 갱신 시 확인 | 사용자 존재·`is_active`, 세션 sid 일치, 만료·폐기 여부 | 탈퇴·비활성·재로그인 반영 |
| 서버 로그아웃 | `POST /api/v1/auth/logout` {refresh_token}(접근 토큰 없어도 됨): 그 sid 의 리프레시 전부 폐기 + 앱 세션 행 삭제(sid 가 같을 때만). 항상 204(존재 여부 노출 안 함) | 지금은 서버에서 끊을 방법이 없음 |
| 401 사유 코드 | `get_current_user` 가 만료는 `{"code":"TOKEN_EXPIRED", ...}`, 그 밖의 무효는 `{"code":"TOKEN_INVALID", ...}` 로(기존 SESSION_REPLACED 유지). WS 는 만료면 `close(4401, "TOKEN_EXPIRED")` | 앱이 "갱신해 볼지"를 판단. 웹은 이미 dict detail(SESSION_REPLACED)을 처리하므로 호환 — 웹 표시 문구 확인 필요 |
| 탈퇴 | 리프레시 테이블 FK `ON DELETE CASCADE` + 탈퇴 서비스에서 명시 삭제(sqlite 테스트) | users hard delete |

## 2. 데이터
`refresh_tokens`(PostgreSQL, alembic — 현재 head `c1d2e3f4a5b6` 다음):
`id`(PK), `user_id`(FK users CASCADE, index), `platform`(String, 'app'), `sid`(String(64), index), `token_hash`(String(64), unique), `created_at`, `expires_at`, `used_at`(nullable), `replaced_by_id`(nullable FK self), `revoked_at`(nullable).
정리: 같은 사용자의 만료·폐기 후 7일 지난 행은 로그인·갱신 때 지운다(행 수가 사용자 수 × 소수라 작음).

## 3. API(auth, prefix `/api/v1/auth`)
- 로그인 응답(`TokenResponse`)에 선택 필드 `refresh_token: str | None`, `expires_in: int | None`(접근 토큰 초) 추가 — 앱 로그인일 때만 채움. 구 앱·웹은 무시.
- `POST /refresh` {refresh_token} → 200 `{access_token, refresh_token, token_type, expires_in, user}` / 401 `{"code": "REFRESH_INVALID"|"REFRESH_EXPIRED"|"REFRESH_REUSED"|"SESSION_REPLACED", "message"}`.
- `POST /logout` {refresh_token} → 204.

## 4. 모바일
- SecureStore 키 `auth_refresh` 추가(`persist`·`hydrate`·`logout` 확장). `loginWithToken({accessToken, refreshToken?, user})`.
- `lib/api/http.ts`: 토큰을 붙인 요청이 401 이고 사유가 `TOKEN_EXPIRED`(또는 사유 없는 401 — 구 서버 호환)이며 리프레시가 있으면 → **single-flight** 갱신(동시에 여러 401 이 와도 한 번만) → 원요청 1회 재시도. 갱신 요청 자체는 이 로직을 타지 않음(무한 루프 방지). 갱신 실패(401) → `expireSession`(기존 안내), 네트워크 오류 → 로그아웃하지 않고 원래 오류.
- `SESSION_REPLACED` 는 갱신하지 않고 지금처럼 로그아웃.
- 로그아웃: 로그아웃 훅(푸시 해제 등) 전에 접근 토큰이 만료됐으면 갱신을 한 번 시도(짧은 시간 제한) → 훅 → 서버 `/logout`(best-effort) → 로컬 삭제.
- 푸시 API(직접 fetch): 등록·해제 직전에 유효한 토큰을 얻는 공용 함수(`getFreshAccessToken()` — 필요 시 갱신)를 사용.
- 앱 복귀 `validateSession`(`/me`)은 http 클라이언트를 타므로 자동 갱신됨.
- 게임 WS(`use-game-socket`): 토큰을 effect deps 에서 빼고 ref 로 읽어 **토큰 회전마다 재연결하지 않음**. 4401 이고 사유가 `TOKEN_EXPIRED`/빈 값이면 갱신 후 재연결(1회), 실패하면 기존처럼 `onAuthFailed`. `SESSION_REPLACED` 는 지금처럼.
- 웹: 변경 없음(401 코드가 dict 로 바뀌는 것만 표시 호환 확인).

## 5. 테스트
- 백엔드: 앱 로그인만 refresh 발급(guest app/web, social exchange client app/web, admin), 앱 접근 토큰 만료 60분·웹 12시간, 갱신 성공(회전·sid 유지·SESSION_REPLACED 미발행), 만료·폐기·없는 토큰, 재사용(30초 유예 → 재회전·이전 후속 폐기 / 유예 지남 → 전부 폐기 + 세션 삭제 → 기존 접근 토큰 401), 재로그인 후 이전 리프레시 무효, 비활성·탈퇴, 로그아웃(세션 삭제·폐기·항상 204), 401 사유 코드(만료/무효/교체), WS 만료 4401 사유, 마이그레이션.
- 모바일 jest: single-flight(동시 401 3개 → 갱신 1회, 원요청 3개 재시도), 갱신 실패 → expireSession 1회, 네트워크 오류 → 로그아웃 안 함, SESSION_REPLACED → 갱신 안 함, 갱신 요청 자체 401 루프 없음, persist/hydrate 에 refresh, WS 만료 분류.
- 실기기(사용자): 로그인 → (env 로 접근 토큰을 짧게 한 개발 서버에서) 시간이 지나도 계속 사용, 로그아웃 → 다른 기기 영향 없음, 재로그인 시 이전 기기 끊김.
