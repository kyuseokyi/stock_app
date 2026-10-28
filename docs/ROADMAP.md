# Stock App 로드맵 & 진행 현황

> 최종 업데이트: 2026-10-28

한국투자증권 API 기반 주식 데이터 파이프라인 + 블로그/커뮤니티 + 관리자/유저 웹/모바일 풀스택 모노레포의 진행 현황과 향후 단계.

---

## ✅ 완료된 작업

### 인프라 / 아키텍처
- [x] Docker DB 3종 (PostgreSQL 5432 · Redis 6379 · ClickHouse 8123) — `docker-compose.dev.yml`
- [x] 백엔드 MSA(모듈러 모놀리식): `auth`(8001) · `blog`(8000) · `stock_api`(8002) · `collector`(Celery) + `shared`
- [x] FastAPI + async SQLAlchemy + Alembic, `uv` 관리, 서비스 간 공유 JWT_SECRET

### 인증
- [x] 관리자 로그인(JWT, bcrypt) + 관리자 시드(`admin@stock.app`)
- [x] 임시 게스트 로그인 `POST /auth/guest` (닉네임 → FREE 유저 upsert) — 이후 OAuth로 스왑 가능

### 블로그 (백엔드 + 어드민)
- [x] 게시판/게시글/댓글 CRUD
- [x] 게시판별 댓글 on/off 토글 (`comments_enabled`)
- [x] TipTap 리치 에디터, 반응형 레이아웃 + 사이드바
- [x] **admin_web TypeScript(strict) 전환** — 24개 파일, 백엔드 스키마 기반 DTO 타입(`src/types/`), build에 `tsc --noEmit` 포함. 트랜스파일 결과 동일성 검증 + 브라우저 스모크 통과
- [x] 새 글 실시간 알림: 웹 SSE(Redis pub/sub) + 모바일 Expo 푸시(관리자가 고른 글만, 2026-10-21 이전)

### 주식 API (stock_api, GraphQL)
- [x] `searchStocks`(국내외/지수 통합검색) · `getChartData`(온더플라이 시드 데이터)
- [x] 지표: MA5/20/50/120, 정배열/역배열, 볼린저(σ 가변), 매물대(Volume Profile)

### 어드민 차트 삽입 (핵심 기능)
- [x] 종목 검색 → 기간 → 실차트 렌더 → `getDataURL` 캡처 → 본문 삽입
- [x] 가격축 우측 · 매물대 좌측 · 볼린저 실선 · σ 숫자입력 · 매물대 표시 토글
- [x] 드로잉 4종(수평선/이중추세선/사각형/텍스트) + ESC 취소, 데이터좌표 기반 캡처 포함
- [x] **차트 삽입 화면 lightweight-charts 전환 + 드로잉 개편** — 수평선 이동, 2중추세선(첫 선 가운데 축 회전·두 번째 선 회전·거리, 기준선·대칭선 따로 조절, 가운데 연결 점선·완성 후 중심선(분홍, MA20과 구분), 참조 영상 방식으로 가운데가 커서 따라 평행 이동) (2026-10-25~26)

### web_client (일반 유저 웹)
- [x] 블로그 조회(목록/상세/댓글) + SSE 토스트
- [x] 임시 로그인(닉네임) + 댓글 작성
- [x] **토스 디자인 언어 적용** + 2단 네비(커뮤니티·게임), `/game` "시즌 준비 중" 스켈레톤, 공통 UI(`src/components/ui/` Button·Card·Chip·EmptyState)
- [x] 홈 추천글(featured) — 관리자 큐레이션 글을 홈 상단 노출

### 모바일 앱 (Expo) — 토스 토대
- [x] **토스 디자인 전체 통일**(`docs/mobile_design_language.md`) + 네비 재편(하단 4탭: 홈/블로그/게임/내정보), `/game` 빈 상태 스켈레톤(웹과 동일 문구). Unistyles v3.

