# 11. 용어집 · FAQ

## 용어집 (가나다·ABC 순 아님 — 자주 나오는 순)

| 용어 | 쉬운 뜻 | 이 프로젝트 예 |
|---|---|---|
| 백엔드 / 프론트엔드 | 서버 쪽 / 화면 쪽 | `backend/` / `web_client`, `admin_web`, `mobile` |
| API | 화면이 서버에 요청하는 약속된 형식 | `POST /api/v1/blogs/12/comments` |
| 엔드포인트 | API 주소 하나 | `GET /api/v1/boards` |
| 마이크로서비스(MSA) | 기능별로 쪼갠 작은 서버들 | auth, blog, stock_api, trading_game |
| 포트 | 한 컴퓨터 안에서 프로그램을 구분하는 번호 | 8000~8004, 3000, 5173 |
| FastAPI | 파이썬 API 서버 프레임워크 | 모든 백엔드 서비스 |
| uvicorn | FastAPI 앱을 띄우는 실행기 | `uv run uvicorn apps.blog.main:app` |
| uv | 파이썬 패키지·가상환경 관리 도구 | `uv sync`, `uv run` |
| 가상환경(venv) | 프로젝트별 파이썬 패키지 상자 | `backend/.venv` |
| 라우터(Router) | URL 별 입구 함수 모음 | `apps/blog/routers/` |
| 서비스(Service) 레이어 | 업무 규칙 코드 | `apps/blog/services/` |
| 리포지토리(Repository) | DB 읽기/쓰기 전담 코드 | `apps/blog/repositories/` |
| 스키마(pydantic) | 요청/응답 JSON 모양 정의 | `apps/blog/schemas.py` |
| 의존성 주입(Depends) | FastAPI 가 필요한 것을 미리 준비해 넣어 줌 | `Depends(get_db)` |
| ORM / SQLAlchemy | DB 테이블을 파이썬 클래스로 다루는 도구 | `shared/models.py` |
| 마이그레이션 / Alembic | DB 테이블 변경 이력과 적용 도구 | `backend/alembic/versions/` |
| PK / FK | 기본키(고유번호) / 외래키(다른 테이블 가리킴) | `blog_comments.post_id` |
| 멱등(idempotent) | 여러 번 해도 결과가 같음 | ClickHouse 재수집, `clickhouse_schema` |
| `FINAL` | ClickHouse 에서 중복 정리된 최신 행만 보기 | `daily_prices FINAL` |
| 캐시 | 자주 쓰는 값을 빠른 곳에 잠시 보관 | Redis |
| 브로커 | 작업 메시지 우체통 | Redis (Celery) |
| Celery worker / beat | 백그라운드 일꾼 / 알람시계 | `apps/collector/celery_app.py` |
| Pub/Sub | 발행하면 구독자 모두에게 전달 | `stock:tick:*`, SSE 알림 |
| REST / GraphQL | 주소별 API / 한 주소에서 골라 받는 API | blog / stock_api `/graphql` |
| WebSocket | 계속 열린 양방향 연결 | 게임 실시간 시세 |
| SSE | 서버 → 브라우저 일방향 실시간 | 새 글 알림 |
| JWT / Bearer 토큰 | 서버가 서명한 로그인 출입증 / 헤더에 붙이는 방식 | `Authorization: Bearer …` |
| 리프레시 토큰 | 출입증을 새로 받는 교환권 (앱만) | `POST /api/v1/auth/refresh` |
| OAuth / PKCE | 카카오·네이버 로그인 표준 / 가로채기 방지 장치 | `apps/auth/social/` |
| CORS | 브라우저가 다른 도메인 호출을 허락받는 규칙 | `shared/cors.py` |
| 환경변수 / `.env` | 코드 밖에서 주입하는 설정값 / 그 파일 | `backend/.env.development` |
| `VITE_*` / `EXPO_PUBLIC_*` | 웹 / 앱 빌드 때 번들에 박히는 공개 설정 | API 주소 |
| Docker / 컨테이너 / 이미지 | 프로그램을 통째로 포장해 어디서나 실행 / 실행 중인 것 / 포장본 | `docker-compose.*.yml` |
| docker compose | 여러 컨테이너를 한 파일로 같이 실행 | dev: DB 3종, prod: 전체 |
| Docker Swarm | 컨테이너 무중단 교체·확장 도구 | `deploy/swarm/` |
| CI/CD / GitHub Actions | 자동 빌드·배포 / 그 도구 | `.github/workflows/` |
| self-hosted 러너 | 우리 서버(미니PC)에서 도는 Actions 실행기 | |
| Cloudflare Tunnel | 포트 개방 없이 외부 요청을 내부 서버로 | `*.haezean.com` |
| 헬스체크 | 살아 있는지 확인하는 주소 | `/health`, `/ready` |
| Expo / EAS | 앱 개발 도구 / 그 클라우드(빌드·업데이트) 서비스 | `mobile/eas.json` |
| 개발 빌드(dev build) | 개발용 네이티브 앱 (Expo Go 대신) | `com.stockapp.dev` |
| OTA | 스토어 없이 JS 만 업데이트 | `npm run ota:prod` |
| fingerprint / runtimeVersion | 네이티브 구성 지문. 다르면 OTA 를 안 받음 | `app.config.js` |
| KIS | 한국투자증권 Open API | `apps/collector/kis/` |
| OHLCV | 시가·고가·저가·종가·거래량 | `daily_prices` |
| 일봉 / 분봉 / 틱 | 하루 / 1분 / 체결 1건 단위 가격 | |
| UN / J / NX | KIS 시장 구분: 통합 / KRX / 넥스트레이드 | UN 먼저 → 비면 J |
| 이동평균(MA) / 정배열 | N일 평균가 / 단기 > 장기 순으로 정렬된 상태 | MA5·20·50·120 |
| CANSLIM | 성장주 선별 기법 (화면 이름 '주도주') | `apps/collector/canslim/` |
| 스크리너 | 조건으로 종목 찾기 | `apps/collector/screener/` |
| 백필 | 과거 데이터를 한꺼번에 채우기 | `backfill_all_daily(months=14)` |
| 시즌 / 정산 | 게임 기간 / 기간 종료 시 강제청산·순위 확정 | `settle_trading_season` |

