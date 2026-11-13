# 이용약관 동의 · 심사 전용 로그인 · 정보 제공 고지 설계 (2026-11-13)

스토어 출시 체크리스트 [`docs/deploy/store-release.md`](../../deploy/store-release.md)의 **D3(약관 동의)**, **D1(심사 전용 로그인)**, **R1(정보 제공 고지)**.
약관 본문은 웹 `/terms`(`web_client/src/pages/TermsPage.tsx`, 시행일 2026-11-13)에 이미 있다.

## 1. 약관 동의 (D3)

### 서버 (auth)
- `users`에 두 컬럼 추가(마이그레이션, 기존 행은 NULL)
  - `terms_version: String(20) | None` — 마지막으로 동의한 약관 버전
  - `terms_agreed_at: DateTime(timezone=True) | None`
- 현재 버전 상수 `TERMS_VERSION = "2026-11-13"`(`apps/auth/terms.py`). 약관을 바꾸면 이 값과 `TermsPage` 시행일을 같이 바꾼다 → 기존 회원도 다시 동의해야 한다.
- `terms_required(user) -> bool`: 관리자(`UserRole.ADMIN`)는 항상 `False`, 그 밖에는 `user.terms_version != TERMS_VERSION`.
- `UserOut`에 `terms_required: bool` 추가(기존 필드는 그대로 — 응답 구조 호환). `/me`, 로그인·토큰 응답의 `user`에 모두 들어간다.
- `POST /api/v1/auth/me/terms` (인증 필요) body `{"version": "2026-11-13"}`
  - `version != TERMS_VERSION` → 409 `{"code": "TERMS_VERSION_MISMATCH", "message": ...}`(오래된 클라이언트)
  - 같으면 `terms_version`, `terms_agreed_at=now(UTC)` 저장 → 200 `UserOut`(이제 `terms_required=false`). 이미 동의했어도 200(멱등).
- 서버는 약관 미동의를 이유로 다른 API를 막지 않는다(1차). 동의 강제는 클라이언트 게이트가 한다. 댓글 작성 API만 미동의면 403 `TERMS_REQUIRED`(UGC 요건 — 우회 방지).

### 앱 (mobile)
- 로그인 직후와 앱 시작 시 세션 확인(`validateSession`) 결과의 `user.terms_required`가 `true`면 **닫을 수 없는 약관 동의 시트**를 띄운다(루트 레이아웃, 다른 시트보다 먼저).
- 내용: 제목 "FunNote 이용약관에 동의해 주세요", 요약 3줄(정보는 참고용·투자 권유 아님 / 모의투자는 가상 자금 / 욕설·스팸·사기 권유 금지, 신고 시 조치), [이용약관 보기]·[개인정보처리방침 보기](인앱 브라우저), 버튼 [동의하고 시작하기] / [동의하지 않음].
- [동의하고 시작하기] → `POST /me/terms` → 스토어 `user` 갱신 → 시트 닫힘. 409면 "앱을 업데이트해 주세요" 안내.
- [동의하지 않음] → 로그아웃(기존 로그아웃 흐름) + 토스트 "약관에 동의해야 회원 기능을 쓸 수 있어요".

### 웹 (web_client)
- 같은 판정으로 `Layout`에서 모달(닫기 없음) — 내용·동작은 앱과 같다. 약관·방침 링크는 새 탭이 아니라 같은 SPA 라우트로 열되, 모달은 `/terms`·`/privacy` 경로에서는 띄우지 않는다(읽을 수 있게).

## 2. 심사 전용 로그인 (D1)

### 서버
- env `REVIEW_LOGIN_EMAILS`(쉼표 구분). 비어 있으면 기능 꺼짐.
- `POST /api/v1/auth/review-login` body `{"email", "password", "platform": "app"|"web"}`
  - 꺼져 있으면 404(엔드포인트가 없는 것처럼 — `guest_gate` 와 같은 방식)
  - 이메일이 허용 목록에 없거나, 사용자가 없거나, `password_hash` 없음, 비밀번호 불일치 → 401 같은 메시지("이메일 또는 비밀번호가 올바르지 않습니다.")
  - 관리자 계정은 허용하지 않는다(401) — 관리자는 기존 `/login`(admin 플랫폼)만
  - 비활성 → 403
  - 성공 → `issue_login_token(db, redis, user, platform)`(앱이면 리프레시 토큰 포함) — 일반 회원과 같은 세션 규칙
- 시드: `python -m apps.auth.seed_reviewer` — env `REVIEW_EMAIL`, `REVIEW_PASSWORD`(필수, 12자 이상), 닉네임 `App Review`, 역할 FREE, `provider` 없음. 있으면 비밀번호만 갱신. 출력에 비밀번호를 찍지 않는다.
- 상용 운영: 심사 기간에만 `REVIEW_LOGIN_EMAILS`에 그 이메일을 넣고, 심사 뒤 빼거나 비밀번호를 바꾼다.

### 앱
- 내정보 맨 아래에 **앱 버전 표시**(`Constants.expoConfig.version`, 예 `버전 1.0.0`).
- 비로그인 상태에서 버전 표시를 **7번**(3초 안) 누르면 "심사용 로그인" 폼(이메일·비밀번호·[로그인])이 나타난다. 성공하면 일반 로그인과 같은 저장 경로. 404면 "지금은 사용할 수 없어요".
- 웹에는 만들지 않는다(심사는 앱으로).

## 3. 정보 제공 고지 (R1)
- 앱·웹 내정보 정책 링크 위에 작은 회색 문구 한 줄: "FunNote는 투자 정보를 참고용으로 제공하며 투자 권유·자문을 하지 않습니다. 모의투자는 가상 자금으로 진행돼요."

## 4. 테스트
- 서버(pytest): `terms_required` 판정(관리자 false, NULL true, 옛 버전 true, 현재 false), `POST /me/terms` 성공·멱등·409·미인증 401, 댓글 작성 미동의 403, `review-login` 꺼짐 404·허용 목록 밖 401·틀린 비밀번호 401·관리자 401·비활성 403·성공(app 리프레시 포함), 시드 생성·갱신.
- 앱(jest): 약관 필요 판정과 동의 후 갱신, 7번 탭 카운터(3초 창), 409 문구.
- 웹(vitest): 모달 표시 조건(로그인·terms_required·경로 예외).

## 5. 반영
- 마이그레이션 → 개발 서버 배포 시 워크플로가 `alembic upgrade head` 실행. 로컬에서는 alembic upgrade 하지 않는다.
- 앱은 JS 변경(OTA 가능). 단 같은 브랜치의 권한 차단(D6)이 네이티브 변경이라 런타임 지문이 바뀐다 → 새 APK 필요.
- 문서: README(인증 절), `docs/feature-report/app.md`, `store-release.md` 체크 표시.
