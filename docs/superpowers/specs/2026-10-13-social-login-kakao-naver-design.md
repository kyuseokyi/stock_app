# 간편 로그인(카카오·네이버) 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨 · 범용 가이드(공유용): https://claude.ai/artifact/52aiQ2edvohRBr6fXWsQHg
> 사용자 결정(메모리 `social-login-decisions`): 공급자 카카오·네이버 / 모바일은 웹 리다이렉트(네이티브 SDK X) / 닉네임 게스트 로그인은 개발용으로만 / 애플은 iOS 출시 직전.

## 1. 목표 / 범위

- 웹(web_client)·모바일(Expo)에서 카카오·네이버로 로그인 → 기존과 같은 서비스 JWT 발급(blog·trading_game 무변경으로 동작).
- 포함: auth 백엔드(엔드포인트·공급자 어댑터·가짜 공급자 모드·마이그레이션), web 로그인 버튼·완료 라우트, 모바일 로그인 버튼·인앱 브라우저 세션, 게스트 로그인 노출 플래그, 개발 앱 스킴 분리, 문서.
- 제외: 애플 로그인(어댑터 자리만), 기존 게스트→소셜 계정 연결/이관, 회원 탈퇴(별도 백로그), 공급자 네이티브 SDK, admin_web(관리자는 기존 이메일 로그인 유지).
- 불변: 기존 `/auth/login`·`/auth/guest`·`/auth/me` 응답·동작 유지.

## 2. 흐름 (백엔드 콜백 + 일회용 교환 코드)

```
클라이언트: verifier = base64url(32바이트 CSPRNG), cc = base64url(SHA-256(verifier))  (PKCE S256 방식)
클라이언트 → GET /api/v1/auth/social/{provider}/start?client=web|app[&app=dev|prod]&cc=<43자>
  auth: cc 형식 검증(base64url 43자, 아니면 422)
        state = 서명 JWT {provider, client, app_variant, nonce, cc, exp=10분} (키: SOCIAL_STATE_SECRET)
  → 302 공급자 인가 URL(redirect_uri = SOCIAL_REDIRECT_BASE/{provider}/callback)
공급자 → GET /api/v1/auth/social/{provider}/callback?code&state[&error]
  auth: state 서명·만료·provider·cc 형식 검증 → nonce 1회 사용(Redis SET NX, TTL 10분)
        → 어댑터.exchange_code(code, state) → ProviderProfile(id, nickname)
        → (provider, provider_id) 로 사용자 찾기/생성
        → 교환 코드 발급(Redis, TTL 60초, 값=JSON {"user_id", "cc"})
  → 302 복귀 주소?code=…   (실패 시 복귀 주소?error=<code>; Redis·DB 장애도 ?error=provider_failed)
클라이언트 → POST /api/v1/auth/social/exchange {code, code_verifier}
  auth: Redis GETDEL(1회, 먼저 소모) → base64url(SHA-256(code_verifier)) 와 cc 를 hmac.compare_digest
        → 불일치·누락은 '없는 코드'와 같은 401 → 사용자 활성 확인 → TokenResponse(기존 형식)
```

- **verifier(PKCE 방식)** — 로그인 CSRF(공격자 교환 코드를 피해자 브라우저에 심기)와 Android 커스텀 스킴 가로채기를 막는다.
  교환 코드만 가진 쪽은 verifier 를 모르므로 토큰을 받을 수 없다. 가짜 공급자 모드도 같은 경로를 탄다.
  - web: verifier 를 `sessionStorage`(`wc_social_verifier`)에 두고 이동, `/auth/complete` 가 꺼내(삭제) 교환에 실음. 없으면 "잘못된 접근".
    `crypto.subtle` 은 보안 컨텍스트(https·localhost)에서만 동작.
  - 모바일: `startSocialLogin` 지역 변수로만 보관. Hermes 에 Web Crypto 가 없어 SHA-256 은 순수 TS(`features/auth/pkce.ts`),
    난수는 `crypto.getRandomValues` 가 있으면 그것, 없으면 expo-modules-core 네이티브 `expo.uuidv4`(Android SecureRandom·iOS 시스템 CSPRNG)
    3개를 SHA-256 으로 압축(`features/auth/verifier.ts`). 보안 난수원이 없으면 시작하지 않는다(Math.random 금지).

- **복귀 주소는 state 의 client/app_variant 로 서버 설정에서만 선택**(오픈 리다이렉트 방지):
  - web → `SOCIAL_WEB_RETURN_URL`(예: `http://localhost:3000/auth/complete`)
  - app + prod → `SOCIAL_APP_RETURN_URL_PROD`(`stockapp://auth`), app + dev → `SOCIAL_APP_RETURN_URL_DEV`(`stockapp-dev://auth`)