### 트레이딩 게임 (Trading Game)
- [x] **Phase 1 — DB 스키마** : 핵심 6테이블(seasons/accounts/positions/trades/hall_of_fame/coach_messages) SQLAlchemy+Alembic, 무결성 제약, 멱등 시드(시즌1기 005930 ACTIVE). 유저 FK=Integer, 게임 PK=UUID(GUID TypeDecorator)
- [x] **Phase 2 — 실시간 WS 수집 데몬** : KIS `H0STCNT0` 파서 + async WS 클라이언트(approval_key·재연결·무효키 재발급) + Mock 생성기 → Redis `stock:tick:{ticker}` 발행(`apps/collector/run_game_ws.py`). Mock E2E 검증
- [x] **Phase 3 — 가상 주문/체결 엔진 + WS 게이트웨이** : 독립 앱 `apps/trading_game`(포트 8003, 단일워커). 원클릭 진입(LONG/SHORT·레버리지 1/2/5·비중 25/50/100%) → 현재가 즉시체결, 틱마다 TP/SL/마진콜 자동청산, WS로 틱·개인손익·시장심리 push. 이중 게이트(거래세션창+신선도), 조건부청산 동시성, 원금손실 클램프, 계좌 집계 갱신. publisher가 `stock:latest` 최신가 캐시 기록. 85 pytest green
- [x] **Phase 4 — 실시간 랭킹 + 시즌 정산 + Trading MBTI** : Redis ZSET Top100(라이브 ROI 매 틱 + 청산 실현 ROI) + `/leaderboard`·`/my-rank`·`/hall-of-fame` REST. Celery beat 매일 20:40 → 말일 ClickHouse 당일 종가로 전액 강제청산 → 명예의 전당 박제(+MBTI 4분류) → FINISHED+차기시즌 원자적 생성(멱등). 101 pytest green. 최종리뷰 치명결함 2건(HOF 닉네임 스키마·async 엔진 dispose) 수정
- [x] **Phase 5a — 데일리 스마트 코치 + 스마트 넛지** : 코치 슬롯 초안/발행(`status`, 마이그레이션 `c3d4e5f6a7b8`) + 관리자 REST·유저 `/coach/today` + 발행 WS push. admin_web `/game/coach`(TS, 마크다운 미리보기 DOMPurify). 넛지 3종(과열 추격·과레버리지·원칙 손절) REST `nudges[]` + 자동청산 WS(fan-out 큐), Wilder RSI(14) 일일 캐시. 모두 best-effort. 통합 스모크(일회용 PG) 통과 · 시드 published_at 회귀 수정

### 문서
- [x] 기능별 설계 스펙(`docs/superpowers/specs/`)
- [x] README 작업 재개(Resume) 가이드 & 환경 점검

---

## 🔜 향후 단계 (로드맵)

### Phase 1 — 데이터 파이프라인 (실데이터 기반)
> stock_api의 온더플라이(가짜)를 실데이터로 교체하는 기반. 스크리너·실차트의 전제.

**(a) 수직 슬라이스 — 005930 국내 일봉 [완료 ✅ 2026-07-21]**
- [x] KIS OpenAPI Custom Client (`requests` 동기 + OAuth 토큰 Redis 공유 캐시, 5xx만 재시도)
- [x] 국내 일봉 수집(수정주가, **시장코드 UN=KRX+넥스트레이드 통합** → MTS 차트와 값 일치) → MA5/20/50/120 → ClickHouse 멱등 적재(`ReplacingMergeTree`)
- [x] Celery 태스크 `collector.collect_daily_ohlcv`(겹침창 today-30d~+2d) — 멱등 검증
- [x] stock_api `getChartData` 하이브리드(수집종목=CH, 나머지=온더플라이)

**(b) 확장 — 다음 슬라이스**
- [x] 국내 전종목 루프 + 레이트리밋 + 실패격리 `collector.collect_all_daily` — 마스터 소스 무관 설계(`stock_master`), 종목별 try/except 격리, fallback 20종목 검증(18적재·상폐종목 무시)
- [x] 전종목 마스터 로더 — KRX `.mst` 다운로드/파싱(`kis/master.py`) + fallback. 매 수집마다 재로드해 신규상장/상폐 자동반영. `STOCK_MASTER_SOURCE=mst|fallback|auto`
- [x] Celery beat 스케줄 — 매일 20:30(NXT 애프터마켓 종료 후) `collect_all_daily` 자동 수집
- [x] 과거 백필(청킹 수집) `collector.backfill_domestic_daily` — 전체 시계열 MA 일괄계산(MA120 정합), 005930 14개월 검증(291행·MA120 172행)
- [x] 전종목 백필 확장 `collector.backfill_all_daily`(레이트리밋 적용) — 로컬 실행 검증(3,926종목·107.6만행·MA120 61.8만행)
- [x] `.mst` 실환경 검증 — URL 정정(dws.co.kr) + **UN 빈응답 시 J 폴백**(NXT 미상장 종목 누락 해결, 608→3,926종목)
- [x] worker+beat 가동(매일 20:30 자동수집) + ClickHouse 백업/복원 스크립트(`docs/deployment/`)
- [x] 차트 지표 lookback 버퍼 — 짧은 구간 뷰에서도 MA120 표시(`getChartData`)
- [x] **종목 마스터 `stock_meta` 일원화** — `.mst`→stock_meta 동기화(상폐 is_active=false), collector 수집대상·stock_api 검색/차트해석이 단일 마스터 사용. 미국/지수는 seed 하이브리드 유지(`shared/stock_meta_repo.py`)
- [x] **전종목 수집 병렬화** — 스레드 `KIS_WORKERS`(4) + 공유 레이트리밋(HTTP 요청마다, prod 15/s) + 공유 쿨다운. 가짜 KIS 시뮬레이션 100종목 45.7→12.2초, 전종목 추정 ~35분→~9분(배포 후 로그로 확인). 매일 수집이 MA50/120 을 None 으로 덮어쓰던 문제도 수정(직전 119종가 이어 계산) (2026-10-17)
- [x] **시장 데이터 수집 기반(스크리너 프로젝트 1)** — 종목 프로필(.mst 업종·시총·상태)·KIS 테마(+관리자 보정 API)·지수(국내 3·미국 6·원/달러·대표 종목)·투자자별 순매수·재무비율(EPS·ROE)·공모주 일정·FRED 거시 지표. 스펙 `docs/superpowers/specs/2026-10-18-market-data-foundation-design.md`, 계획 `docs/superpowers/plans/2026-10-18-market-data-foundation.md` (2026-10-18). 실제 KIS·FRED 첫 호출은 배포 후 확인(`pending_checks.md`), FRED 키 미발급. 다음: 프로젝트 2 CANSLIM, 프로젝트 3 주달 화면
- [ ] 미국 개별 주식 + 미국 CANSLIM — 종목 마스터·일봉·재무 출처(KIS 미확인 → SEC EDGAR 등) 조사 포함. 사용자 결정 2026-10-18: 미국은 지표 우선, 개별 주식은 다음
- [x] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용) — `daily_prices` 대신 별도 테이블 `screener_daily`(배열·매물대 위쪽 비율·RSI·골든크로스·신고가·재무 배수), 2026-10-21

