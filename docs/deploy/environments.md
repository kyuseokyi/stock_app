# 환경별 설정 — 로컬 / 개발(haezean.com) / 상용(funnotedaily.com)

> 2026-11-10 기준. 앱 이름은 **FunNote**. 개발은 `haezean.com` 을 계속 쓰고, 실제 서비스(상용)만 `funnotedaily.com` 을 쓴다.
> 이 문서는 **어떤 파일의 어떤 변수가 환경마다 어떻게 달라지는지**만 적는다. 키·비밀번호 값은 어디에도 적지 않는다.
> 상용 서버 만드는 순서는 [`prod-release.md`](prod-release.md), 개발 서버 최초 세팅은 [`../server_setup.md`](../server_setup.md).

## 1. 한눈에

| | 로컬 | 개발 서버 | 상용 서버 |
|---|---|---|---|
| 도메인 | `localhost` | `haezean.com` | `funnotedaily.com` |
| 서버 | 내 맥 | 지금 배포된 미니PC | 새 서버(아직 없음) |
| 배포 | 직접 실행 | main push → `deploy-server.yml`·`deploy-web.yml` | `release/vX.Y.Z` 태그 → `deploy-prod.yml`(승인 후) |
| GitHub 러너 | — | `self-hosted`(상용 전 `dev` 라벨 추가) | `self-hosted, prod` |
| DB | 개발 서버 PG·CH 를 SSH 터널로(`scripts/dev-db-tunnel.sh`), Redis 만 로컬 | 개발 서버 compose DB | 상용 서버 DB(개발 데이터 이관 없음) |
| 게스트 로그인 | 켜짐 | 켜짐 | 꺼짐 |
| 모바일 앱 | 개발 앱(Metro 8082) | 개발 앱 `com.stockapp.dev` | 상용 앱 FunNote |

## 2. 설정 파일 위치

| 무엇 | 로컬 | 개발 서버 | 상용 서버 |
|---|---|---|---|
| 백엔드 env | `backend/.env.development` | 호스트 `/opt/stock_app/env/.env.production` → 배포 때 `backend/.env.production` 으로 복사 | 상용 호스트의 같은 경로(파일 이름도 같다) |
| compose 치환값(DB 비번·저장 경로) | — | `/opt/stock_app/env/compose.env` → 루트 `.env` 로 복사 | 상용 호스트의 같은 경로 |
| 웹·어드민 주소 | `web_client/.env.development`, `admin_web/.env.development`(없으면 localhost) | `docker-compose.prod.yml` 빌드 인자 | 같은 파일 — 어드민 주소는 `ADMIN_*_URL` 치환(기본 haezean, 상용은 `deploy-prod.yml` 이 funnotedaily 로 넘김, §4) |
| 웹 게스트 버튼 | vite dev 면 노출 | `deploy-web.yml` 이 `VITE_ENABLE_GUEST_LOGIN="true"` | `deploy-prod.yml` 이 `"false"` |
| 모바일 env | `mobile/.env.development` (+`.local`) | 같은 파일 + `.env.development.local` 에 haezean 주소 | `mobile/.env.production` |
| 모바일 빌드·OTA | `npm run start` | `build:android:devapk`, `ota:dev`(채널 `development`) | `build:android:prod`, `ota:prod`(채널 `production`) |

> 실제 env 파일은 모두 git 제외. 저장소에는 `backend/.env.example`, `mobile/.env.example` 만 있다.

## 3. 백엔드 변수 — 환경마다 무엇이 다른가

`backend/.env.example` 의 변수 기준. "다른 값"은 **같은 값을 재사용하지 않는다**는 뜻이다.