- state 검증 실패 등 복귀 주소를 알 수 없으면 400 HTML(짧은 안내)로 끝낸다(리다이렉트하지 않음).
- 오류 코드(`?error=`): `cancelled`(공급자 error=access_denied 등) · `provider_failed`(교환/프로필 실패) · `inactive`(비활성 계정) · `state_invalid`(nonce 재사용 등 복귀 주소를 알 때).

## 3. 백엔드 (apps/auth)

### 3.1 데이터
- 마이그레이션: `auth_provider` enum 에 `NAVER` 추가(PG `ALTER TYPE ... ADD VALUE`, 다운그레이드는 no-op 주석) + `users (provider, provider_id)` **유니크 제약**(둘 다 NULL 인 기존 행은 PG 유니크에서 서로 충돌하지 않음).
- 소셜 사용자 생성: `email=NULL`, `password_hash=NULL`, `role=FREE`, `is_active=True`, `provider`, `provider_id`, `nickname` = 공급자 닉네임(앞뒤 공백 제거, 최대 100자), 없으면 `유저` + 4자리 난수. **`social_token` 저장 안 함.**
- 기존 사용자(같은 provider+provider_id)는 그대로 로그인(닉네임 덮어쓰지 않음).
- **이메일로 기존 계정과 병합하지 않는다.**

### 3.2 모듈 구조
```
apps/auth/social/
  config.py      # SocialSettings(env 로드), 공급자별 활성 여부
  state.py       # sign_state / verify_state (PyJWT HS256, SOCIAL_STATE_SECRET, cc 포함)
  pkce.py        # challenge_for / verifier_matches (base64url(SHA-256), hmac.compare_digest)
  store.py       # Redis: use_nonce, issue_exchange_code, consume_exchange_code (redis.asyncio, REDIS_URL)
  providers.py   # Provider 프로토콜 + KakaoProvider·NaverProvider·FakeProvider (httpx.AsyncClient)
  service.py     # find_or_create_user(db, provider, profile)
apps/auth/routers/social.py   # providers / start / callback / exchange
```
- 공급자 API:
  - 카카오: 인가 `https://kauth.kakao.com/oauth/authorize`(response_type=code, client_id, redirect_uri, state), 토큰 `POST https://kauth.kakao.com/oauth/token`(form: grant_type=authorization_code, client_id, redirect_uri, code, client_secret?), 프로필 `GET https://kapi.kakao.com/v2/user/me` → `id`, `kakao_account.profile.nickname`(없으면 `properties.nickname`).
  - 네이버: 인가 `https://nid.naver.com/oauth2.0/authorize`(response_type=code, client_id, redirect_uri, state), 토큰 `POST https://nid.naver.com/oauth2.0/token`(form: grant_type=authorization_code, client_id, client_secret, code, state), 프로필 `GET https://openapi.naver.com/v1/nid/me` → `response.id`, `response.nickname`(없으면 `response.name`).
  - httpx 타임아웃 5초, 비-2xx·필수 필드 누락 → `ProviderError` → `?error=provider_failed`.
- **가짜 공급자 모드**: `SOCIAL_FAKE_PROVIDER=true` 이고 `APP_ENV` 가 **명시적으로** `development`/`test` 일 때만(미설정·기타 값은 꺼짐 — fail closed). 켜져 있으면 기동 시 경고 로그. `/start` 가 공급자 대신 자기 콜백으로 `code=fake` 를 붙여 302, 어댑터는 `id=fake-<provider>-tester`, 닉네임 `테스트유저` 프로필 반환. 운영에서 켜져 있으면 기동 시 경고 로그 + 무시.
- 키 미설정 공급자(가짜 모드 아님) → `/start` 503 `{"detail":{"code":"PROVIDER_DISABLED","message":"…준비 중"}}`.
- `GET /api/v1/auth/social/providers` → `{"kakao": bool, "naver": bool}` (버튼 노출용, 공개).

### 3.3 환경변수 (backend)
`KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`(선택), `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `SOCIAL_STATE_SECRET`(미설정 시 JWT 키로 폴백 + 운영이면 기동 경고), `SOCIAL_REDIRECT_BASE`(기본 `http://localhost:8001/api/v1/auth/social`, 운영에서 기본값이면 기동 경고), `SOCIAL_WEB_RETURN_URL`(기본 `http://localhost:3000/auth/complete`, 운영에서 기본값이면 기동 경고), `SOCIAL_APP_RETURN_URL_PROD`(기본 `stockapp://auth`), `SOCIAL_APP_RETURN_URL_DEV`(기본 `stockapp-dev://auth`), `SOCIAL_FAKE_PROVIDER`(기본 false), `REDIS_URL`(기존). `backend/.env.example` 에 키 이름만 추가.

