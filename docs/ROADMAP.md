# Stock App 로드맵 & 진행 현황

> 최종 업데이트: 2026-08-05

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
- [ ] 성능: 동기 순차 → async 병렬(aiolimiter) 승격(전종목 수집 ~1시간 단축)
- [ ] 해외 주식/지수, 재무데이터(PER/PBR/ROE) 연동
- [ ] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용)

### Phase 2 — 스크리너
- [ ] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합)
- [ ] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무)
- [ ] 결과 카드 UI + 정렬/편집, 차트 상세(웹 스플릿뷰)

### Phase 3 — web_client 확장
- [ ] 종목 상세/차트 화면 (어드민 차트+드로잉 컴포넌트 재사용)
- [ ] 소셜 로그인(카카오/구글) 실연동 → 임시 로그인 대체

### Phase 4 — 모바일 앱 (Expo) *(미착수)*
- [ ] 앱 셋업(EAS dev/prod 분리, bundleId 분리)
- [ ] 블로그/스크리너/차트 화면 + 차트 드로잉
- [ ] 실제 FCM 푸시(현재 Mock 대체)

### 상시 백로그
- [ ] 이중추세선 조작 방식 재정의(대기 중)
- [ ] 테스트(pytest / Vitest / Playwright)
- [ ] 실 FCM 전환(`PUSH_BACKEND=fcm` + 자격증명)

---

## 참고 문서
- 아키텍처: `docs/architecture_plan.md`
- 스크리너 기획: `docs/screener_plan.md`
- 기능별 프롬프트: `docs/prompts/`
- AMS 참고 분석: `docs/ams-reference/`
- 설계 스펙: `docs/superpowers/specs/`