### Phase 2 — 스크리너
- [x] **CANSLIM 스크리너(프로젝트 2)** — 7항목 판정·점수 매일 사전 계산(`canslim_daily`), GraphQL `canslimMarket·canslimScreen·canslimScore`, 웹 `/screener`(시장 방향·필터·목록·차트·점수표·추이). C 는 `FUNDAMENTALS_Q_CUMULATIVE=true` 로 켬(2026-10-22 실측: KIS 분기 EPS 누적, 운영 적용 완료). 스펙 `docs/superpowers/specs/2026-10-18-canslim-design.md` (2026-10-18). 앱 화면은 2026-10-21(모바일 '주도주' 칩·종목 상세)
- [x] **스크리너 탭 — 시장·테마·업종·일정(프로젝트 3, 주달 화면)** — 메뉴 '스크리너' 안 탭(시장·테마·업종·일정·주도주), 종가 기준 하루 1회 사전 계산(`market_stock_daily`·`market_group_daily`) + 관리자 테마 보정 시 최신일 재계산, 테마/업종 순위·트리맵(시총/거래대금)·상세(순위 추이·대장주)·일정(공모주·경제지표), CANSLIM 탭 이름 '주도주'. 스펙 `docs/superpowers/specs/2026-10-19-market-dashboard-design.md` (2026-10-19). 다음: 관리자 테마 보정 UI, 뉴스·AI 요약(네이버 키·Ollama), 앱 화면
- [x] 관리자 테마 보정 UI(admin_web) — `MarketThemes.tsx`(시장 지표 목록·정렬·숨김, 이름·설명 수정, 종목 검색 추가·제외·복구)
- [x] 차트 패턴(컵·컵핸들·쌍바닥·플랫 베이스·박스권·HTF)·베이스 카운트·돌파 리포트 — 참고 v2 엔진 일봉 이식, `chart_pattern_daily`, GraphQL `patternScreen·patternBases`, 웹 '패턴' 탭·앱 '패턴' 칩·종목 상세 영역. 스펙 `docs/superpowers/specs/2026-10-22-chart-patterns-design.md` (2026-10-22). 일봉 37개월 백필 후 실데이터 검증·실기기 확인 대기. 주봉 패턴·국내 기준값 보정은 다음
- [x] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합) — GraphQL `screenerScreen`(2026-10-21)
- [x] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무) — 웹 '조건검색' 탭·앱 '조건검색' 칩, 스펙 `docs/superpowers/specs/2026-10-21-screener-presets-design.md` (2026-10-21). 운영 백필·프리셋 건수 점검 완료(2026-10-22, 관리자 수동 실행 버튼 포함). 연간 재무는 결산이 끝난 해만 사용(KIS 최신 행=진행 중인 해 누적). 실기기 확인 대기. 배당수익률·MACD·저장 필터는 범위 밖
- [x] 결과 카드 UI + 정렬, 차트 상세(웹 스플릿뷰) — 조건검색·주도주 탭에서 구현(2026-10-21)
- [x] **주도주 '오늘 볼 10개' 결론 카드** — 주도주 점수 상위 + 피벗 근처 종목을 10개로 추려 탭 맨 위에 표시, 웹·앱 같은 규칙(2026-10-23)
- [x] **조건검색·패턴 탭 관리자 스위치** — `screener_features`(행 없으면 숨김, 마이그레이션 `5c1e9a7d3b20`), 관리자 REST `/api/v1/admin/screener/features`·공개 GraphQL `screenerFeatures`, admin '시장 데이터 → 스크리너 탭', 꺼지면 웹·앱 메뉴에서 빠지고 주소 직접 진입은 주도주로. 현재 운영 두 탭 숨김(2026-10-24)
- [ ] 숨긴 조건검색·패턴 탭 다듬은 뒤 관리자 스위치로 공개
- [ ] 뉴스·AI 요약(주달) — 네이버 검색 Open API 키 발급 필요