## 4. web_client

- `api/auth.ts`: `socialStartUrl(provider, cc)`(= `AUTH_BASE_URL + /auth/social/{p}/start?client=web&cc=…`), `getSocialProviders()`, `exchangeSocialCode(code, codeVerifier) → TokenResponse`. verifier 보관·cc 계산은 `lib/socialLogin.ts`(`prepareSocialVerifier`/`takeSocialVerifier`).
- `store/auth.ts`: `loginWithToken(TokenResponse)` 추가(기존 login 과 같은 저장 경로 재사용, `login` 동작 불변).
- `LoginModal`: 카카오(#FEE500/검정)·네이버(#03C75A/흰) 버튼(공급자 비활성이면 숨김) + 게스트 닉네임 폼은 `ENABLE_GUEST_LOGIN` 일 때만. 클릭 시 `sessionStorage['wc_login_return']=location.pathname+location.search` 저장 후 `location.assign(startUrl)`.
- 라우트 `/auth/complete`(`pages/AuthCompletePage.tsx`): `?code` → 교환 → 저장 → 저장된 복귀 경로(없으면 `/`)로 `replace`; `?error` → 문구 + 홈 링크. 교환 중 "로그인 중…".
- `config.ts`: `ENABLE_GUEST_LOGIN` = `VITE_ENABLE_GUEST_LOGIN === 'true'` 또는 (dev serve 이고 `!== 'false'`) — dev 기본 켬, 배포 빌드 기본 끔. `vite-env.d.ts` 키 추가.
- `docker-compose.prod.yml` web_client 빌드 인자 `VITE_ENABLE_GUEST_LOGIN: "true"`(개발 서버 테스트용 — product 도입 시 false), web_client Dockerfile ARG/ENV 추가.

## 5. 모바일 (Expo)

- `app.config.js`: `scheme: isDev ? 'stockapp-dev' : 'stockapp'` (dev build 1회 재생성 필요 — README 명시).
- `features/auth/api.ts`: `getSocialProviders()`, `exchangeSocialCode(code, codeVerifier)`; `features/auth/social.ts`: `startSocialLogin(provider)` = `createVerifierPair()`(verifier.ts) → `WebBrowser.openAuthSessionAsync(startUrl, returnUrl)` — `startUrl = AUTH_API + /api/v1/auth/social/{p}/start?client=app&app=dev|prod&cc=…`, `returnUrl = Linking.createURL('auth')`. 결과 `type==='success'` 면 URL 의 `code`/`error` 를 순수 함수 `parseAuthReturnUrl`(jest)로 파싱.
- `features/auth/store.ts`: `loginWithToken` 추가(SecureStore·메모리 토큰 홀더 동일 경로).
- 내정보 탭: 카카오·네이버 버튼 + 게스트 폼은 `ENV.enableGuestLogin`(= `EXPO_PUBLIC_ENABLE_GUEST_LOGIN`, 미설정 시 `appEnv !== 'production'`).
- 취소(`type` 이 `cancel`/`dismiss`)는 조용히 무시, `error` 는 문구 표시.

## 6. 검증

1. **백엔드 pytest(TDD)** — `tests/test_social_login.py`: state 서명/만료/위조/provider 불일치, nonce 재사용 거부, 콜백 성공(신규 생성·재로그인 같은 사용자·email NULL·닉네임 폴백), 공급자 실패→`provider_failed`, 공급자 취소→`cancelled`, 교환 코드 1회성·없는 코드 401, 비활성 사용자, 복귀 주소 선택(web/app-dev/app-prod), 키 미설정 503, providers 엔드포인트, 가짜 모드는 production 에서 무시. 공급자 HTTP 는 `httpx.MockTransport`, Redis 는 `fakeredis`. 기존 228개 회귀 없음.
2. **web**: tsc·build, 번들 `localhost:800` 없음.
3. **mobile**: tsc·jest(`parseAuthReturnUrl`).
4. **브라우저 스모크(가짜 공급자 모드)**: 로컬 auth+web → 카카오 버튼 → 완료 라우트 → 로그인 상태·원래 페이지 복귀, 같은 계정 재로그인, 게스트 폼 dev 노출, `?error` 화면.
5. **실 공급자**: 사용자 키 발급 후 수동 확인(네이버는 검수 전 테스트 계정).

## 7. 문서
- README: auth 섹션(엔드포인트·환경변수·가짜 모드), 공급자 콘솔에 등록할 Redirect URI 목록, 모바일 dev 스킴 변경·dev build 재생성.
- `backend/.env.example`·`mobile/.env.example` 키 이름 추가. ROADMAP Phase 3 "소셜 로그인 실연동" 갱신.