## FAQ

**Q. 처음 받았는데 어디서부터 봐야 하나요?**
[README](./README.md) 의 순서대로 1→2장을 먼저 하고, 실제로 화면을 띄운 다음 3장부터 코드로 들어간다.

**Q. 코드 수정 후 서버에 반영하려면?**
`feature/…` 브랜치에서 작업 → `dev` 에 머지 → `main` 으로 fast-forward push → 바뀐 폴더에 맞는 워크플로가 자동 배포. ([10장](./10-deploy-ops.md))

**Q. DB 테이블에 컬럼을 추가하고 싶어요.**
`shared/models.py` 수정 → `uv run alembic revision --autogenerate -m "설명"` → 생성 파일 검토 → `uv run alembic upgrade head` → 커밋. 운영은 배포 때 자동 적용. ([5장](./05-database.md#5-4-테이블-바꾸기--alembic-마이그레이션))

**Q. 로컬에서 DB 를 바꿨는데 개발 서버 데이터가 바뀌었어요!**
`backend/.env.development` 가 터널 포트(15432/18123)를 보고 있으면 로컬 명령이 개발서버 DB 에 그대로 실행된다. 로컬 전용으로 쓰려면 5432/8123 으로 바꾸고 `docker-compose.dev.yml` 을 켠다.

**Q. 관리자 비밀번호를 잊었어요 (로컬).**
`uv run python -m apps.auth.seed_admin` — `.env` 의 `ADMIN_EMAIL`/`ADMIN_PASSWORD`(기본 `admin@stock.app`/`admin1234`)로 계정을 만들고, 이미 있으면 비밀번호를 그 값으로 다시 설정한다. 운영 DB 에 돌릴 때는 운영 env 값이 적용되니 주의한다.

**Q. 차트가 나오는데 실제 주가와 달라요.**
ClickHouse 에 그 종목 데이터가 없으면 stock_api 가 **가짜(시드) 캔들**을 보여 준다. KIS 키를 설정하고 백필한다. ([7장](./07-batch-celery.md))

**Q. 게임 주문이 '거래 시간이 아니에요' 로 막혀요.**
정상이다. 거래일 09:00~15:30, 16:00~20:00(KST)에만 주문된다. 로컬 주말 테스트는 `TRADING_DAYS=ALL`, `TRADING_WINDOWS=00:00-23:59`, `MOCK_TICK_STREAM=true` 를 쓴다(README 트레이딩 게임 절).

**Q. 앱만 고쳤는데 스토어에 다시 올려야 하나요?**
JS/TS 코드만 바뀌었으면 OTA, 네이티브가 바뀌었으면 새 빌드. ([9장 9-6](./09-mobile.md#9-6-새-빌드-vs-ota--가장-중요한-판단))

**Q. 비밀번호·API 키는 어디에 있나요?**
Git 에는 없다. 로컬은 각자의 `backend/.env.development`, `mobile/.env.*`. 운영은 미니PC `/opt/stock_app/env/.env.production`. 인수인계 시 **별도의 안전한 경로(비밀번호 관리자 등)** 로 전달받는다.

**Q. 기능 설계 의도를 알고 싶어요.**
`docs/superpowers/specs/`(설계)와 `docs/superpowers/plans/`(작업 계획)에 날짜별로 남아 있다. 파일 이름으로 기능을 찾는다. 앞으로의 계획은 [`docs/ROADMAP.md`](../ROADMAP.md).

**Q. AI(Claude 등)로 작업할 때 규칙은?**
루트 `CLAUDE.md` 에 프로젝트 규칙(한국어, 레이어 분리, 기존 기능 보존, README 갱신, KIS 수집 규칙)이 있다. 사람도 같은 규칙을 따른다.

이전: [10. 배포·운영](./10-deploy-ops.md) · 처음으로: [학습 가이드 목차](./README.md)