### Phase 3 — web_client 확장
- [x] 토스 디자인 + 2단 네비 + 게임 스켈레톤 (위 완료 섹션 참조)
- [x] 종목 상세/차트 화면 — `/stock/:ticker`(종목 검색창·헤더(이름·종가·주도주 점수)·일봉 6개월/1년/3년(50일선·52주 고점·현재 패턴 피벗/매수/손절 선)·차트 패턴(현재 베이스·이력)·주도주 7항목·점수 추이), 스크리너 상세 패널·테마/업종 구성 종목의 '종목 상세 보기' 연결, 주도주 대상이 아닌 종목(ETF 등)은 검색으로 이름 표시. 부품은 스크리너 패널과 공유(`CanslimParts`·`PatternParts`·`lib/patternOverlay`), 검색 쿼리 계약 테스트 `test_stock_search_contract.py` (2026-10-22). 사용자 차트 드로잉은 범위 밖(앱 드로잉과 함께)
- [x] 간편 로그인(카카오·네이버) — auth 백엔드 콜백 + 일회용 교환 코드, web 버튼·`/auth/complete`, 모바일 인앱 브라우저 세션(dev 스킴 `stockapp-dev`), 게스트 로그인은 개발용 플래그(2026-10-13). 개발 서버 카카오 키 적용·**웹·앱 카카오 로그인 성공 확인(2026-10-23)**. 남은 확인: 네이버 키 발급 후 웹·앱(검수 전 테스트 계정), 공식 버튼 디자인(로고 파일 대기)
- [x] 회원 탈퇴 — auth `DELETE /api/v1/auth/me`, 즉시 삭제 + 명예의 전당·주간 기록 익명화, Redis 랭킹 정리·카카오 연결 끊기(2026-10-14, 백엔드)
- [x] **중복 로그인 처리(플랫폼별 단일 세션)** — web 1 + app 1(+admin) 유지, 같은 플랫폼 재로그인 시 이전 기기 401·게임 WS 즉시 끊기·안내, 시작·복귀 시 `/auth/me` 확인 (2026-10-16, 스펙 `docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md`). 앱은 새 빌드 필요
- [x] ~~게스트→소셜 계정 이관~~ — 불필요(게스트=개발용, 운영 미노출)
- [ ] 애플 로그인(iOS 출시 직전)