| 변수 | 개발 서버 | 상용 서버 |
|---|---|---|
| `DATABASE_URL`, `SYNC_DATABASE_URL`, `CLICKHOUSE_*`, `REDIS_URL` | 개발 DB | 상용 DB(비번은 `compose.env` 와 일치) |
| `JWT_SECRET_KEY` | 개발용 | **다른 값**(개발 토큰이 상용에서 통하지 않게) |
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_ADMIN_KEY` | 카카오 `stockapp-dev` 앱 | 상용 카카오 앱 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 지금 네이버 앱 | 상용 네이버 앱(검수) |
| `SOCIAL_STATE_SECRET` | 개발용 | **다른 값** |
| `SOCIAL_REDIRECT_BASE` | `https://auth.haezean.com/api/v1/auth/social` | `https://auth.funnotedaily.com/api/v1/auth/social` |
| `SOCIAL_WEB_RETURN_URL` | `https://app.haezean.com/auth/complete` | `https://app.funnotedaily.com/auth/complete` |
| `SOCIAL_APP_RETURN_URL_*` | 기본값(`stockapp-dev://auth`, `stockapp://auth`) | 기본값 |
| `SOCIAL_FAKE_PROVIDER` | 넣지 않음 | 넣지 않음 |
| `AUTH_GUEST_ENABLED` | `true` | `false` |
| `CORS_ORIGINS` | 비움(haezean 은 `backend/shared/cors.py` 기본 목록) | `https://app.funnotedaily.com,https://admin.funnotedaily.com` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | 개발용 | **다른 값**(강한 비번) |
| `PUSH_BACKEND` | 설정한 값 | `expo` (실발송) |
| `KIS_MODE`, `KIS_APP_KEY`, `KIS_APP_SECRET` | 설정한 값 | `prod` + 상용 키. KIS 토큰·호출 한도가 키 단위라 개발과 **같은 키를 동시에 쓰지 않는다** |
| `GEMINI_*`, `NAVER_SEARCH_*`, `OPENDART_API_KEY`, `KRX_*`, `FRED_API_KEY` | 설정한 값 | 상용용 키 권장(한도·사용량을 나눠 보려면) |
| `FUNDAMENTALS_Q_CUMULATIVE` | 설정한 값 | `true` — '초기 데이터 준비' 전에 넣어 둔다 |

서브도메인은 개발과 같은 구성을 가정했다: `app.`(웹) `admin.`(어드민) `auth.` `blog.` `api.`(stock GraphQL) `game.`. 상용 구성을 바꾸면 이 표도 고친다.

## 4. 상용 전환 때 haezean → funnotedaily 로 바꿀 곳

지금 바꾸면 없는 서버를 가리키므로, 상용 서버가 생길 때 한 번에 바꾼다. **개발 쪽 값(haezean)은 그대로 둔다.**

| 위치 | 지금 | 할 일 |
|---|---|---|
| `mobile/.env.production` `EXPO_PUBLIC_*_URL` | haezean | funnotedaily 로 교체(preview 빌드도 이 파일을 쓴다) |
| `docker-compose.prod.yml` `admin_web` 빌드 인자 `VITE_*` | `${ADMIN_*_URL:-haezean}` (2026-11-12) | ✅ 완료 — `deploy-prod.yml` 이 `ADMIN_API_BASE_URL`·`ADMIN_AUTH_BASE_URL`·`ADMIN_STOCK_API_URL`·`ADMIN_GAME_API_URL` 을 funnotedaily 로 넘긴다. 서버에서 손으로 빌드할 때는 같은 4개를 `compose.env` 에 넣는다 |
| `web_client` 빌드 인자 | 같은 도메인 프록시(`/_api/…`) | 바꿀 것 없음 — 웹은 자기 도메인으로만 요청 |
| 상용 `.env.production` | — | §3 의 상용 값 |
| `backend/shared/cors.py` 기본 목록 | haezean 만 | 코드 변경 없이 상용 서버 `CORS_ORIGINS` 로 추가 |
| Cloudflare | haezean 터널 | 상용 서버에 **별도 터널**, funnotedaily 서브도메인만 연결 |

## 5. 외부 콘솔 — 환경별로 따로

| 콘솔 | 개발 | 상용 |
|---|---|---|
| 카카오 디벨로퍼스 | `stockapp-dev` 앱, Redirect `auth.haezean.com/...` | 상용 앱, Redirect `auth.funnotedaily.com/...` |
| 네이버 개발자센터 | 지금 앱(테스트 계정만) | 상용 앱(검수) |
| Cloudflare | haezean 존·터널 | funnotedaily 존·상용 터널 |
| EAS(Expo) | 채널 `development` | 채널 `production`, 첫 빌드 때 서명 키 백업 |
| 도메인 등록 업체 | haezean.com | funnotedaily.com(2단계 인증·자동 갱신·잠금) |

## 6. 지키는 규칙

- 개발과 상용은 키·비밀값을 **공유하지 않는다**. 한쪽이 새도 다른 쪽은 안전해야 한다.
- 상용 값은 상용 서버 파일과 GitHub Environment `production` 에만 둔다. 저장소·채팅·문서에 적지 않는다.
- env 를 바꾼 뒤에는 컨테이너가 새로 떠야 반영된다(개발: Deploy Server 수동 실행, 상용: 같은 태그 재배포).
