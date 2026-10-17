# Stock App 로드맵 & 진행 현황

> 최종 업데이트: 2026-10-16

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
- [x] 새 글 실시간 알림: 웹 SSE(Redis pub/sub) + 모바일 FCM(Mock)

### 주식 API (stock_api, GraphQL)
- [x] `searchStocks`(국내외/지수 통합검색) · `getChartData`(온더플라이 시드 데이터)
- [x] 지표: MA5/20/50/120, 정배열/역배열, 볼린저(σ 가변), 매물대(Volume Profile)

### 어드민 차트 삽입 (핵심 기능)
- [x] 종목 검색 → 기간 → 실차트 렌더 → `getDataURL` 캡처 → 본문 삽입
- [x] 가격축 우측 · 매물대 좌측 · 볼린저 실선 · σ 숫자입력 · 매물대 표시 토글
- [x] 드로잉 4종(수평선/이중추세선/사각형/텍스트) + ESC 취소, 데이터좌표 기반 캡처 포함

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
- [ ] 성능: 동기 순차 → async 병렬(aiolimiter) 승격(전종목 수집 ~1시간 단축)
- [ ] 해외 주식/지수, 재무데이터(PER/PBR/ROE) 연동
- [ ] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용)

### Phase 2 — 스크리너
- [ ] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합)
- [ ] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무)
- [ ] 결과 카드 UI + 정렬/편집, 차트 상세(웹 스플릿뷰)

### Phase 3 — web_client 확장
- [x] 토스 디자인 + 2단 네비 + 게임 스켈레톤 (위 완료 섹션 참조)
- [ ] 종목 상세/차트 화면 (어드민 차트+드로잉 컴포넌트 재사용)
- [x] 간편 로그인(카카오·네이버) — auth 백엔드 콜백 + 일회용 교환 코드, web 버튼·`/auth/complete`, 모바일 인앱 브라우저 세션(dev 스킴 `stockapp-dev`), 게스트 로그인은 개발용 플래그(2026-10-13). 실 공급자 키 발급 후 수동 확인 필요(네이버 검수 전 테스트 계정)
- [x] 회원 탈퇴 — auth `DELETE /api/v1/auth/me`, 즉시 삭제 + 명예의 전당·주간 기록 익명화, Redis 랭킹 정리·카카오 연결 끊기(2026-10-14, 백엔드)
- [x] **중복 로그인 처리(플랫폼별 단일 세션)** — web 1 + app 1(+admin) 유지, 같은 플랫폼 재로그인 시 이전 기기 401·게임 WS 즉시 끊기·안내, 시작·복귀 시 `/auth/me` 확인 (2026-10-16, 스펙 `docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md`). 앱은 새 빌드 필요
- [x] ~~게스트→소셜 계정 이관~~ — 불필요(게스트=개발용, 운영 미노출)
- [ ] 애플 로그인(iOS 출시 직전)

### Phase 4 — 모바일 앱 (Expo) *(토스 토대·네비 완료)*
- [x] 앱 셋업 — Expo SDK 57/RN 0.86, **Unistyles v3** 테마(상승=빨강/하락=파랑, adaptiveThemes), zustand. `app.config.js` dev/prod 앱이름·bundleId 분리, `eas.json` 프로필, `EXPO_PUBLIC_*` env 분리
- [x] **토스 디자인 전체 적용 + 네비 재편** — 하단 4탭(홈/블로그/게임/내정보, 스크리너·관심종목 탭 제거), 블로그(목록/상세/댓글)·홈 추천글·게임 스켈레톤 동작. 에뮬레이터 육안 검증 완료
- [ ] 스크리너/차트 화면 + 차트 드로잉
- [ ] 실제 FCM 푸시(현재 Mock 대체)

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
  - [x] **앱 로그인 안내 바텀시트** — 게임 탭 비로그인 안내를 OS 기본 Alert 대신 `ui/BottomSheet` 로(디자인 언어 "바텀시트 우선") (2026-10-15)

### 상시 백로그
- [x] **주간 랭킹** — 월 09:00 KST 시작·시즌 경계로 잘림, 주간 ROI=NAV 비율, 월 08:50 마감(Top 10 기록·1~3위 50/30/20만 보상), web·모바일 주간 탭+보상 토스트 (2026-10-13)
- [x] **시즌 기간 선택(월간/분기)·월간 랭킹·보상 금액 admin 설정** — 다음 시즌 기간 admin 선택, 분기 시즌 월간 랭킹(매월 1일 08:55 마감·1~3위 보상), 주간·월간·출석 보상 금액 `game_settings`, 정산 종가 주말·휴장 보완 (2026-10-14)
- [ ] 지인 리그(Private League) — 백엔드(리그 생성·초대코드·리그 랭킹) + UI. 서브페이즈 6 범위에서 제외 · **보류**(사용자 결정 2026-10-13)
- [ ] 이중추세선 조작 방식 재정의(대기 중)
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
- [ ] 퀴즈 후속 — 120봉 차트는 같은 종목 20거래일 간격 문제의 기준일·이후 구간을 품을 수 있음(비슷한 모양 반복). 간격을 차트 길이 기준으로 늘릴지 생성량과 함께 검토
- [x] **⑤-1** 연속 출석 마일스톤 보상 — 3·7·14·30일, 시즌마다 마일스톤별 1회 수동 수령(`streak_reward_claims`, web 모달·모바일 시트) (2026-10-13)
- [x] **⑤-2** 퀴즈/아카데미 문항 어드민 편집 — 아카데미 문항 DB(`academy_questions`)·관리자 CRUD, 퀴즈 활성/비활성·수정·삭제·일괄 생성·직접 출제(종목·기준일), admin_web 🎓 아카데미 문항·🧩 퀴즈 관리 (2026-10-13)
- [ ] 실 FCM 전환(`PUSH_BACKEND=fcm` + 자격증명)
- [x] **③ 실시간 수평 확장(Redis Pub/Sub 연결 분산)** — WS 전달 Redis Pub/Sub 버스 + 싱글톤 작업 리더 선출 + `/ready`·`*_FILE` env, 배포 설정 Docker Swarm(`deploy/swarm/`)·Kubernetes Kustomize(`deploy/k8s/`), 초보자 가이드 [`docs/deploy/README.md`](deploy/README.md) (스펙 `docs/superpowers/specs/2026-10-14-horizontal-scaling-swarm-k8s-design.md`, 2026-10-14)
- [x] web_client TypeScript 전환 (서브페이즈 6 직전, admin_web과 동일 방식) — 2026-10-13 strict 전환 완료
- [x] **trading_game 개발 서버(develop) 배포 구성** — prod compose 에 `trading_game`(호스트 8004)·`game_ws` 추가, web/admin 빌드에 `VITE_GAME_API_URL=https://game.haezean.com` 주입, Deploy Server 에 `alembic upgrade head` 자동 단계 (2026-10-13). **남은 수동 작업**: Cloudflare `game.haezean.com → localhost:8004`, 서버에서 시즌 시드·퀴즈 생성(`docs/server_setup.md` §7-1)
- [ ] trading_game product 배포(도메인 확정 시 — 빌드 인자·CORS_ORIGINS 추가)
- [ ] 게임 일봉 현재가가 분봉과 다르게 보이는 문제 — 재조회 rows 가 틱 병합 값을 덮어씀(제안·보류)
- [ ] 랭킹 창 자동 갱신 — 현재 열 때 1회 조회, 내 순위만 30초 폴링(제안·보류)
- [ ] 웹 차트 지지·저항선이 autoscale 범위에 포함되지 않음(제안·보류)
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