### Phase 4 — 모바일 앱 (Expo) *(토스 토대·네비 완료)*
- [x] 앱 셋업 — Expo SDK 57/RN 0.86, **Unistyles v3** 테마(상승=빨강/하락=파랑, adaptiveThemes), zustand. `app.config.js` dev/prod 앱이름·bundleId 분리, `eas.json` 프로필, `EXPO_PUBLIC_*` env 분리
- [x] **토스 디자인 전체 적용 + 네비 재편** — 하단 4탭(홈/블로그/게임/내정보, 스크리너·관심종목 탭 제거), 블로그(목록/상세/댓글)·홈 추천글·게임 스켈레톤 동작. 에뮬레이터 육안 검증 완료
- [x] 스크리너 탭 — 하단 탭 '스크리너'(시장·테마·업종·일정 칩, 그룹 상세, 상단 "실시간 시세 아님" 안내)
- [x] 주도주(CANSLIM) 칩 + 범용 종목 상세 `/stock/[ticker]`(점수표·일봉 50일선·52주 고점·점수 추이, 테마·업종 구성 종목에서도 진입) — 2026-10-21, 설계 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md`. 실기기 확인 대기
- [x] 조건검색 칩(프리셋·필터 바텀시트·무한 스크롤, 행 → 종목 상세) — 2026-10-21. 실기기 확인 대기
- [x] **웹 화면 반영(모바일)** — 시장 칩 묶음(국내 증시·밤사이 미국 증시·돈의 흐름·미국 경제지표), 스크리너 칩 두 묶음(시장 / 종목 찾기), 차트 선 이름 범례, 게임 비로그인 카드, 문구 정리(2026-10-24). 실기기 확인 대기
- [ ] 차트 드로잉(앱)
- [x] 실제 푸시 — Expo Push(→FCM/APNs) 발송기, 펀드 리포트 알림·새 글 알림 적용(2026-10-21). 새 글은 push_devices.post_notice·내정보 스위치
- [x] 앱 리프레시 토큰 — 앱 접근 토큰 60분·리프레시 30일(해시 저장·회전·재사용 감지·30초 유예), 서버 로그아웃, 401 사유 코드(TOKEN_EXPIRED·SESSION_ENDED 등), 게임 WS 만료 시 갱신 후 재연결, 세션 종료 시 열린 WS 닫기. 웹·관리자는 12시간 그대로. 설계 `docs/superpowers/specs/2026-10-22-mobile-refresh-token-design.md` (2026-10-22). 실기기 확인 대기
- [x] 앱 업데이트 관리 — 관리자 '앱 버전 & 업데이트'(스토어 강제·권장, OTA 무음·선택·필수, 점검 모드), 공개 `GET /api/v1/app/version-check`(blog), 앱 expo-updates(fingerprint runtimeVersion·채널 헤더·수동 확인)·모달 5종, OTA 발행 `npm run ota:dev|preview|prod`. 명세 `docs/app_update_management_spec.md` (2026-10-22). APK 재빌드·실기기 확인 대기, iOS 스토어 링크는 출시 후 교체

### Phase 5 — 실시간 트레이딩 게임 (Trading Game) & 에듀테인먼트
> 마스터 기획·단계 프롬프트 확정(`docs/trading_game_plan.md`, `docs/prompts/trading_game/`). 6개 서브페이즈로 분해.
- [x] **기획 1달 1종목 고정 시즌제 & 가상 1,000만 원** (기획 확정)
- [x] **서브페이즈 1 — DB 스키마** (완료, 위 참조)
- [x] **서브페이즈 2 — 한투 실시간 WebSocket 수집 데몬(`H0STCNT0`) + Redis Pub/Sub 발행** (완료, 위 참조)
- [x] **서브페이즈 3** — 클라이언트 WS 게이트웨이(틱 중계) + 원클릭 즉시 체결(롱/숏, 레버리지 1x/2x/5x, TP/SL·마진콜 자동 청산) ✅ (위 완료 섹션 참조, 포트 8003)
- [x] **서브페이즈 4** — Redis ZSET 기반 실시간 랭킹(Top 100) & 말일 명예의 전당 아카이빙(시즌 정산 스케줄러) + Trading MBTI ✅ (위 완료 섹션 참조)
- [x] **서브페이즈 5a** — 관리자 데일리 스마트 코치(모닝 시황/지지·저항선 + 이브닝 복기) via `admin_web` + 인게임 스마트 넛지 ✅ (위 완료 섹션 참조)
- [x] **서브페이즈 5b** — 단계별 퀘스트·보상, 아카데미(5x 레버리지 해금 퀴즈), 야간/주말 10초 차트 패턴 퀴즈 + Streak (2026-10-12 완료: 퀘스트 Q1·Q2·Q3', 아카데미 5배 잠금, 야간 퀴즈·자동 생성, Streak, 기능 플래그)
- [x] **서브페이즈 6** — 프론트(web_client·mobile) 실시간 트레이딩 화면. 6a/6b/6c 분할 (2026-10-13 완료)
  - [x] **6a** web 트레이딩 코어(헤더·코치 배너·심리 바·일봉+실시간 차트·주문/포지션·넛지) + `GET /api/game/seasons/active` (2026-10-13)
  - [x] **6b** web 모달 — 랭킹/명예의전당(MBTI)·퀘스트·아카데미(5x 해금)·야간 퀴즈·Streak (2026-10-13)
  - [x] **6c** 모바일(Expo) 동일 기능 — 순수 View 캔들 차트·RN Modal 시트·AppState WS (2026-10-13)
  - [x] **앱 게임 차트를 웹과 같은 lightweight-charts(WebView)로 교체** — `chart-web/`(번들 생성 스크립트 `mobile/scripts/gen-lwc-bundle.js`·차트 페이지)·`lib/chart-bridge.ts`·`components/tv-chart.tsx`, 데이터 로드·캐시·틱은 기존 유지. 퀴즈 차트는 순수 View 유지. 실기기 확인 (2026-10-15)
  - [x] **웹 게임 화면 반응형 주문 패널** — lg 이상은 오른쪽에 따라다니는 패널(2단), 그 외는 하단 고정 바 (2026-10-15)
  - [x] **웹 로그인 만료 처리** — 블로그·게임 REST 401, 게임 WS 4401 이면 `expireSession` 으로 로그아웃(헤더 닉네임이 남던 문제) + 만료 토스트 1회. 거부된 토큰이 현재 토큰일 때만 처리 (2026-10-15)
  - [x] **차트 공통 개선(웹·앱)** — 일봉 왼쪽 스크롤로 과거 캔들 이어 보기(`getChartData realOnly`), 보이는 구간 기준 매물대(좁은 화면 넓고 진하게), 앱 차트 WebView 페이지 스크립트 TS 전환 (2026-10-25~27)
  - [x] **차트 게임 지지·저항·대응** — 수동 청산 사유 익절·손절 구분(`MANUAL_TP/SL`), 손익에 따라 익절/손절 버튼, 지지·저항 터치·돌파·이탈 알림 시트(익절·손절·홀딩). 지지·저항 = 매물대 POC·5일선·20일선(=BB 중심)·BB 상단·하단 + 현재가 바로 위·아래 전고점·전저점, 마지막 캔들 **몸통**이 닿으면 차트 전체 폭 가로선, 알림에 선 이름. 설계 `docs/superpowers/specs/2026-10-27-chart-game-sr-actions-design.md`·`2026-10-27-chart-game-sr-trendlines-design.md` (2026-10-27~28, 운영 배포 deploy/2026-10-28-1·2)
  - [x] **부분 익절·원금 회수** — 수익 중일 때 ½ 절반 익절·원금 회수(돌려받는 돈 = 원금, 남은 평가금 = 수익), 경쟁 상태 방지(size_amount 조건부 UPDATE), 거래 수·승률은 포지션당 1회(합계 손익으로 승패), MBTI 부분 기록 제외, 규칙 API `partial_close` 로 버튼 노출. 설계 `docs/superpowers/specs/2026-10-28-game-partial-take-profit-design.md` (2026-10-28, 운영 배포 deploy/2026-10-28-3). **앱 OTA 발행 대기**
  - [x] **버그: 앱 게임 일봉 이동평균이 짧게 그려짐** — 일봉을 180일만 받아 60일선이 화면 중간부터 시작 → 웹과 같은 280일(앞쪽은 지표 워밍업) (2026-10-28)
  - [x] **앱 로그인 안내 바텀시트** — 게임 탭 비로그인 안내를 OS 기본 Alert 대신 `ui/BottomSheet` 로(디자인 언어 "바텀시트 우선") (2026-10-15)

### 상시 백로그
- [x] **주간 랭킹** — 월 09:00 KST 시작·시즌 경계로 잘림, 주간 ROI=NAV 비율, 월 08:50 마감(Top 10 기록·1~3위 50/30/20만 보상), web·모바일 주간 탭+보상 토스트 (2026-10-13)
- [x] **시즌 기간 선택(월간/분기)·월간 랭킹·보상 금액 admin 설정** — 다음 시즌 기간 admin 선택, 분기 시즌 월간 랭킹(매월 1일 08:55 마감·1~3위 보상), 주간·월간·출석 보상 금액 `game_settings`, 정산 종가 주말·휴장 보완 (2026-10-14)
- [ ] 지인 리그(Private League) — 백엔드(리그 생성·초대코드·리그 랭킹) + UI. 서브페이즈 6 범위에서 제외 · **보류**(사용자 결정 2026-10-13)
- [x] 이중추세선 조작 방식 재정의 — 참조 영상 방식(가운데가 커서 따라 평행 이동, 기준선·대칭선 각각 조절) (2026-10-26)
- [ ] **네이버 증권 테마·뉴스 크롤링 — 추후 확인**(사용자 결정 2026-10-18). `finance.naver.com/robots.txt` 가 `Disallow: /`(전체 수집 거부)라 보류. 다시 검토할 때 확인: 약관·허용 경로 변경 여부, 차단 위험, 출처 표기. 그 전까지 주달 기능은 공식 경로만(테마=KIS `theme_code.mst`+관리자 보정, 업종=`.mst`/`idxcode.mst`, 뉴스=네이버 검색 Open API, 일정=KIS 예탁원 API) — 기획 `docs/joodal_curation_service_plan.md`
- [ ] 테스트(pytest / Vitest / Playwright)
- [x] 퀴즈 생성 정기 스케줄(Celery beat) — `collector.generate_chart_quiz` 매일 21:00 KST, 미시도 재고 < `QUIZ_POOL_MIN_UNSEEN`(100)이면 `QUIZ_POOL_BATCH`(50 → 2026-10-17 200)개 생성 (2026-10-13)
- [x] **야간 퀴즈 개선 A·B1·B2** (2026-10-17)
  - A: 관리자 QUIZ on/off 를 시즌 응답 `features` 로 웹·앱에 바로 반영(꺼지면 버튼·배너 숨김)
  - B1: 자동 생성 품질 — 신호 발생일만(교차·20일 신고/신저가·거래량 급증·RSI), 등락 ≥3%, 같은 종목 20거래일 간격, 거래대금 10억↑, 정답 반반, 적게 나온 패턴 우선. 다 풀면 안내 화면
  - B2: 차트 5·20일선·거래량, 제출 후 이후 5봉 공개(`chart_quiz_pool.future_snapshot`, 마이그레이션 `c8d9e0f1a2b3`)·결과 한 줄(`outcome`)·해설 마크다운 표시
  - 배포 후: 기존 무작위 문제는 그대로라 관리자 "일괄 생성" 또는 기존 문제 비활성화로 교체. 앱은 새 빌드 필요
- [x] **야간 퀴즈 개선 B3 — 유형 다양화** (2026-10-17)
  - B3-1: 차트 길이 40/60/120봉·예측 기간 3/5/10일(종목마다 가중 무작위, 5일 60%) — `window_bars`·`horizon_bars`(마이그레이션 `d9e0f1a2b3c4`), `?horizons=`
  - B3-2: 4지선다 — 등락폭 구간(RANGE, ±5% 경계)·신호 맞히기(PATTERN, 차트에 보이는 신호 5종, 오답은 기준일에 없는 신호) 각 25%, 제한시간 15초 — `quiz_type`·`choices`, answer/choice 20자(마이그레이션 `e0f1a2b3c4d5`), `?types=`
  - 구버전 앱(파라미터 없음)은 DIRECTION·5일 문제만 — 새 재고의 약 30%. 야간 보충은 이 구버전용 미시도 재고도 기준(100)으로 본다
  - 관리자: 목록·상세에 유형·길이·기간, 일괄 생성 유형 선택. 직접 출제는 2지선다·60봉·5일
- [x] **퀴즈 공개 구간 겹침 방지** — 같은 종목 문제 간격 >= 나중 문제 차트 길이 + 이른 문제 예측 기간(최소 20, `spans_clear`), DB 기존 문제도 길이 반영. 실데이터 200개: 겹치는 쌍 55→0, 생성 수 동일 (2026-10-17)
- [x] **⑤-1** 연속 출석 마일스톤 보상 — 3·7·14·30일, 시즌마다 마일스톤별 1회 수동 수령(`streak_reward_claims`, web 모달·모바일 시트) (2026-10-13)
- [x] **⑤-2** 퀴즈/아카데미 문항 어드민 편집 — 아카데미 문항 DB(`academy_questions`)·관리자 CRUD, 퀴즈 활성/비활성·수정·삭제·일괄 생성·직접 출제(종목·기준일), admin_web 🎓 아카데미 문항·🧩 퀴즈 관리 (2026-10-13)
- [x] 서버 PUSH_BACKEND=expo 전환 + EAS 에 FCM V1 키 업로드 — 서버 실발송·알림 탭·무음 push 백그라운드 기록(콜드 포함) 실기기 확인 (2026-10-21)
- [x] **내 펀드 로그인 계정별 저장 + 앱 삭제 시 정리** — 앱·웹 목록 키 `fund_list_v1_u<id>`(캐시·기록은 펀드 id 라 자동 분리), 옛 공용 목록은 처음 들어온 계정이 가져오기/버리기(한도 초과분은 기기에 남김), Drive 백업 파일·상태 계정별 + Google 이메일 확인, 계정 전환 중 저장·자동 갱신 uid 고정, 탈퇴 시 그 계정 데이터 삭제(앱·웹), Android `allowBackup=false`·iOS 재설치 첫 실행 키체인 정리. 설계 `docs/superpowers/specs/2026-10-23-fund-per-account-storage-design.md` (2026-10-23). 새 APK 필요(allowBackup), 실기기 확인 대기
- [ ] 펀드 알림 후속: 운영 앱 빌드에 projectId 포함 확인(`unzip -p <apk> assets/app.config | grep -c projectId`)·6시간 정기 작업 콜드 실측
- [ ] 새 글 알림 실기기 확인 — 펀드 없는 계정 등록·수신·탭 → 글 상세, 스위치 끄면 미수신(코드 이전은 2026-10-21 완료)
- [x] **③ 실시간 수평 확장(Redis Pub/Sub 연결 분산)** — WS 전달 Redis Pub/Sub 버스 + 싱글톤 작업 리더 선출 + `/ready`·`*_FILE` env, 배포 설정 Docker Swarm(`deploy/swarm/`)·Kubernetes Kustomize(`deploy/k8s/`), 초보자 가이드 [`docs/deploy/README.md`](deploy/README.md) (스펙 `docs/superpowers/specs/2026-10-14-horizontal-scaling-swarm-k8s-design.md`, 2026-10-14)
- [x] web_client TypeScript 전환 (서브페이즈 6 직전, admin_web과 동일 방식) — 2026-10-13 strict 전환 완료
- [x] **trading_game 개발 서버(develop) 배포 구성** — prod compose 에 `trading_game`(호스트 8004)·`game_ws` 추가, web/admin 빌드에 `VITE_GAME_API_URL=https://game.haezean.com` 주입, Deploy Server 에 `alembic upgrade head` 자동 단계 (2026-10-13). **남은 수동 작업**: Cloudflare `game.haezean.com → localhost:8004`, 서버에서 시즌 시드·퀴즈 생성(`docs/server_setup.md` §7-1)
- [ ] trading_game product 배포(도메인 확정 시 — 빌드 인자·CORS_ORIGINS 추가)
- [x] **무중단 배포 준비(단일 서버)** — 원인: compose stop-first 로 배포마다 수십 초 502. 앱 9개 단일 노드 Swarm(start-first·healthcheck·자동 롤백, DB 는 compose 유지) `deploy/swarm/single-node.yml`·`deploy.sh`·`cutover.sh`·`rollback-to-compose.sh`, 워크플로 자동 분기(스택 있으면 Swarm). 웹·앱 조회만 재시도(1·3·6초, mutation·POST 제외). 문서 `docs/deploy/single-node-swarm.md` (2026-10-19). **남은 일: 운영자 1회 전환(`cutover.sh`)**
- [x] **게임 일봉 오늘 봉** — `GET /api/game/candles/session`(분봉으로 만든 최근 거래일 봉)을 일봉 마지막보다 나중이면 이어 붙임(웹·앱 `withSessionBar`). 재조회·탭 복귀에도 유지, 20:30 수집 후엔 공식 일봉 (2026-10-17). 앱은 새 빌드 필요
- [x] **랭킹 창 자동 갱신** — 열려 있고 화면이 보일 때 15초마다 조용히 갱신(주간·월간·시즌, 실패 시 기존 유지), 서버 Top 100 응답 5초 Redis 캐시(`board_cache`) (2026-10-17). 앱은 새 빌드 필요
- [x] **차트 지지·저항선 자동 범위** — `autoscaleInfoProvider` 로 일봉은 지지·저항·진입가, 분봉은 진입가만 포함(손절·익절 제외), 웹·앱 (2026-10-17)
- [x] **장운영 상태(VI·거래정지·서킷브레이크·사이드카)** — KIS 장운영정보(H0STMKO0) 구독·`market_status` 상태(해제 누락 대비 최대 지속 시간), 주문·청산 차단+이유 안내(사이드카는 안내만), `GET /api/game/market-status`·WS `market_status`, 웹·앱 배너. 실전만(모의 미지원) — 첫 실제 VI 때 로그로 확인 필요 (2026-10-17)
- [x] **거래일 달력** — 주말·공휴일·대체공휴일(`holidays`)·KRX 연말 휴장·`MARKET_HOLIDAYS` 수동 → 거래 시간 아님. 주문·청산 문구를 사용자 말로 (2026-10-17)
- [ ] 로그인 상태 새로고침 지연 측정(비로그인은 0.13~0.2초 정상 확인)
- [x] admin_web `prose` 스타일 — `@tailwindcss/typography`(0.5.19) 도입으로 에디터/코치 미리보기 제목·목록 스타일 적용 (2026-10-13)
- [x] 명예의 전당 응답 `season_number` — 웹·모바일 그룹 헤더가 시즌 id 대신 시즌 번호 표기 (2026-10-13)
- [x] 게스트 로그인 백엔드 게이트 `AUTH_GUEST_ENABLED` — 미설정 시 `APP_ENV=development|test` 에서만 허용, 꺼지면 404. develop 서버는 `true` (2026-10-13)
- [x] **버그: 차트 삽입 모달 버튼이 글 폼을 submit** — `ChartSnapshotModal` 버튼 7개에 `type="button"` 누락 + 모달이 `BlogEditorPage` `<form>` 내부 렌더 → 수정 화면에서 그리기 도구 클릭 시 글이 저장·이동됨(TS 전환 이전부터 존재, 2026-10-12 스모크에서 발견 → 같은 날 수정·브라우저 재검증)

---

## 참고 문서
- **트레이딩 게임 마스터 기획: `docs/trading_game_plan.md`**
- 아키텍처: `docs/architecture_plan.md`
- 스크리너 기획: `docs/screener_plan.md`
- 기능별 프롬프트: `docs/prompts/`
- AMS 참고 분석: `docs/ams-reference/`
- 설계 스펙: `docs/superpowers/specs/`

