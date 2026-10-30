# Stock App Project

한국투자증권 API 기반 주식 데이터 파이프라인 + 블로그/커뮤니티 + 관리자 웹/모바일을 포함하는 풀스택 모노레포입니다. 백엔드는 **용도별 독립 마이크로서비스(`backend/apps/`)** 로 구성되며, 로컬은 각 서비스를 개별 포트로 실행하고 운영은 Cloudflare Tunnel(Zero Trust)이 서브도메인별로 라우팅합니다(auth/api/blog/app/admin.haezean.com → 각 로컬 포트).

## 📂 구조

```
backend/
├── apps/
│   ├── auth/        # 인증 서비스 — 로그인/JWT 발급·검증, 관리자 시드   (포트 8001)
│   ├── blog/        # 블로그 서비스 — 게시판/게시글/댓글 CRUD, SSE 알림 (포트 8000)
│   ├── stock_api/   # 주식 API 서비스 — GraphQL 종목검색/차트(온더플라이) (포트 8002)
│   ├── trading_game/# 트레이딩 게임 — 가상 주문/체결 엔진 + 실시간 WS 게이트웨이 (포트 8003)
│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 알림 · 펀드 리포트 알림(Expo Push)
├── shared/          # 공통 DB 모델·세션·JWT 검증·보안
└── alembic/         # DB 마이그레이션
admin_web/           # 관리자 웹 (React + Vite + TailwindCSS, TypeScript)  (포트 5173)
web_client/          # 일반 유저 웹 (React + Vite + Tailwind + Zustand)   (포트 3000)
docs/                # 아키텍처·기획·프롬프트 문서
docker-compose.dev.yml
```

## 🚀 로컬 개발 환경 셋업 (Windows & macOS 공통)

> 💡 일상 실행·서버 배포 **빠른 참조**는 [`docs/run_and_deploy.md`](docs/run_and_deploy.md) 에 정리돼 있습니다(아래는 상세 설명).
> 🪟 **Windows 사용자**: 상세 개발 환경 셋업, 버전 관리자(`vfox`/`conda`/`nvm`), WSL2 Docker 연동은 [`docs/windows_setup.md`](docs/windows_setup.md) 를 참조하세요.

### 0. 런타임 버전 관리 (Java / Python / Node)
다중 프로젝트 및 모바일 빌드 호환성을 위해 각 언어별 버전 매니저가 제공됩니다:
- **☕ Java (모바일 React Native 빌드)**: `vfox use -g java@17.0.2+8` (버전 전환 시 `JAVA_HOME` 자동 갱신)
- **🐍 Python (백엔드)**: `conda activate stock_app` (또는 `uv run ...` 직접 사용)
- **🟢 Node.js (웹/모바일)**: `nvm install 20` / `nvm use 20` (`fnm` 초고속 엔진 기반)

DB 인프라는 **Docker Named Volumes** 기반으로 OS 간 권한/성능 이슈 없이 동작합니다.

### 1. 인프라 구동 (PostgreSQL / ClickHouse / Redis)
```bash
docker-compose -f docker-compose.dev.yml up -d
```

### 2. 백엔드 (FastAPI / Celery) — `uv` 사용
```bash
cd backend
uv sync                                   # 의존성 동기화
uv run alembic upgrade head               # PostgreSQL 스키마 마이그레이션
uv run python -m shared.clickhouse_schema # ClickHouse 스키마 생성(daily_prices/fundamentals, 멱등)
uv run python -m apps.auth.seed_admin     # 관리자 시드 (최초 1회)

# 각 서비스는 개별 포트로 실행 (필요한 것만 띄우면 됩니다)
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 인증(로그인)
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 블로그(게시판/글/댓글/SSE)
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 API(GraphQL /graphql)
uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1  # 트레이딩 게임(주문/체결·WS, 단일워커 필수)

# 데이터 수집/알림 워커 (Celery)
uv run celery -A apps.collector.celery_app worker --loglevel=info
uv run celery -A apps.collector.celery_app beat   --loglevel=info   # 스케줄러(매일 20:30 전종목 수집 · 20:40 시즌 정산 · 21:00 퀴즈 풀 보충 · 월 08:50 주간 랭킹 마감 · 매월 1일 08:55 월간 랭킹 마감 · 평일 장중 30초 국내 지수·환율 · 1분마다 펀드 알림 예약 발송 `dispatch-scheduled-pushes`)

# 국내 주식 데이터 수집 — 수동 트리거 (워커 실행 중일 때)
# 전종목 일봉(겹침창) 수집:      collector.collect_all_daily
# 전종목 장기 백필(청킹):        collector.backfill_all_daily  (months=14)
# 단일 종목:                     collector.collect_daily_ohlcv / collector.backfill_domestic_daily
# 예) 워커 없이 즉시 실행:
uv run python -c "from apps.collector.tasks.universe import collect_all_daily; print(collect_all_daily(source='mst'))"
# 종목 마스터 소스: STOCK_MASTER_SOURCE=mst(전종목·.mst) | fallback(대형주 20) | auto(기본: mst→실패시 fallback)
# KIS 초당 호출 제한: KIS_RATE_PER_SEC(HTTP 요청마다, 기본 prod 15 / vps 8), 병렬 스레드: KIS_WORKERS(기본 4)

# 트레이딩 게임 실시간 시세 수집 데몬 (Phase 2) — ACTIVE 시즌 종목 틱을 Redis stock:tick:{ticker} 로 발행
# (Celery 아님. 단일 롱커넥션 상주 프로세스. ACTIVE 시즌이 있어야 함: python -m scripts.seed_trading_game)
MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws   # Mock 모드(장외/키 없이 검증)
# uv run python -m apps.collector.run_game_ws                       # 실 KIS WS(09:00~15:30 + NXT 애프터마켓 16:00~20:00, 키 필요)
# 체결 TR: 기본 H0UNCNT0(통합 KRX+NXT, 일봉 UN 종가와 일치). 구독 시 REST 일봉 UN 프로브가 빈 응답(NXT 미상장)이면
#   H0STCNT0(KRX). 프로브 실패 시 UN 시도 → UN 구독 2회 연속 거부면 H0STCNT0 런타임 폴백.
#   강제/롤백: GAME_WS_TR_ID=auto(기본)|H0UNCNT0|H0STCNT0|H0NXCNT0
#   TRADING_WINDOWS(기본 09:00-15:30,16:00-20:00, 분 단위) 밖 틱(NXT 프리마켓 등)은 발행하지 않음
#   장운영정보(H0STMKO0 — VI·거래정지·서킷브레이크·사이드카)도 구독해 Redis stock:status:{ticker} 저장·발행(실전 KIS_MODE=prod 만,
#   모의투자 미지원). GAME_WS_MARKET_STATUS=false 로 끔. 주문·청산은 VI·거래정지·서킷브레이크 중 이유와 함께 거부, 웹·앱 배너
uv run python -m scripts.test_game_ws_sub                           # 다른 터미널: stock:tick:* 수신 확인
```

#### 트레이딩 게임 서비스 (Port 8003, Phase 3·4·5a·5b)
실시간 가상 주문/체결 엔진 + 클라이언트 WebSocket 게이트웨이 + 실시간 랭킹/시즌 정산. 원클릭 진입(LONG/SHORT·레버리지 1x/2x/5x·비중 25/50/100%) → 현재가 즉시 체결 → 틱마다 TP/SL/마진콜 자동청산, WS로 틱·개인손익·시장심리 push.
```bash
# 프로세스당 워커 1개(--workers 1). 확장은 인스턴스(컨테이너) 수로 — 리더 1개만 Redis stock:tick:* 구독
cd backend
uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1
```
- **선행**: Phase 2 수집 데몬(`apps.collector.run_game_ws`)이 돌아 `stock:tick:*`·`stock:latest:*` 를 채워야 주문 체결 가능(장외엔 `MOCK_TICK_STREAM=true`). ACTIVE 시즌 시드 필요(`python -m scripts.seed_trading_game`).
- **환경변수**: `REDIS_URL`(기본 `redis://localhost:6379/0`) · `TRADING_WINDOWS`(기본 `09:00-15:30,16:00-20:00` KST — KRX 정규장+애프터마켓, NXT 프리마켓 제외) · `STALE_SECONDS`(기본 `10` — 최신가가 이보다 오래되면 주문 거부) · `MARKET_HOLIDAYS`(선택, `2026-06-03,2026-10-02` — 라이브러리가 모르는 임시공휴일을 휴장으로) · `TRADING_DAYS`(선택, `ALL` 이면 주말·공휴일도 거래일 — 로컬 주말 검증용, `TRADING_WINDOWS=00:00-23:59` 와 함께).
- **거래일**: 주말·공휴일·대체공휴일(`holidays` KR)·KRX 연말 휴장(12/31, 주말이면 직전 평일)은 주문·청산이 '거래 시간이 아니에요' 로 막히고 게임 WS 틱도 발행하지 않는다(`apps/trading_game/services/market_calendar.py`). 임시공휴일이 새로 지정되면 `MARKET_HOLIDAYS` 에 추가하거나 `uv lock --upgrade-package holidays` 로 갱신.
- **실시간 전송(묶기)**: 자동청산은 **모든 틱**에서 검사하되 포지션 메모리 캐시로 후보만 고르고 후보가 있을 때만 DB 확정(틱당 DB 조회 없음). 화면 전송은 최신 틱만 모아 `GAME_WS_TICK_INTERVAL_SEC`(기본 `0.25`)초마다 `{type:"tick"}` 1회(새 틱 없으면 전송 안 함), 개인손익 `position_pnl`·라이브 랭킹은 `GAME_WS_PNL_INTERVAL_SEC`(기본 `1.0`)초마다. 캐시는 주문·청산·보상 지급 시 즉시 무효화 + `GAME_POSITION_CACHE_TTL_SEC`(기본 `5`)초 주기 재적재(Celery 정산 등 다른 프로세스 변경 반영).
- **비로그인 공개 WS**: `ws://…:8003/ws/game/stream` 를 `token` 없이 연결하면 공개 연결(틱·시장심리만, 개인손익·넛지 없음). `token` 이 있으면 기존 검증 — 잘못된/빈 토큰은 4401(공개로 강등 안 함). 공개 연결 상한 IP당 `GAME_WS_PUBLIC_PER_IP`(기본 `3`)·전체 `GAME_WS_PUBLIC_MAX`(기본 `2000`), 초과 시 close `4429`(IP = `CF-Connecting-IP` 우선, 없으면 소켓 주소).
- **수평 확장(인스턴스 N개)**: WS 전달은 Redis Pub/Sub 버스(`game:ws:broadcast` — `aud: all|users`, `game:ws:user:{id}`) → 각 인스턴스가 자기 접속자에게만 전달(sticky 세션 불필요, 메시지 형식 불변). 틱 리스너(+자동청산)·틱 묶기·개인손익·시장심리는 **리더 1개만** 실행 — Redis 락 `game:leader:trading_game`(SET NX PX, ttl/3 주기 갱신, `GAME_LEADER_TTL_MS` 기본 `10000`). 리더가 죽으면(kill) 약 ttl + ttl/3 안에 다른 인스턴스가 승계(로컬 실측: ttl 3초 → 4.2초 후 틱 재개), SIGTERM 이면 락을 즉시 반납해 1초 안에 승계(실측 0.65초). 종료 시 클라이언트는 close 1012(uvicorn)를 받고 재연결. 주문 인스턴스의 캐시 무효화는 `game:cache:dirty` 로 리더에 알림(5초 TTL 재적재는 안전망). 단일 인스턴스(dev compose)도 같은 경로로 그대로 동작. 배포 설정은 `deploy/`·`docs/deploy/`.
- **헬스 프로브(모든 FastAPI 서비스)**: `GET /health` = 프로세스 생존(의존성 미검사, 기존 응답 그대로), `GET /ready` = DB `SELECT 1` + Redis `PING`(auth·blog·trading_game; stock_api 는 DB만) — 실패 시 503 `{"status":"not_ready","checks":{…}}`. 검사당 타임아웃 `READY_CHECK_TIMEOUT_SEC`(기본 `2`).
- **주문 이중 게이트**: 거래 세션 창 + 최신가 신선도. 둘 다 통과해야 체결(세션 밖/시세 끊김 → 409).
- **실시간 랭킹(Phase 4)**: Redis ZSET(`game:season:{id}:ranking`)에 매 틱 보유자 라이브 ROI·청산 시 실현 ROI 반영. 조회 — `GET /api/game/seasons/{id}/leaderboard`(Top100), `GET /api/game/seasons/{id}/my-rank`, `GET /api/game/hall-of-fame`.
- **시즌 정산(Phase 4)**: Celery beat `settle_trading_season` 매일 20:40 KST → 종료일 도래 시 ClickHouse 종가(종료일 당일, 주말·휴장이면 직전 거래일 — 평일 당일 봉이 없으면 보류 후 다음 날 전 종목 0행이면 휴장으로 판단, 최후 3일 뒤 폴백)로 전액 강제청산 → 명예의 전당 박제(+Trading MBTI) → 시즌 FINISHED + 차기 시즌 자동 생성(멱등). worker+beat 가동 필요(`uv run celery -A apps.collector.celery_app worker/beat`).
- **데일리 스마트 코치(Phase 5a)**: 관리자 `PUT /api/game/admin/coach-messages`(슬롯 upsert, `action=draft|publish` — 발행된 슬롯은 초안 저장 불가 409), `GET /api/game/admin/coach-messages?season_id&target_date`, `GET /api/game/admin/seasons`(ADMIN). 유저 `GET /api/game/coach/today`(KST 오늘·활성 시즌의 발행분, `active`=이브닝 우선). 발행 시 WS로 `{type:"coach", season_id, ...}` 전원 push(활성 시즌·오늘(KST) 브리핑일 때만).
  - **지지·저항 추천값**: `GET /api/game/admin/coach-levels/suggest?season_id&target_date&coach_type`(ADMIN)
    - 데이터: 선택한 시즌 종목의 일봉(CH `daily_prices`)
      - MORNING은 target_date 전날까지
      - EVENING은 당일까지
    - 계산 방식
      - 최근 60거래일의 확정 스윙 고점·저점을 ±1.5%로 묶는다.
      - `터치 수 × 거리 가중` 점수로 고른다. 기준가에서 15% 밖은 제외한다.
      - KRX 호가단위로 반올림한다.
    - 응답
      - 해당하는 가격대가 없으면 `null`이다(예: 신고가 돌파 시 저항 없음).
      - 일봉이 없거나 CH 장애면 503이다.
    - admin "📐 추천값 채우기" 버튼은 폼만 채운다. 저장·발행은 관리자가 직접 한다.
    - 설계: `docs/superpowers/specs/2026-10-15-coach-sr-suggest-design.md`
- **스마트 넛지(Phase 5a)**: `POST /api/game/orders`·`POST /api/game/positions/{id}/close` 응답에 `nudges[]`(WARNING 과열 추격 RSI≥80 LONG · ADVICE 100%+5x · PRAISE 손절/수동 ROI −3~−1%). 자동청산(STOP_LOSS)은 WS `{type:"nudge", position_id, nudge}`. 넛지는 best-effort(실패해도 주문·청산 정상). RSI는 Wilder(14) = ClickHouse 일봉(오늘 이전) + 현재가, 종가 캐시 `game:rsi:closes:{ticker}:{YYYYMMDD}`(26h). fan-out 큐 포화 시 오래된 항목부터 드롭되므로 WS 넛지도 유실될 수 있음(best-effort).
- **Phase 5b API**: 유저 `GET /api/game/quests`, `POST /api/game/quests/{code}/claim`(Q1 손절·Q2 골든크로스·Q3' 주문 비중 25% 이하 — 10·20·25%), `GET /api/game/academy/quiz`, `POST /api/game/academy/submit`, `GET /api/game/quiz/random`, `POST /api/game/quiz/{id}/submit`, `GET /api/game/streak/my`. 관리자 `GET /api/game/admin/feature-flags`, `PUT /api/game/admin/feature-flags/{key}`.
- **연속 출석 보상(백로그 ⑤-1)**: 3일 +100,000 · 7일 +300,000 · 14일 +700,000 · 30일 +2,000,000, 시즌마다 마일스톤별 1회 수동 수령(수령 시점 `current_streak ≥ 마일스톤` + 마지막 활동일 오늘/어제 KST). `GET /api/game/streak/my` 응답에 `rewards[{milestone, amount, claimed, claimable}]`(플래그 STREAK 꺼짐·활성 시즌 없음 → `[]`), `POST /api/game/streak/rewards/{milestone}/claim` → `{streak, cash_balance}`(404 `UNKNOWN_MILESTONE` · 409 `NOT_REACHED`/`ALREADY_CLAIMED`/`NO_ACTIVE_SEASON`/`PRICE_UNAVAILABLE` · 503 `FEATURE_DISABLED`). 수령 기록 `streak_reward_claims`(마이그레이션 `a7b8c9d0e1f2`). web·모바일은 헤더 `🔥 n일 연속` 칩 → 보상 모달/시트.
- **주문 비중·손절/익절**: `POST /api/game/orders` `ratio` ∈ {0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0}(그 외 422), 선택 `stop_loss_pct`/`take_profit_pct`(0<x≤1) = **진입가 대비 주가 변동 분수**(레버리지 반영 수익률 아님 — 수익률 영향 ≈ %×배율, 강제청산 −80% 우선). web·모바일 주문 패널: 비중 칩 25/50/100% + ▾기타(10~90%), 손절 −3~−20%·익절 +5~+50% 선택 → 포지션 카드 '손절 X원 · 익절 Y원' 한 줄·차트 손절(회색)/익절(초록) 점선.
- **5배 레버리지 잠금**: 아카데미 **활성 문항 전부** 정답 전 5배 주문은 403 `LEVERAGE_LOCKED`(문항은 DB `academy_questions`, 관리자 편집 — 초기 3문항 시드). 이미 열린 5배 포지션은 영향 없음.
- **보상과 랭킹**: 보상은 원금 조정분(`bonus_cash`)을 `b/(1+ROI)`만큼 함께 늘려 지급 직후 ROI 불변(포지션 보유 중엔 최신가 기준 실시간 ROI, 시세 없으면 퀘스트 409 `PRICE_UNAVAILABLE`·퀴즈 보상 생략). 시즌 정산 명예의 전당은 무거래(`total_trades=0`) 계좌 제외.
- **야간 차트 퀴즈**: `GET /quiz/random`은 `id, chart_snapshot, time_limit_sec`만 반환(종목·날짜 숨김, 가격은 첫 종가=100으로 정규화해 정답 조회 방지). `POST /quiz/{id}/submit`에서 정답·`actual_change`·해설과 함께 `ticker, base_date` 공개. 보상은 KST 하루 최대 3회, 유저별 제출을 계정 행 락으로 직렬화해 동시 요청에도 상한 유지, 서버측 제한시간 10초+3초 유예.
- **RSI·골든크로스 조회**: ClickHouse 조회는 각 2초 타임아웃, 타임아웃 시 60초 음성 캐시로 재대기 방지(best-effort).
- **기능 플래그**: QUIZ·STREAK, admin_web "트레이딩 게임 > ⚙️ 기능 설정", Redis 30초 캐시(변경 시 즉시 무효화).
- **퀴즈 생성**: `cd backend && uv run python -m scripts.generate_chart_quiz --count 50 [--seed N]` — 로컬/개발 DB 전용, 재실행 멱등. 종가 ≤ 0 이거나 일간 등락 ±30% 초과(미반영 분할 등) 구간은 제외하고, 캔들 없는 종목 수를 출력.
- **주간 랭킹(마이그레이션 `c9d0e1f2a3b4`)**: 주 = 월 09:00 KST ~ 다음 월 09:00, 시즌 시작·종료 시각으로 잘림. 주간 ROI = `(1+누적ROI)/(1+주 시작 누적ROI)−1`(보상 지급은 ROI 불변이라 영향 없음). 기준값은 그 주 첫 랭킹 갱신 때 Redis `game:season:{id}:week:{월요일}:base` 에 기록, 순위는 `…:ranking` ZSET(TTL 21일). Celery beat `close_trading_week` 매주 월 08:50 KST → 지난주 Top 10 을 `weekly_ranking_results` 에 기록하고 1·2·3위에 500,000·300,000·200,000 지급(그 주 포지션을 연 계좌만, 시즌 마지막 주는 정산 시 기록만). API: `GET /api/game/seasons/{id}/weekly-leaderboard`·`/weekly-my-rank`, `GET /api/game/weekly-results?season_id&limit`, `GET /api/game/weekly-rewards/unseen`, `POST /api/game/weekly-rewards/{id}/ack`. web·모바일 랭킹 탭 `주간 | 시즌 랭킹 | 명예의 전당`, 게임 진입 시 미확인 보상 토스트.
- **시즌 기간 선택·월간 랭킹·보상 금액 설정(마이그레이션 `e1f2a3b4c5d6`)**: `game_seasons.period`(`month`|`quarter`). 다음 시즌 기간은 admin **게임 설정**(`/game/settings`)에서 선택 → 정산이 차기 시즌을 그 기간으로 생성(분기 중간에 시작하면 그 분기 말 3·6·9·12월 말일 20:00 까지). 진행 중 시즌 기간은 바뀌지 않음. 분기 시즌이면 **월간 랭킹**(매월 1일 09:00 ~ 다음 달 1일 09:00, Redis `game:season:{id}:month:{YYYY-MM-01}:ranking`·`:base`, TTL 100일) — Celery beat `close_trading_month` 매월 1일 08:55 KST 마감(Top 10 기록 `weekly_ranking_results.period_type='month'`, 1~3위 보상은 그 달 포지션을 연 계좌만, 시즌 마지막 달은 정산 시 기록만). 보상 금액(주간·월간 1~3위, 연속 출석 3·7·14·30일)은 `game_settings` 테이블 — 기본 주간 500,000·300,000·200,000 / 월간 1,500,000·900,000·600,000 / 출석 100,000·300,000·700,000·2,000,000, 다음 마감·다음 수령부터 적용. API: `GET/PUT /api/game/admin/settings`(admin), `GET /api/game/reward-config`(공개), `GET /api/game/seasons/{id}/monthly-leaderboard`·`/monthly-my-rank`, `GET /api/game/monthly-results`. 미확인 보상 항목에 `period_type`. web·모바일은 분기 시즌일 때 탭 `주간 | 월간 | 시즌 | 명예의 전당`. **배포 순서: 클라이언트 배포 후 admin 에서 분기 선택.**
- **게임 규칙·방향 용어(마이그레이션 `f2a3b4c5d6e7`)**: `GET /api/game/rules`(공개, 인증 불필요) — 시작 자본금·최소 주문·동시 보유 수·거래 시간·허용 배율(5배=아카데미 해금)·왕복 수수료 0.03%·자동 청산 ROI −80%·심리 갱신 주기·보상 금액(`reward-config` 와 동일)을 실제 계산 상수에서 조립해 내려준다. WS `sentiment` 에 `total`(보유 인원) 추가. **화면 표시는 상승/하락**(버튼 `상승에 걸기`/`하락에 걸기`), API·DB 값은 `LONG`/`SHORT` 그대로.
- **게임 차트 분봉(일봉·1·5·15·60분)**: 마이그레이션 없음(ClickHouse 테이블 + `game_settings` 키). `game_ws` 가 발행한 틱을 1분봉으로 묶어 ClickHouse `game_minute_bars`(`ReplacingMergeTree(ingested_at) ORDER BY (ticker, ts)`, ts=분 시작 KST, `source`=`tick`|`kis`, 조회는 `FINAL`)에 저장 — 확정 바는 즉시, 진행 중 바는 15초마다(별도 큐·태스크라 CH 장애여도 틱 발행·게임 무관). 틱 시각은 발행 payload `timestamp`(KIS 체결시각), 거래량은 누적 거래량 증분 합. 테이블은 `game_ws` 시작 시 자동 생성(`init_clickhouse` 에도 포함). `game_ws` 시작·시즌 종목 전환 시 (종목, 날짜)당 1회 KIS 주식당일분봉조회(`FHKST03010200`, UN 우선 → 빈 응답이면 J)로 오늘 09:00~첫 틱 이전 분을 `source='kis'` 로 보충(이미 `tick` 행 있는 분·거래창 밖 제외, 주말·09:00 이전·Mock 모드는 생략, 실패는 로그만). Mock 틱(`MOCK_TICK_STREAM=true`)은 기본 미저장 — 로컬 스모크에서만 `GAME_MINUTE_BARS_MOCK=true` 로 저장. API `GET /api/game/candles?interval=1m|5m|15m|60m`(공개) → `{"interval","ticker","candles":[{"t"(버킷 시작 UTC epoch 초),"open","high","low","close","volume"}]}`, 범위는 데이터 있는 최근 거래일 1m=2·5m=5·15m=10·60m=30일, 활성 시즌 없으면 `ticker:null`, 데이터 없으면 `candles:[]`, 잘못된 단위 422, CH 장애·5초 무응답 503. 관리자 기본 단위 `game_settings.chart_interval_default`(`day`|`1m`|`5m`|`15m`|`60m`, 기본 `day`, `PUT /api/game/admin/settings`), `/api/game/rules` 에 `chart_interval_default`·`chart_intervals` 추가. 일봉은 기존 stock_api 경로 그대로.
- **게임 차트 보조지표**: 서버 변경 없음 — web(`web_client/src/lib/indicators.ts`)·mobile(`mobile/src/features/game/lib/indicators.ts`)이 받은 캔들(일봉·분봉 공통) 종가로 이동평균 5·20·60, 볼린저밴드(20, 2σ 모표준편차)를 직접 계산, 틱으로 마지막 값 갱신. 차트 위 토글 칩 `이동평균`(기본 켜짐)·`볼린저`(기본 꺼짐), 마지막 단위·지표 선택은 기기에 저장해 다시 열 때 복원(web localStorage·app SecureStore 키 `game.chartPrefs.v1`, 저장값 > 관리자 기본 단위 > 일봉). web 은 볼린저 띠 채우기를 시리즈 primitive(`lib/bandFill.ts`)로 그림. mobile 은 한 화면에 60개를 그리고, 지표는 전체 데이터로 계산한다. 가로로 끌면 과거 구간으로 이동한다.
  - 구현: `lib/chart-window.ts` + PanResponder. 세로 스와이프는 페이지 스크롤로 넘긴다.
  - 과거 구간을 보는 중에 새 봉이 생겨도 화면은 그대로다.
  - "최신 ›" 칩을 누르면 최신 구간으로 돌아간다. 지표 워밍업: web 일봉은 280일 조회·첫 화면 180일, 분봉은 첫 화면 최근 120개. `game_ws` 는 시작·종목 전환 시 당일 보충에 이어 CH 에 비어 있는 과거 30거래일을 KIS 주식일별분봉조회(`FHKST03010230`, 호출당 120건, UN→J, 20:00부터 역순·거래창 안만 `source='kis'`)로 채운다(tick 행 또는 16시 이후 행이 있는 날짜는 건너뜀, 첫 오류에서 중단·로그만 — 모의 vps 지원 여부 미확인).
- **퀴즈 정기 생성(Celery beat)**: `collector.generate_chart_quiz` 매일 21:00 KST(일봉 수집 20:30·정산 20:40 이후) — 아직 아무도 시도하지 않은 문제 수가 `QUIZ_POOL_MIN_UNSEEN`(기본 100) 미만일 때만 `QUIZ_POOL_BATCH`(기본 50)개를 위 스크립트의 `generate()` 로 생성, 아니면 skip(결과 `{generated, skipped_reason}` 로그). worker+beat 가동 필요.
- **퀴즈·아카데미 문항 관리자 편집(백로그 ⑤-2, 마이그레이션 `b8c9d0e1f2a3`)**: 아카데미 `GET·POST /api/game/admin/academy/questions`, `PUT·DELETE /api/game/admin/academy/questions/{id}`(choices 2~6·각 1~200자, answer 범위, 질문 1~500·해설 1~1000자). 유저 아카데미는 활성 문항만 `sort_order` 순 출제 — 0개면 제출 409 `NO_QUESTIONS`, 이미 해금한 유저는 유지. 퀴즈 `GET /api/game/admin/quizzes?page&size(≤100)&active`(최신순·시도 수), `GET·PUT·DELETE /api/game/admin/quizzes/{id}`(수정은 `pattern_type`·`explanation`·`is_active` 만, 시도 기록 있으면 삭제 409 `HAS_ATTEMPTS`), `POST /api/game/admin/quizzes/generate {count 1~200}` → `{created, skipped}`, 직접 출제 `POST /api/game/admin/quizzes {ticker, base_date}`(CH 일봉에서 정답·등락률·해설 자동 계산, 422 `INSUFFICIENT_DATA`/`TOO_FLAT`/`INVALID_SERIES`, 409 `DUPLICATE`). `chart_quiz_pool.is_active=false` 문제는 출제·beat 재고에서 제외(이미 출제된 문제의 제출은 허용).
- 에뮬레이터 검증 시: `adb reverse tcp:8003 tcp:8003` 추가.

> ⚠️ 관리자 웹 로그인은 **auth(8001)**, 게시판/글/댓글은 **blog(8000)** 을 사용합니다. 어드민을 테스트하려면 **두 서비스를 모두** 띄워야 합니다.

기본 관리자 계정: `admin@stock.app` / `admin1234`

### 3. 관리자 웹 (React + Vite)
```bash
cd admin_web
npm install
npm run dev        # http://localhost:5173
```
- admin_web 은 **TypeScript(strict)** 다. `npm run build` = `tsc --noEmit && vite build` 이므로 타입 에러가 있으면 빌드(및 Docker 배포 빌드)가 실패한다. 타입만 확인하려면 `npx tsc --noEmit`.
- 로컬에서 배포용 빌드를 확인할 때는 VITE_* 가 필수다: `VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build`.
- API 응답 타입은 `admin_web/src/types/`(백엔드 pydantic·GraphQL 스키마 기준)에 있다. 백엔드 응답 스키마를 바꾸면 여기도 함께 갱신한다.
- **트레이딩 게임 > 데일리 코치**(`/game/coach`)는 trading_game(8003)을 호출한다. `VITE_GAME_API_URL`은 **선택** 변수 — dev 에서 미설정 시 `http://localhost:8003`, 배포 빌드에서 미설정이면 화면에 "게임 서버 미연결" 안내(빌드는 실패하지 않음). trading_game 운영 배포 전까지 필수 목록(`vite.config.js` REQUIRED)에 넣지 않는다.
- **트레이딩 게임 > 🎓 아카데미 문항**(`/game/academy`): 문항 추가·편집(선택지 2~6·정답 라디오·해설·순서)·활성 토글·삭제, 활성 문항 수 표시(활성 문항을 모두 맞혀야 5배 해금). **🧩 퀴즈 관리**(`/game/quizzes`): 활성 필터·페이지네이션 목록, 상세 차트(기준일선 + 이후 5거래일은 stock_api 일봉으로 다른 색), 패턴·해설 편집, 활성 토글, 삭제(시도 있으면 비활성 안내), "N개 자동 생성", "직접 출제"(국내 종목 검색·기준일). 게임 서버(8003)와 차트·검색용 stock_api(8002) 필요.
- **시장 데이터 › 테마 보정**(`/market/themes`): KIS 테마 숨김·이름·설명 수정, 관리자 테마 생성, 종목 검색 추가·제외. 최신 순위·1일 등락·거래대금을 함께 표시하고, 저장하면 서버가 테마 순위를 다시 계산한다.
- **시장 데이터 › 데이터 현황**(`/market/status`): 일봉·지수·투자자·재무·FRED·공모주·CANSLIM·시장 그룹의 최신일과 상태(기준 거래일 비교), 설정 상태(값은 표시 안 함), 최근 일일 파이프라인 단계별 결과.
  KIS 를 호출하지 않는 계산 4개(CANSLIM·시장 그룹 계산과 각 60일 백필)는 버튼으로 실행한다. 같은 작업은 동시에 하나만 돈다(Redis 잠금).
  API: stock_api `GET /api/v1/admin/market/status`, `GET·POST /api/v1/admin/market/jobs[/{job}]`(관리자 JWT).
- **시장 데이터 › 데이터 검증**(`/market/verify`): 종목 하나의 우리 값(기본 정보·최근 5일 일봉·계산값·투자자 순매수·분기/연간 재무·CANSLIM·소속 테마/업종의 그날 순위)을 한 화면에 모으고, 네이버·FnGuide·DART 링크로 외부 값과 눈으로 비교한다. 날짜를 비우면 그 종목의 최신 일봉일이다. 읽기 전용.
  API: stock_api `GET /api/v1/admin/market/verify?ticker=&date=`(관리자 JWT, 형식 오류 422·없는 종목 404 `{code,message}`).

### 4. 일반 유저 웹 (web_client)
일반 사용자(B2C)용 반응형 웹. 블로그/커뮤니티 조회 + SSE 실시간 알림 + **임시 로그인(닉네임)으로 댓글 작성**. 디자인은 **토스(Toss) 라이트 스타일**(`docs/mobile_design_language.md`의 토큰을 Tailwind `theme.extend`로 이식 — brand `#3182f6` 등)로 모바일과 통일.
> 헤더는 **2단 네비(커뮤니티·게임)**. 커뮤니티 섹션에서만 게시판 탭이 보이고, `/game`은 "시즌 준비 중" 스켈레톤(트레이딩 게임 백엔드 Phase 1~5 완성 후 실시간 화면으로 교체). 공통 UI는 `src/components/ui/`(Button·Card·Chip·EmptyState).
> 로그인은 **카카오·네이버 간편 로그인**(auth 서비스, 아래 "간편 로그인" 참조). 닉네임 게스트 로그인(`POST /api/v1/auth/guest`)은 **개발용** — 프론트 노출은 `VITE_ENABLE_GUEST_LOGIN`(미설정 시 dev serve 만 노출, 배포 빌드 숨김), 백엔드 허용은 auth 의 `AUTH_GUEST_ENABLED`(미설정 시 `APP_ENV=development|test` 에서만, 꺼지면 404). 둘은 짝으로 켜고 끈다. 댓글 작성 테스트에는 auth(8001)도 함께 띄워야 합니다.
```bash
cd web_client
npm install
npm run dev                            # http://localhost:3000
npm run build -- --mode development    # 빌드 검증(빌드 성공 + 육안)
npm test                               # 단위 테스트(Vitest, src/**/*.test.ts — 순수 함수, node 환경). 감시 모드는 npm run test:watch
```
> blog 서비스(8000)만 있으면 조회가 동작합니다. (`VITE_API_BASE_URL` 로 API 주소 오버라이드)
> `npm run build`(prod 모드)는 `VITE_API_BASE_URL`·`VITE_AUTH_BASE_URL` 누락 시 실패하므로, 로컬 검증은 `.env.development`를 로드하는 `-- --mode development`로 돌립니다.
- web_client 는 **TypeScript(strict)** 다. `npm run build` = `tsc --noEmit && vite build` 이므로 타입 에러가 있으면 빌드(및 Docker 배포 빌드)가 실패한다. 타입만 확인하려면 `npx tsc --noEmit`.
- API 응답 타입은 `web_client/src/types/`(백엔드 pydantic 스키마 기준)에 있다. 백엔드 응답 스키마를 바꾸면 admin_web 타입과 함께 갱신한다.
- **메뉴(앱과 동일)**: 홈 `/`(📌 추천 글 `featured=true`) · 커뮤니티 `/community`(→ 첫 게시판, `/boards/:id`·`/posts/:id` 포함) · 게임 `/game` · 내정보 `/me`(로그인 / 닉네임·로그아웃·탈퇴).
  - 데스크톱은 상단 메뉴, 모바일 폭은 하단 고정 탭바(`components/AppNav.tsx`)에 둔다. 게임 주문바는 탭바 바로 위에 붙는다.
  - 앱 하단 탭 이름도 홈 · 커뮤니티 · 게임 · 내정보로 맞췄다.
  - 설계 문서: `docs/superpowers/specs/2026-10-15-unified-nav-design.md`
- **게임 탭(`/game`)** 은 trading_game(8003)·stock_api(8002, 일봉 차트)를 호출한다. 실시간 화면을 보려면 auth(8001)·blog(8000)와 함께 두 서비스도 띄운다. `VITE_GAME_API_URL`·`VITE_STOCK_API_URL`은 **선택** 변수 — dev 미설정 시 `http://localhost:8003`·`http://localhost:8002/graphql`, 배포 빌드 미설정이면 게임 탭은 "시즌을 준비하고 있어요"(빌드는 실패하지 않음). trading_game 운영 배포 전까지 필수 목록에 넣지 않는다.
- **게임 모달(6b)**: 헤더 `🏆 랭킹`(시즌 Top 100·명예의 전당 MBTI 칩, 비로그인 열람) · `🎯 퀘스트`(Q1~Q3 진행률·보상 수령·뱃지) · `🧩 퀴즈`(야간 10초 차트 퀴즈 — KST 15:30 이후·주말엔 주문 패널 위 배너, 관리자 플래그 QUIZ 가 꺼지면 숨김), 5x 🔒 칩 → 아카데미(활성 문항 전부 정답 시 5배 레버리지 해금), 헤더 `🔥 n일 연속` Streak 칩. 백엔드 변경 없음(Phase 5b API). 퀘스트·퀴즈·아카데미는 로그인 필요.
- **간편 로그인(카카오·네이버)**: 로그인 모달 버튼 → auth `GET /api/v1/auth/social/{kakao|naver}/start?client=web&cc=…` → 공급자 → auth 콜백 → `/auth/complete?code=…` → `POST /api/v1/auth/social/exchange {code, code_verifier}` 로 JWT 저장 후 원래 페이지로 복귀. **verifier(PKCE 방식)**: 시작 전 32바이트 난수 verifier 를 `sessionStorage`(`wc_social_verifier`)에 두고 `cc=base64url(SHA-256(verifier))` 만 보낸다 — 교환 코드만으로는 토큰을 받을 수 없음(로그인 CSRF 방지). `crypto.subtle` 이 필요하므로 https 또는 localhost 에서만 동작. 키가 없는 공급자 버튼은 숨김(`GET /api/v1/auth/social/providers`). 키 없이 로컬에서 흐름을 보려면 auth 를 `SOCIAL_FAKE_PROVIDER=true` 로 띄운다(공급자 대신 "테스트유저" 로그인, `APP_ENV` 가 명시적으로 `development`/`test` 일 때만 유효). 콜백·교환 코드는 Redis 를 쓰므로 Redis(도커)도 필요.
- **회원 탈퇴**: auth `DELETE /api/v1/auth/me {"confirm":"탈퇴"}`(인증 필요, 204 · 확인 문구 불일치 400 `CONFIRM_REQUIRED` · 관리자 403 `ADMIN_CANNOT_DELETE`) — 즉시 삭제(게임 계좌·거래·퀘스트·출석·퀴즈·댓글 CASCADE, 글·코치 메시지 작성자 NULL), 명예의 전당·주간 결과는 '탈퇴한 회원'으로 익명화, 커밋 후 Redis 랭킹 정리·카카오 연결 끊기(`KAKAO_ADMIN_KEY` 설정 시, 둘 다 실패해도 성공 처리).
- **중복 로그인(플랫폼별 단일 세션)**: 같은 계정은 web·app·admin 마다 마지막 로그인 1곳만 유효(`user_sessions`, 마이그레이션 `e7f8a9b0c1d2`). 플랫폼은 `/login`=admin, `/guest` 바디 `platform`(web|app, 기본 web), 간편 로그인은 시작 `client` 로 서버가 정한다. 밀려난 기기는 REST 401 `detail.code=SESSION_REPLACED` / 게임 WS 4401(reason `SESSION_REPLACED`, 즉시)로 로그아웃되고 "다른 기기에서 로그인되어 로그아웃됐어요" 안내. 웹·앱은 시작·복귀 시 `GET /api/v1/auth/me` 로 확인(복귀는 60초 간격). sid 없는 배포 전 토큰은 만료(최대 12h)까지 허용. 즉시 끊기는 auth·trading_game 이 같은 Redis(`REDIS_URL`, 채널 `auth:session:replaced`)를 써야 동작(실패해도 다음 요청에서 차단).
- **앱 리프레시 토큰(앱만)**: 앱 로그인(`/guest` `platform:"app"`, 간편 로그인 `client=app`) 응답에 `refresh_token`·`expires_in`(초)이 추가된다(웹·관리자는 `null`, 기존 그대로). 앱 접근 토큰은 60분(`JWT_APP_EXPIRE_MINUTES`), 리프레시는 30일(`REFRESH_EXPIRE_DAYS`, 갱신마다 새 30일)이며 서버(`refresh_tokens`, 마이그레이션 `d2e3f4a5b6c7`)엔 SHA-256 해시만 저장한다. `POST /api/v1/auth/refresh` {refresh_token} → 새 접근·리프레시 토큰(회전, sid 유지 — 다른 기기 끊김 없음). 이미 쓴 토큰이 30초 안에 다시 오면 다시 회전(앞선 후속 토큰 폐기), 30초가 지나면 탈취로 보고 그 세션의 리프레시 전부 폐기 + 앱 세션 삭제 → 401 `REFRESH_REUSED`. 그 밖 401 코드 `REFRESH_INVALID`·`REFRESH_EXPIRED`·`SESSION_REPLACED`. `POST /api/v1/auth/logout` {refresh_token} 은 그 세션 폐기 + 앱 세션 삭제(항상 204). 인증 401 은 `detail={code,message}` — 만료 `TOKEN_EXPIRED`(앱은 갱신 시도), 그 밖 `TOKEN_INVALID`, 교체 `SESSION_REPLACED`. 게임 WS 는 만료 시 4401 reason `TOKEN_EXPIRED`.

### 5. 모바일 앱 (Expo / React Native)
Expo SDK 57 · React Native 0.86 · expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정·주도주·조건검색, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md` · 주도주·종목 상세 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md` · 조건검색 `docs/superpowers/specs/2026-10-21-screener-presets-design.md`. 종목 상세 `/stock/[ticker]`(점수표·일봉 차트 50일선·52주 고점·점수 추이)는 주도주·조건검색 목록과 테마·업종 상세의 구성 종목에서 들어간다) · **Unistyles v3**(테마 스타일링) · zustand.
> 📦 기기 설치·빌드 종류별(개발용 / 단독 실행 APK / 스토어 배포용) 절차: [`docs/local_build_guide.md`](docs/local_build_guide.md)
>
> ⚠️ **Unistyles는 네이티브 코드라 Expo Go에서 실행되지 않습니다.** 반드시 **개발 빌드(dev build)** 로 실행하세요. 스타일 없이 UI 구조만 빠르게 볼 때는 웹(`npm run web`)이 가장 가볍습니다.
```bash
cd mobile
npm install

# 환경파일 생성 (실제 .env.* 는 gitignore, .env.example 만 커밋됨)
cp .env.example .env.development
cp .env.example .env.production   # 이후 URL을 상용 도메인으로 교체

# (A) 웹으로 빠르게 확인 (Expo Go 불필요) — 기본 8081이 점유 중이면 --port 8082
npm run web

# (B) 네이티브 개발 빌드 — expo run:* 이 prebuild+빌드+실행을 한 번에 (Xcode/Android SDK 필요)
npm run ios                # = expo run:ios (개발용). 실기기: npm run ios:dev:device
npm run android            # = expo run:android.       실기기: npm run android:dev:device
# 상용 릴리스 실행:        npm run ios:prod / npm run android:prod
# 네이티브 폴더만 재생성:  npm run prebuild:dev  (또는 prebuild:prod)

# (C) EAS 로컬 빌드 — dev/prod 프로필 분리 (모두 --local, 무제한)
npm run build:android:dev  # eas build --platform android --profile development --local
npm run build:ios:sim      # iOS 시뮬레이터용 (development-sim 프로필)
npm run build:android:prod # 상용(app-bundle) / build:ios:prod

# (D) 개발 앱 독립실행형 APK — Metro 없이 실행, 다른 테스트 기기에 설치용(Gradle 로컬 빌드)
npm run build:android:devapk  # → android/app/build/outputs/apk/release/app-release.apk
```
> `build:android:devapk`: release 번들은 Expo 가 production 모드로 고정해 `.env.production*` 만 읽으므로, 빌드 동안만 개발 env(`.env.development.local` > `.env.development`)를 `.env.production.local` 로 옮겼다가 지운다. 다른 기기에서 localhost 는 접속 불가라 **`mobile/.env.development.local` 에 개발 서버 `EXPO_PUBLIC_*_URL`(게임 포함)을 넣어야** 하며, localhost 가 남아 있으면 빌드 전에 멈춘다. debug 키 서명(내부 테스트용).
> 모든 스크립트는 `cross-env APP_ENV=development|production` 으로 환경을 주입한다(Windows/macOS 공통). `:dev`/`:prod` 접미사로 환경을, `:device`로 실기기를 선택. EAS 프로필은 `eas.json`의 development/development-sim/preview/production.
- **환경 분리**: `APP_ENV`(빌드 시 주입, `eas.json`에서 프로필별 지정)에 따라 앱 이름·번들ID가 동적 분리 → 개발/상용 앱 동시 설치 가능.
  - dev → `StockApp Dev` / `com.stockapp.dev`, prod → `StockApp` / `com.stockapp` (`app.config.js`)
- **API 주소(MSA 서비스별)**: `EXPO_PUBLIC_STOCK_GRAPHQL_URL`(stock_api :8002/graphql) · `EXPO_PUBLIC_BLOG_API_URL`(blog :8000) · `EXPO_PUBLIC_AUTH_API_URL`(auth :8001). `src/lib/env.ts` 단일 접근점, 통신은 `src/lib/api`(GraphQL+REST). 운영은 Cloudflare Tunnel이 서브도메인별로 라우팅. 실기기 테스트 시 `localhost` → 개발 PC의 LAN IP로 교체.
- **홈 추천 글(큐레이션)**: 관리자 게시글 목록에서 ⭐ 토글로 "홈 추천"을 켜면(`blog_posts.featured_at`), 모바일 홈 탭에 최근에 켠 순으로 노출된다. API: `GET /api/v1/blogs?featured=true`.
- **블로그(웹 클라이언트 동일 기능)**: 블로그 탭은 게시판(보드) 선택 + 페이지네이션(`GET /boards`, `GET /blogs?board_id=&page=`), 카드 탭 시 **글 상세**(`app/blog/[id].tsx`)로 이동해 본문 HTML을 **WebView**로 렌더(차트 base64 이미지 포함). 상세에서 **댓글 읽기/쓰기**(`GET/POST /blogs/{id}/comments`, 게시판 `comments_enabled` 게이팅).
- **로그인(카카오·네이버)**: 내정보 탭 버튼 → `expo-web-browser` `openAuthSessionAsync`(인앱 브라우저, 네이티브 SDK 미사용) (start 에 `cc` 동봉) → auth 콜백이 `stockapp://auth?code=…`(dev 빌드는 `stockapp-dev://auth`)로 복귀 → `POST /auth/social/exchange {code, code_verifier}`(verifier 는 `startSocialLogin` 지역 변수 — 같은 스킴을 가로챈 앱은 교환 불가. Hermes 에 Web Crypto 가 없어 SHA-256 은 순수 TS `features/auth/pkce.ts`, 난수는 expo-modules-core 네이티브 `uuidv4`(CSPRNG) 기반 `features/auth/verifier.ts`, 새 네이티브 의존성 없음) → 토큰은 `expo-secure-store`, `src/lib/api`가 Bearer 자동 부착 + 401 시 정리(`src/features/auth`). 닉네임 게스트 로그인은 **개발용** — `EXPO_PUBLIC_ENABLE_GUEST_LOGIN`(미설정 시 production 이 아닐 때만 노출).
  - ⚠️ **dev 앱 스킴이 `stockapp` → `stockapp-dev` 로 바뀌었다**(prod 와 같은 기기 공존 시 복귀 링크 충돌 방지). 기존 dev build 는 **1회 재생성** 필요: `npm run prebuild:dev` 후 `npm run android:dev`/`ios:dev`(또는 EAS dev 빌드). Expo Go 는 Unistyles 로 원래 미지원.
  - 에뮬레이터는 auth 콜백이 브라우저에서 열리므로 `adb reverse tcp:8001 tcp:8001` 이 필요하다(기존 목록에 포함).
- **게임 탭(트레이딩 게임 6c)**: web 6a+6b 와 동일 기능(헤더·Streak·코치 배너·심리 바·일봉+실시간 차트·포지션/주문·넛지 토스트 + 🏆 랭킹·🎯 퀘스트·🎓 아카데미(5x 해금)·🧩 야간 10초 차트 퀴즈 시트). trading_game(8003)·stock_api(8002, 일봉)·auth(8001) 필요. `EXPO_PUBLIC_GAME_API_URL`은 **선택** — 미설정 시 dev 는 `http://localhost:8003`, production 이면 "시즌을 준비하고 있어요". 차트는 신규 네이티브 의존성 없는 순수 View 렌더(`src/features/game/lib/chart-layout.ts`). 로그인은 내정보 탭(비로그인에서 주문·퀘스트·퀴즈·아카데미 → 내정보 탭 안내). 에뮬레이터는 `adb reverse tcp:8003 tcp:8003` 추가(8000/8001/8002/8082 와 함께).
- **푸시 알림 빌드 설정**: EAS projectId 는 공개 식별자라 `mobile/app.config.js` 에 **기본값**(`DEFAULT_EAS_PROJECT_ID`)으로 들어 있고, `google-services.json` 은 `mobile/secrets/google-services.json` 파일이 **있으면 자동으로** 쓴다(파일은 git 제외). 그래서 개발 빌드·운영 빌드(`android:prod`, `eas build --local`)·개발 APK 모두 **env 를 따로 설정하지 않아도** 푸시가 켜진다. env `EAS_PROJECT_ID`·`GOOGLE_SERVICES_JSON`(`EXPO_PUBLIC_` 아님, 빌드 시 `app.config.js` 가 읽음)은 **덮어쓸 때만** 쓴다(키 이름은 `mobile/.env.example` 참고). `expo-notifications` 플러그인이 들어 있어 **푸시를 쓰려면 새 dev build 가 필요**하다(`npm run prebuild:dev` 후 `npm run android:dev` 등). 웹(`Platform.OS === 'web'`)에서는 `isPushConfigured()` 가 false 라 푸시를 쓰지 않는다. 코드: `src/features/push/`(토큰 등록·해제 직렬화 큐, 안내 시트(홈·펀드), 권한 배너, 내정보 새 글 알림 스위치, 알림 탭 → 펀드 화면·글 상세).
  - **사용자가 직접 할 일(최초 1회)**: ① Firebase 에서 FCM V1 서비스 계정 키 발급 → ② `eas login` → `cd mobile && eas init` 으로 projectId 확인 → ③ `eas credentials` 로 `com.stockapp.dev`·`com.stockapp` 두 패키지에 FCM V1 키 업로드 → ④ 재빌드(env 설정 불필요) → ⑤ 서버 `PUSH_BACKEND=expo`. 자세한 순서: [`docs/push_notification_setup.md`](docs/push_notification_setup.md)
- **앱 업데이트 관리(점검·스토어·OTA)**: 명세 [`docs/app_update_management_spec.md`](docs/app_update_management_spec.md). 앱이 기동할 때 1번, 그리고 포그라운드로 돌아올 때(마지막 검사 후 1시간이 지났거나, 차단 안내 — 점검·스토어 강제·OTA 필수 — 가 떠 있으면 10초가 지났을 때. 10초는 복귀 시 재검사 임계값이지 주기 폴링이 아니다) blog `GET /api/v1/app/version-check`(공개)를 호출해 관리자 웹 정책을 받는다. 우선순위는 **점검 > 스토어 강제 > OTA 필수 > 스토어 권장 > OTA 선택**이고, 안내는 하단 시트로 띄운다. 스토어 권장에서 "나중에 하기"를 누르면 그 버전은 하루 동안 숨긴다. OTA 선택에서 "나중에 하기"를 누르면 이번 실행 동안만 숨기고 다음 실행 때 자동으로 적용된다. 버전 확인이 실패(네트워크·5xx·형식 오류)하면 모달 없이 평소대로 기동하고, OTA 는 무음으로 내려받는다. **점검 모드일 때만** 앱이 화면에 떠 있는 동안(AppState active) 30초마다 다시 확인해, 관리자가 점검을 끄면 기다리던 화면에서 바로 풀린다(백그라운드·점검 해제 시 멈춤). 재검사가 실패하면 직전 결과(점검·강제)를 유지하고 OTA 도 하지 않는다. 스토어 주소는 `https://` 만 쓰고, 없거나 열리지 않으면 Android 는 패키지명 기반 Play 주소로 대신 연다(iOS 는 안내 문구). OTA 재시작이 실패하면 "다시 시도해 주세요" 안내, 연달아 2번 실패하면 필수여도 안내를 내리고 다음 실행 때 적용한다. 차단 안내 중에는 푸시 알림 안내 시트를 띄우지 않는다. 코드: `mobile/src/features/app-update/`.
  - **OTA 발행은 스크립트로만**: `cd mobile && npm run ota:dev -- "변경 요약"` (`ota:preview`, `ota:prod` 도 같음, 메시지 필수). `scripts/publish-ota.sh` 가 두 가지 함정을 막는다.
    - **fingerprint**: app.config 가 `APP_ENV` 에 따라 패키지명·스킴·채널 헤더를 바꾸므로 runtimeVersion 이 달라진다(실측: development·production·preview 가 모두 다름). 빌드 때와 다른 env 로 발행하면 **오류 없이 전달되지 않는다**. 스크립트가 채널별로 `APP_ENV`(dev=development, preview·prod=production)와 preview 의 `EXPO_UPDATES_CHANNEL=preview`(eas.json preview 프로필과 같은 값)를 붙인다.
    - **번들 env**: `eas update` 는 production 모드로 export 해 `.env.production*` 의 `EXPO_PUBLIC_*` 를 번들에 넣는다(`.env.<mode>` 파일이 셸 env 보다 우선). 그래서 dev 발행은 `build-dev-apk.sh` 처럼 개발 env(`.env.development.local` > `.env.development`)를 발행 동안만 `.env.production.local` 로 옮기고 끝나면 지운다. `.env.production.local` 이 이미 있으면(직접 만든 파일·중단된 발행의 잔재) 어느 채널이든 멈추고, `localhost` 주소가 있으면 멈춘다.
    - 발행 전에 채널·`APP_ENV`·API 주소 **키 이름**(값은 출력 안 함)을 보여 주고 `[y/N]` 확인을 받는다. `DRY_RUN=1` 은 확인만 하고 `eas update` 명령을 출력만 한다. `YES=1` 은 확인 질문 생략.
    - 앱 쪽 방어: 설치된 패키지(`com.stockapp.dev`/`com.stockapp`)와 번들의 `EXPO_PUBLIC_APP_ENV` 가 어긋나면 콘솔 경고(`src/lib/env-guard.ts`, 값은 바꾸지 않음 — 되돌아갈 올바른 주소가 번들에 없고, 개발 설정으로 뒤집으면 운영 서버에 게스트 로그인이 노출되기 때문).
    - **예약 발행 → 원하는 때 활성화**(CodePush `--disabled` 대응): `OTA_STAGE=1 npm run ota:dev -- "메시지"` 는 채널 대신 `development-staged` 브랜치에 올린다 — 어느 채널도 이 브랜치를 가리키지 않아 **아무 앱도 받지 않는다**. 활성화는 `npm run ota:dev:activate`(`scripts/activate-ota.sh`): 예약 브랜치의 플랫폼별 최신 업데이트를 `eas update:republish` 로 채널에 다시 발행한다(재빌드 없음 → 올려 둔 번들·runtimeVersion 그대로). 특정 업데이트만: `npm run ota:dev:activate -- <그룹ID>`, 일부 사용자만: `OTA_ROLLOUT=20`. `DRY_RUN=1`·`YES=1`·`OTA_PLATFORMS` 는 발행 스크립트와 같다. 활성화한 업데이트도 앱은 다음 확인 때(새로 켤 때·복귀 후 1시간) 받는다.
  - 관리자 웹에서 OTA 정책(무음/선택/필수)을 정한다. 네이티브 자동 확인은 끄고(`checkAutomatically: 'NEVER'`) 앱 코드가 서버 정책을 먼저 받은 뒤 확인·다운로드하므로, 점검·스토어 강제 중에는 번들을 받지 않는다. `__DEV__`(Metro)에서는 OTA 를 건너뛴다.
  - **runtimeVersion = fingerprint**: 네이티브 구성(라이브러리·플러그인·권한·app.config 의 네이티브 설정)을 바꾸면 지문이 달라져서, 이전 바이너리는 새 OTA 를 받지 않는다(크래시 방지). 이런 변경은 OTA 로 낼 수 없고 **새 빌드(스토어/APK)** 가 필요하다.
  - **채널**: `app.config.js` 의 `updates.requestHeaders['expo-channel-name']` 이 prebuild 때 네이티브 설정에 들어간다. `APP_ENV=development` 면 `development`, 그 밖이면 `production` 이고, `EXPO_UPDATES_CHANNEL` 로 덮어쓸 수 있다(preview 프로필은 `preview`). 그래서 EAS 빌드(`eas.json` 각 프로필의 `channel`)뿐 아니라 **로컬 Gradle 빌드(`build:android:devapk`·`android:prod`)도 채널에 연결된다**. eas.json 의 channel 과 이 헤더 값은 프로필마다 같아야 한다.
  - ⚠️ `expo-updates`·`expo-application` 을 새로 넣었기 때문에 **기존 dev build·APK 는 다시 빌드해야 한다**(`npm run prebuild:dev:android` → `npm run build:android:devapk`, 운영은 `prebuild:prod` 후 빌드). 빌드가 끝나면 그 바이너리용 OTA 를 `npm run ota:<dev|preview|prod> -- "메시지"` 로 발행할 수 있다.
- **공통 UI**: 공유 컴포넌트는 `mobile/src/ui/`에 있으며 토스 디자인 언어(`docs/mobile_design_language.md`)를 따른다.
- **테스트/검증**: 순수 로직 단위 테스트는 `cd mobile && npm test`(jest). 화면은 `npx tsc --noEmit`(+ 실기기 확인)로 검증한다. 이 프로젝트에는 eslint가 설정되어 있지 않아 모바일 lint 단계는 없다.
- **검증(설정 레벨)**: `npx tsc --noEmit` · `npx expo-doctor` · `APP_ENV=production npx expo config --type public --json`

### 펀드 수익보기 (웹 /me/funds · 앱 내정보 > 내 펀드 수익)
- 회원이 fund.ivyro.net 펀드 현황 주소를 **기기에만** 저장하고, 클라이언트가 원본을 직접 가져와 파싱한다(백엔드·환경변수 없음).
- 공용 코드 기준은 `mobile/src/features/fund/core`, 웹은 복사본 `web_client/src/lib/fundCore`.
  core 를 고치면 `scripts/check-fund-core-sync.sh --write` 로 복사하고 `scripts/check-fund-core-sync.sh` 로 확인.
- 테스트: `cd mobile && npx jest src/features/fund` (가린 픽스처 + convert.py 기대 JSON 교차 검증).
- **자동 갱신**: 앱 실행·앱 복귀·웹 접속·탭 복귀 때 등록한 펀드를 모두 다시 가져온다(로그인 상태, 10분 이내 확인한 펀드는 건너뜀, 동시 2개). 앱은 리포트를 열지 않아도 히스토리가 쌓인다. 목록에 `기준일 · 확인 시각` 표시.
  설계: `docs/superpowers/specs/2026-10-19-fund-auto-refresh-design.md` (로직은 core `refresh-all.ts`)
- **리포트 알림(푸시·SSE)**: 관리자 웹 `/fund-notices`(사이드바 "펀드 리포트 알림")에서 문구를 쓰고 **테스트(내 기기만)·즉시·예약** 발송한다. 서버가 기기 토큰으로 Expo Push → FCM 을 거쳐 보내고, 같은 때 SSE `fund_report_updated` 를 발행한다.
  - 앱: 펀드를 처음 등록하면(이미 펀드가 있으면 펀드 화면 진입 시 1회) 안내 시트 후 알림 권한을 묻고, 로그인 + 펀드 1개 이상 + 권한 허용일 때만 토큰을 서버에 등록한다(조건이 깨지면 해제). 알림을 탭하면 펀드 화면으로 이동해 갱신한다. 권한을 거부했으면 펀드 목록 위에 안내 배너.
  - 앱이 열려 있을 때는 SSE 신호를 받아 0~30초 뒤 자동 갱신(웹도 같음, 토스트 표시).
  - 푸시 설정이 없으면(projectId 없음·웹 등) 푸시만 꺼지고 SSE·자동 갱신은 정상 동작.
  - 푸시 설정 참고: projectId 가 `app.config.js` 에 직접 들어 있어 `eas init`·`eas credentials` 에 env 를 따로 붙일 필요가 없다. **새 EAS 프로젝트로 바꿀 때만** `DEFAULT_EAS_PROJECT_ID` 를 고치거나 env `EAS_PROJECT_ID` 로 덮어쓴다. 빌드한 APK 는 `unzip -p <apk> assets/app.config | grep -c projectId` 로 projectId 포함 여부를 확인할 수 있다(개발 APK 는 `mobile/scripts/build-dev-apk.sh` 가 자동 검사). `!` 로 실행하면 대화형 질문에 답할 수 없으므로 `eas init --force` 를 쓴다.
  - 푸시를 쓰려면 `expo-notifications` 가 들어간 **새 dev build 가 필요**하다. 키·계정 준비 절차: `docs/push_notification_setup.md`. 설계: `docs/superpowers/specs/2026-10-19-fund-report-notice-design.md`
- **앱을 열지 않은 날의 기록(백그라운드)**: 서버가 알림 뒤에 제목·본문 없는 깨우기용 무음 메시지(`type: fund_refresh`)를 한 번 더 보내고(이력 수치에는 안 셈), 앱이 이를 받아 백그라운드에서 갱신·히스토리 기록을 하게 하는 구조다(Android 위주, iOS 는 OS 재량·강제 종료·잠금 중 불가). 백그라운드에서 생긴 새 기록의 Drive 백업은 다음에 앱을 열 때 한다.
  - **현재 상태**: 구현·실기기 검증 완료(2026-10-21, 갤럭시 A53 / Android 16, 개발 앱). 알림 탭 → 펀드 화면(백그라운드·콜드), 앱이 백그라운드일 때 무음 push → 8초 뒤 히스토리 기록, 앱을 밀어 닫은 콜드 상태의 무음 push → 화면 없이 11초에 태스크 종료 모두 ✅. 정기 작업은 등록과 JS 깨어남까지 확인했고, 콜드 정기 실행은 같은 원인·같은 수정이 적용되는 경로지만 6시간 주기라 **실측 대기**.
  - Expo 버그 우회: expo-task-manager 57.0.21 은 콜드 시작 때 즉시 끝나는 no-op headless provider 를 등록해 JS 타이머가 다시 멈춘다. `mobile/src/features/fund/background/tasks.ts` 상단에서 같은 키를 30초 동안 끝나지 않는 provider 로 덮어쓴다. **expo-task-manager 를 업그레이드하면 이 우회가 아직 필요한지 다시 확인한다.**
  - 실기기 확인 절차(Android, 개발 앱):
    - 로그: `adb logcat -s ReactNativeJS | grep fund-bg` — 로그인 + 펀드 1개 이상이면 `periodic sync registered`.
    - 강제 실행: 앱을 홈으로 보낸 뒤 `adb shell dumpsys jobscheduler` 로 작업 번호를 찾아 `adb shell cmd jobscheduler run -f com.stockapp.dev <작업번호>` → `periodic start` 확인.
    - 함정 1: 직전 10분 안에 받은 펀드는 다시 받지 않는다(방금 추가한 펀드는 갱신 안 됨, 정상). 기록 파일(`files/fund-history-*.json`) 수정 시각으로 구분한다.
    - 함정 2: 첫 실행 뒤에는 WorkManager 가 주기(약 6시간)를 관리해 강제 실행이 무시된다(작업 번호도 바뀜). 다시 하려면 펀드를 모두 지웠다 추가하거나 로그아웃 후 재로그인(그래도 10분 넘게 기다려야 갱신).
    - 무음 push 확인(콜드): 앱을 최근 앱 목록에서 밀어 닫고 관리자 웹에서 즉시 발송한다. release 빌드는 `[fund-bg]` 로그가 나오지 않으므로 `adb logcat` 의 네이티브 `TaskService: Finished task 'fund-refresh-push'` 시각으로 판정한다(정상: 화면 없이 11초 안팎).
    - 로컬 E2E 발송(서버 env 를 건드리지 않음): 개발 DB 터널(`scripts/dev-db-tunnel.sh`)을 켜고, 로컬 blog 와 Celery 워커를 `REDIS_URL=redis://localhost:6379/5 PUSH_BACKEND=expo` 로 띄운 뒤 로컬 admin_web 에서 즉시 발송한다. **반드시 Redis DB 5** — DB 0 에는 예전 세션의 미처리 수집 작업이 남아 실행될 수 있다. 테스트 발송은 관리자 계정 기기에만 간다.
    - 자세한 관찰: 설계 §7.1 "실기기 관찰"
- 히스토리에서 빠진 평일은 날짜 옆에 "이전 기록 M.D" 로 표시한다(값을 메우지는 않음).
- 설계: `docs/superpowers/specs/2026-10-18-fund-report-viewer-design.md`

### 펀드 히스토리 · Google Drive 백업 (앱)
- 리포트를 새로 가져올 때마다 계좌별 현재평가금·당일 손익금·월 손익금을 날짜(원본 최종평가일)별로 기기에 저장(`fund-history-<id>.json`). 서버 저장 없음.
- 리포트 헤더의 차트 아이콘 → 수익 히스토리(차트+목록). 펀드 목록 헤더의 구름 아이콘 → 기록 백업.
- 백업은 사용자 본인 Google Drive 의 앱 전용 폴더(`appDataFolder`, Drive 목록에 안 보임)에 `fund-backup-v1.json` 하나.
  업로드는 항상 Drive 와 합친 뒤 올리고(재설치 직후 덮어쓰기 보호), 읽을 수 없는 Drive 파일은 덮어쓰지 않는다. 복원도 합치기(멱등). 기기에서 지운 펀드도 Drive 백업에는 남는다.
- **설정(최초 1회, Google Cloud Console)**
  1. 프로젝트 생성 → API 및 서비스 → **Google Drive API** 사용 설정
  2. OAuth 동의 화면: 외부 · 테스트 모드 · 테스트 사용자에 본인 계정 · 범위 `.../auth/drive.appdata`
  3. 사용자 인증 정보 → OAuth 클라이언트 ID
     - **Android** × 2: 패키지 `com.stockapp.dev` / `com.stockapp`, 각 서명 인증서 SHA-1 (`eas credentials` 또는 `keytool -list -v -keystore <파일>`)
     - **웹 애플리케이션** × 1 → 이 ID 를 아래 env 에
  4. `mobile/.env.development`·`.env.production` 에 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<웹 클라이언트 ID>` → **새 dev build** 필요(네이티브 모듈 `@react-native-google-signin/google-signin`)
- ID 가 비어 있으면 히스토리는 그대로 동작하고 백업 화면만 "백업 설정이 필요해요". iOS 는 출시 전 `GOOGLE_IOS_URL_SCHEME` 설정 필요(`mobile/app.config.js`).
- 설계: `docs/superpowers/specs/2026-10-19-fund-history-backup-design.md`

### 앱 업데이트 관리 (스토어 강제/권장 · OTA 정책 · 점검 모드)
- 명세: `docs/app_update_management_spec.md`, 지시서 `docs/prompts/07_app_update_management.md`. 현재 **백엔드 + 관리자 웹까지 구현**, 모바일(expo-updates·업데이트 모달)은 후속 작업.
- **백엔드(blog 서비스, 포트 8000)** — 테이블 `app_version_configs`(플랫폼별 1행, 마이그레이션 `f4a5b6c7d8e9` 가 android·ios 기본 행 시드: 최신/최소 `1.0.0`, 강제 끔, OTA `SILENT`, 점검 끔)
  - `GET /api/v1/app/version-check?platform=android|ios&current_version=1.0.0` — **인증 없음**, 매 앱 실행마다 호출. 점검 중이어도 200. 응답 `{ maintenance: {is_active, message}, store: {update_type, latest_version, min_supported_version, title, message, store_url}, ota: {policy, title, message} }`
  - `GET /api/v1/admin/app-versions` — 관리자. android·ios 를 항상 이 순서로(행이 없으면 기본값, `updated_at: null`)
  - `PUT /api/v1/admin/app-versions/{platform}` — 관리자. `updated_by`(관리자 이메일, 없으면 닉네임)·`updated_at` 기록. 검증 실패는 422 `{detail: {code, message(한국어)}}`
- **판별 규칙**: ① `is_maintenance` 면 `maintenance.is_active=true`(앱은 최우선 처리) ② `force_update_enabled` 이거나 현재 < 최소 지원 → `FORCE` ③ 현재 < 최신 → `RECOMMENDED` ④ 그 외 `NONE`.
  - 버전은 SemVer `major.minor.patch` 숫자 비교(`1.10.0 > 1.9.0`, 앞자리 0·접두사 `v`·프리릴리스 불가, 20자 이하). 관리자 입력은 서버·웹이 같은 규칙으로 검증하고 최소 지원 ≤ 최신이어야 한다.
  - 강제 플래그(`force_update_enabled`)는 버전 값과 무관하게 `FORCE`(값이 빠지거나 틀려도 우회되지 않음). 플래그가 꺼져 있을 때 앱이 보낸 `current_version` 형식이 틀리거나 비면 `store.update_type=NONE`(버전을 못 읽은 정상 앱이 막히지 않게), 점검·OTA 정보는 그대로 준다. `platform` 은 android/ios 외 422. 응답은 `Cache-Control: no-store`(점검·강제 스위치가 캐시에 붙잡히지 않게).
  - 관리자 저장 검증: 스토어 URL 은 https 주소만, 안내 문구 2,000자 이하, 점검 모드를 켜면 점검 안내 문구 필수(서버·관리자 화면 같은 규칙).
- **OTA 정책 의미**: `SILENT` 백그라운드 다운로드 후 다음 실행 때 적용(알림 없음) · `OPTIONAL` 다운로드 후 안내 창 [나중에 하기]/[지금 재시작] · `MANDATORY` 닫을 수 없는 창으로 즉시 재시작.
- **관리자 웹** `/app/versions`(사이드바 "앱 관리 > 📱 앱 버전 & 업데이트"): Android/iOS 탭, 긴급 조치(점검 모드·스토어 강제 스위치·점검 문구), 스토어 버전 카드, OTA 3단계 라디오, 저장 + 토스트. 점검 켬·강제 켬·MANDATORY 가 들어간 저장은 확인 창을 띄운다.
- ⚠️ iOS 기본 스토어 링크는 플레이스홀더(`https://apps.apple.com/app/id0000000000`) — App Store 는 숫자 앱 ID 가 있어야 열리므로 출시 후 관리자 화면에서 실제 주소로 바꾼다(**iOS 출시 전 강제 업데이트를 켜지 말 것** — 잘못된 링크로 보냄). Android 는 `https://play.google.com/store/apps/details?id=com.stockapp`.

## 🔄 작업 재개(Resume) 가이드 & 환경 점검

작업을 중단했다가 다시 시작할 때, **DB 인프라(Docker)** 는 재부팅 전까지 계속 떠 있지만 **앱 서비스(FastAPI/Celery/Vite)** 는 종료되므로 다시 띄워야 합니다.

> 📌 **가상환경 참고**: 백엔드는 `uv` 가 `backend/.venv` 를 자동 관리합니다. `uv run ...` 만 쓰면 되고 **별도 conda 활성화는 필요 없습니다.** (전역 규칙상 conda를 쓰고 싶다면 `stock_app` env를 먼저 생성해 사용하세요.)

### 0. 사전 준비물 (최초 1회)
- **Docker Desktop** (DB 인프라), **uv** (백엔드 파이썬), **Node.js 18+** (프론트)

### 1. 현재 상태 점검 (무엇이 켜져 있나)
```bash
# DB 인프라(도커) 상태 — postgres/redis/clickhouse 가 healthy 인지
docker compose -f docker-compose.dev.yml ps

# 앱 서비스 포트 점유 확인 (● 떠 있으면 실행 중)
for p in 8001 8000 8002 8003 5173 3000; do lsof -ti:$p >/dev/null 2>&1 && echo "$p ●실행중" || echo "$p ○정지"; done
# 8001 auth · 8000 blog · 8002 stock_api · 8003 trading_game · 5173 admin_web · 3000 web_client

# Celery 워커
pgrep -fl "celery.*worker" || echo "celery ○정지"
```

### 2. 최소 기동 순서 (매번)
```bash
# (1) DB 인프라가 내려가 있으면 먼저 올린다 (재부팅 후엔 항상 필요)
docker compose -f docker-compose.dev.yml up -d

# (2) 백엔드 서비스 — 필요한 것만. 각 명령은 별도 터미널/백그라운드로 실행
cd backend
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 로그인/JWT
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 게시판/글/댓글/SSE
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 GraphQL(차트/종목)
uv run celery -A apps.collector.celery_app worker --loglevel=info   # 알림 워커(선택)

# (3) 프론트 — 필요한 것만
cd ../admin_web  && npm run dev   # 관리자 5173  (auth 8001 + blog 8000 + stock_api 8002 필요)
cd ../web_client && npm run dev   # 유저웹 3000  (blog 8000 + 댓글작성 시 auth 8001)
```

### 3. 기능별 "무엇을 띄워야 하나"
| 하고 싶은 것 | 필요한 서비스 |
|---|---|
| 관리자 로그인 + 게시판/글/댓글 관리 | Docker(postgres) + auth(8001) + blog(8000) + admin_web(5173) |
| 어드민 차트 삽입(종목검색/드로잉) | 위 + stock_api(8002) |
| 유저 웹 블로그 조회 | Docker(postgres) + blog(8000) + web_client(3000) |
| 유저 웹 로그인(카카오·네이버/개발용 게스트) + 댓글 작성 | 위 + auth(8001) + Redis(도커, 간편 로그인 state·교환 코드). 키 없이 보려면 auth 를 `SOCIAL_FAKE_PROVIDER=true` 로 |
| 새 글 실시간 알림(SSE)·앱 푸시(로컬은 PUSH_BACKEND=mock) | 위 + Redis(도커) + celery worker(REDIS_URL=redis://localhost:6379/5) |
| 트레이딩 게임(가상 주문/체결·실시간 WS) | Docker(postgres+redis) + auth(8001) + trading_game(8003, `--workers 1`) + 수집 데몬(`run_game_ws`, Mock 가능) + ACTIVE 시즌 시드 |

### 4. 마이그레이션/시드 (스키마·계정 변경 시에만)
```bash
cd backend
uv run alembic upgrade head             # PostgreSQL 모델 변경 후 스키마 반영
uv run python -m shared.clickhouse_schema  # ClickHouse 테이블 (없으면 생성, 멱등)
uv run python -m apps.auth.seed_admin   # 관리자 계정 없을 때 (admin@stock.app / admin1234)
```

### 5. 종료
```bash
# 앱 서비스만 정리 (포트 kill)
for p in 8001 8000 8002 8003 5173 3000; do lsof -ti:$p | xargs kill -9 2>/dev/null; done
pkill -f "celery.*worker"

docker compose -f docker-compose.dev.yml stop   # DB 인프라 정지(데이터 유지)
# docker compose -f docker-compose.dev.yml down  # 컨테이너 제거(볼륨은 유지 → 데이터 보존)
```
> 데이터(볼륨 `pg_data`/`clickhouse_data`/`redis_data`)는 `down` 해도 유지됩니다. 완전 초기화는 `down -v`.

## 🧪 테스트
백엔드 회귀 테스트는 `pytest`(`backend/tests/`). 네트워크·DB 없이(순수 로직 + 목) 돌아가며, 수집 견고성(적응형 쿨다운·연결계열 2차 재시도), ClickHouse 클라이언트 싱글턴(FD 누수 방지), CORS 허용 오리진, KIS 재시도 분류를 커버한다.
```bash
cd backend
uv run pytest                                    # 전체
uv run pytest tests/test_universe_cooldown.py    # 특정 파일
```

## 🗄️ 로컬 DB 접속 정보

`docker-compose.dev.yml` 기준값입니다. 앱은 아래를 기본값으로 자동 사용하며, DataGrip/DBeaver 등 GUI 툴로 직접 붙을 때도 동일하게 입력합니다.

> 💡 **개발서버(미니PC) DB에 GUI로 붙기**(Cloudflare 터널 경유 SSH) + DataGrip 상세 절차는 [`docs/db_access.md`](docs/db_access.md) 참조.

| DB | Host | Port | User | Password | Database |
|---|---|---|---|---|---|
| **PostgreSQL** | localhost | `5432` | `stock_user` | `stock_password` | `stock_db` |
| **ClickHouse** | localhost | `8123`(HTTP) / `9000`(Native) | `default` | `password` | `stock_data` |
| **Redis** | localhost | `6379` | — | (없음) | `0` |

> **GUI 툴(DataGrip/DBeaver) 접속 팁**
> - **PostgreSQL**: 기본 PostgreSQL 드라이버로 위 값 그대로. URL: `jdbc:postgresql://localhost:5432/stock_db`
> - **ClickHouse**: **HTTP 8123** + ClickHouse 드라이버 **0.6.3 이상** 권장(구버전은 서버 24.8과 호환 문제 발생). URL: `jdbc:clickhouse://localhost:8123/stock_data`
> - 조회 시 최신 1행 보장은 `... FINAL` 사용: `SELECT * FROM stock_data.daily_prices FINAL WHERE ticker='005930' ORDER BY date`
> - ⚠️ 위 값은 **로컬 개발용**입니다. 운영 배포 시 비밀번호를 반드시 변경하세요.

### 스키마 요약

**PostgreSQL (`stock_db`) — 관계형** · 스키마는 Alembic 관리(`backend/alembic/`)

| 테이블 | 용도 | 주요 컬럼 |
|---|---|---|
| `users` | 사용자(관리자·게스트·소셜) | email, nickname, provider, provider_id, role, is_active, password_hash, fcm_token(미사용 — 푸시는 push_devices) |
| `boards` | 게시판 | name, order_index, is_active, min_role_required, comments_enabled |
| `blog_posts` | 게시글 | board_id, author_id, title, content, thumbnail_url, view_count, featured_at(홈 추천 켠 시각) |
| `blog_comments` | 댓글 | post_id, author_id, content |
| `push_templates` | 푸시 알림 템플릿 | title, body, last_sent_at |
| `app_version_configs` | 앱 업데이트 정책(플랫폼별 1행) | platform(UNIQUE), latest_version, min_supported_version, force_update_enabled, store_url/title/message, ota_policy, ota_title/message, is_maintenance, maintenance_message, updated_at, updated_by |
| `stock_meta` | 종목 메타(마스터) | ticker, name, market, is_active |
| `alembic_version` | 마이그레이션 버전(Alembic 자동) | version_num |

**ClickHouse (`stock_data`) — 시계열** · 스키마는 `shared/clickhouse_schema.py`

| 테이블 | 엔진 | 용도 |
|---|---|---|
| `daily_prices` | `ReplacingMergeTree(ingested_at)` | 일봉 OHLCV + MA5/20/50/120 (조회 `FINAL`) |
| `fundamentals` | `MergeTree` | 재무지표(PER/PBR/ROE 등) — Phase 1-b 연동 예정 |

## ⚙️ 주요 환경변수

| 변수 | 대상 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | backend | `postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db` | 비동기 DB(API) |
| `SYNC_DATABASE_URL` | collector | `postgresql+psycopg2://...` | 동기 DB(Celery) |
| `REDIS_URL` | backend | `redis://localhost:6379/0` | Celery 브로커 & SSE pub/sub |
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` | backend | `localhost` / `8123` | ClickHouse 호스트·HTTP 포트 |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | backend | `default` / `password` | ClickHouse 인증 |
| `CLICKHOUSE_DB` | backend | `stock_data` | 주가 시계열 DB |
| `JWT_SECRET_KEY` | auth·blog | `dev-insecure-secret-change-me` | JWT 서명 키 (**서비스 간 동일값 필수**, 운영 필수 설정) |
| `JWT_APP_EXPIRE_MINUTES` | auth | `60` | 앱(platform=app) 접근 토큰 수명(분). 웹·관리자는 `JWT_EXPIRE_HOURS`(12) |
| `REFRESH_EXPIRE_DAYS` | auth | `30` | 앱 리프레시 토큰 수명(일, 갱신마다 새로 시작) |
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | auth | (빈값) | 카카오 로그인 키(시크릿은 콘솔에서 사용 설정 시만). 비면 카카오 버튼 숨김 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | auth | (빈값) | 네이버 로그인 키. 비면 네이버 버튼 숨김 |
| `SOCIAL_STATE_SECRET` | auth | (JWT_SECRET_KEY 폴백) | OAuth state 서명 키 — 운영은 별도 값(미설정 시 기동 경고) |
| `SOCIAL_REDIRECT_BASE` | auth | `http://localhost:8001/api/v1/auth/social` | 공급자 Redirect URI 앞부분(`/{kakao\|naver}/callback`). 개발 서버: `https://auth.haezean.com/api/v1/auth/social` (운영에서 기본값이면 기동 경고) |
| `SOCIAL_WEB_RETURN_URL` | auth | `http://localhost:3000/auth/complete` | 웹 복귀 주소. 개발 서버: `https://app.haezean.com/auth/complete` (운영에서 기본값이면 기동 경고) |
| `SOCIAL_APP_RETURN_URL_PROD` / `_DEV` | auth | `stockapp://auth` / `stockapp-dev://auth` | 앱 복귀 딥링크(앱 변형별) |
| `SOCIAL_FAKE_PROVIDER` | auth | `false` | `true` 면 가짜 공급자(로컬 스모크). `APP_ENV` 가 명시적으로 `development`/`test` 일 때만 유효(미설정·그 외는 무시), 켜지면 기동 경고 |
| `AUTH_GUEST_ENABLED` | auth | `APP_ENV` 가 `development`/`test` 일 때만 켬 | 닉네임 게스트 로그인(`POST /api/v1/auth/guest`) 허용(`true`/`false`). 꺼지면 404. 미설정+그 외 `APP_ENV`(미설정 포함)는 끔. 개발 서버(develop)는 `true`(웹 `VITE_ENABLE_GUEST_LOGIN=true` 와 짝), product 는 둘 다 `false` |
| `QUIZ_POOL_MIN_UNSEEN` / `QUIZ_POOL_BATCH` | collector | `100` / `50` | 퀴즈 정기 생성(21:00) — 미시도 문제 수가 MIN 미만이면 BATCH 개 생성 |
| `PUSH_BACKEND` | collector | `mock` | `mock`(로그만) \| `expo`(Expo Push → FCM/APNs 실발송) \| `fcm`(미구현 스켈레톤). `expo` 는 EAS 에 FCM V1 키를 올린 **뒤에** 바꾼다 |
| `EXPO_ACCESS_TOKEN` | collector (선택) | (없음) | Expo 계정에서 "Enhanced push security" 를 켰을 때만 필요 |
| `EAS_PROJECT_ID` | mobile 빌드 시 (선택) | (코드 기본값) | `eas init` 의 projectId. `EXPO_PUBLIC_` 이 아니라 `app.config.js` 가 빌드 때 읽음. 기본값은 `app.config.js` 의 `DEFAULT_EAS_PROJECT_ID`, 덮어쓸 때만 설정 |
| `GOOGLE_SERVICES_JSON` | mobile 빌드 시 (선택) | (자동 탐지) | Firebase `google-services.json` 경로(커밋 금지). 기본값은 `mobile/secrets/google-services.json` 이 있으면 자동 사용, 덮어쓸 때만 설정 |
| `CORS_ORIGINS` | backend | (localhost + haezean 기본 허용) | 콤마 구분 **추가** 오리진(product 등). develop 배포 도메인(admin/app.haezean.com)은 `shared/cors.py`에 코드로 포함돼 env 없이도 허용 |
| `VITE_API_BASE_URL` | admin_web | `http://localhost:8000/api/v1` | 블로그 API |
| `VITE_AUTH_BASE_URL` | admin_web | `http://localhost:8001/api/v1` | 인증 API |
| `VITE_STOCK_API_URL` | admin_web | `http://localhost:8002/graphql` | 주식 API(GraphQL) — 차트 삽입 종목검색/차트 |
| `VITE_GAME_API_URL` | admin_web | (선택) dev 미설정 시 `http://localhost:8003` | 트레이딩 게임 API — 데일리 코치. 배포 미설정 시 "미연결" 안내 |
| `VITE_AUTH_BASE_URL` | web_client | `http://localhost:8001/api/v1` | 인증 API — 간편 로그인·개발용 게스트 로그인 |
| `VITE_ENABLE_GUEST_LOGIN` | web_client (선택) | dev serve 만 노출 | 닉네임 게스트 로그인 노출(`true`/`false`). 개발 서버 빌드는 `"true"`(테스트용), product 는 `false` |
| `EXPO_PUBLIC_ENABLE_GUEST_LOGIN` | mobile (선택) | production 이 아닐 때 노출 | 닉네임 게스트 로그인 노출(`true`/`false`) |
| `VITE_GAME_API_URL` | web_client (선택) | `http://localhost:8003` | 트레이딩 게임 API·WS(미설정 배포 빌드 → 게임 탭 준비 중) |
| `VITE_STOCK_API_URL` | web_client (선택) | `http://localhost:8002/graphql` | 게임 차트 일봉(GraphQL) |
| `EXPO_PUBLIC_GAME_API_URL` | mobile (선택) | `http://localhost:8003` | 트레이딩 게임 API·WS(production 미설정 → 게임 탭 준비 중) |
| `KIS_MODE` | collector | `vps` | KIS 접속 모드 — `vps`(모의투자) \| `prod`(실서버) |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | collector | (빈값) | KIS OpenAPI 앱키/시크릿 (비우면 Mock 수집 폴백) |
| `STOCK_MASTER_SOURCE` | collector | `auto` | 전종목 마스터 소스 — `mst`(.mst 전종목) \| `fallback`(대형주 20) \| `auto`(mst→실패시 fallback) |
| `KIS_RATE_PER_SEC` | collector | `15`(prod) / `8`(vps) | 전종목 수집 KIS 초당 호출 상한 — 모든 스레드 공유, HTTP 요청(J 폴백·재시도 포함)마다 셈(실전 한도 ~20) |
| `KIS_WORKERS` | collector | `4` | 전종목 수집·백필 병렬 스레드 수(`1`=기존 순차) |
| `FRED_API_KEY` | collector | (없음) | 미국 거시 지표(FRED, 무료 발급). 없으면 거시 지표 수집만 건너뜀 |
| `GEMINI_API_KEY` | collector·stock_api(ai_analyst) | (없음) | AI 시황 분석(Gemini). 없으면 AI 태스크가 `skipped`, 화면은 시세만(원인·해설 null) |
| `GEMINI_MODEL` | collector(ai_analyst) | `gemini-3.8-flash` | Gemini 모델 이름. 스펙의 `gemini-2.0-flash` 는 2026-06-01 지원 종료라 기본값을 바꿈 |
| `NAVER_SEARCH_CLIENT_ID` / `NAVER_SEARCH_CLIENT_SECRET` | collector(ai_analyst) | (없음) | 네이버 검색(뉴스) Open API — **소셜 로그인 키(`NAVER_CLIENT_*`)와 별개**. 없으면 뉴스 없이 AI 분석 |
| `OPENDART_API_KEY` | collector(ai_analyst) | (없음) | DART 공시(스크리너 정성 평가 지뢰 탐지). 없으면 공시 없이 평가 |
| `KRX_ID` / `KRX_PW` | collector(ai_analyst) | (없음) | pykrx 투자자 수급 조회용 KRX 로그인. 없으면 CH `investor_daily`(KIS) 집계로 폴백 — 연기금 없음·기준일이 전 거래일일 수 있음 |
| `MACRO_SERIES_EXTRA` | collector | (없음) | 추가 FRED 시리즈(쉼표) |
| `MARKET_INDEX_EXTRA` | collector | (없음) | 추가 미국 대표 종목(쉼표, 기본 NVDA·MU·AAPL·MSFT·TSLA) |
| `FUNDAMENTALS_Q_CUMULATIVE` | collector | (없음) | CANSLIM C 켜기 — KIS 분기 EPS 가 누적이면 `true`, 단독이면 `false`. 비우면 C 는 '준비 중' |
| `KIS_COOLDOWN_THRESHOLD` | collector | `5` | 연속 연결실패 몇 회에서 적응형 쿨다운 시작 |
| `KIS_COOLDOWN_BASE_SEC` / `KIS_COOLDOWN_MAX_SEC` | collector | `60` / `600` | 쿨다운 시작·상한(초). 연속실패 지속 시 2배씩 에스컬레이트 |
| `KIS_ACCOUNT_NO` | collector | (빈값) | 계좌번호(시세조회만이면 생략 가능) |
| `MOCK_TICK_STREAM` | collector(게임 WS) | (빈값) | `true`면 실 KIS WS 대신 Mock 틱 생성(장외/키 없이 검증). 키 미설정 시 자동 Mock |
| `MOCK_BASE_PRICE` | collector(게임 WS) | `71500` | Mock 틱 기준가(랜덤워크 시작가) |
| `GAME_WS_TICK_INTERVAL_SEC` | trading_game | `0.25` | WS 틱 묶기 전송 간격(초) — 새 틱이 있을 때만 최신 1개 전송 |
| `GAME_WS_PNL_INTERVAL_SEC` | trading_game | `1.0` | 개인손익(`position_pnl`)·라이브 랭킹 갱신 간격(초) |
| `GAME_POSITION_CACHE_TTL_SEC` | trading_game | `5` | OPEN 포지션 메모리 캐시 주기 재적재(초). 같은 프로세스 주문·청산·보상은 즉시 무효화 |
| `GAME_WS_PUBLIC_PER_IP` | trading_game | `3` | 비로그인 공개 WS IP당 최대 연결(초과 시 4429) |
| `GAME_WS_PUBLIC_MAX` | trading_game | `2000` | 비로그인 공개 WS 전체 최대 연결(초과 시 4429) |
| `GAME_LEADER_TTL_MS` | trading_game | `10000` | 싱글톤 작업 리더 락 TTL(ms). 리더 장애 시 승계까지 최대 약 ttl + ttl/3, 갱신·재시도 주기 ttl/3 |
| `READY_CHECK_TIMEOUT_SEC` | backend(FastAPI 전체) | `2` | `/ready` 의존성 검사(DB·Redis)당 타임아웃(초) |
| `*_FILE` | backend 전체 | — | Swarm/K8s secrets 용 — `FOO_FILE=/run/secrets/foo` 가 있고 `FOO` 가 비어 있으면 파일 내용(앞뒤 공백 제거)을 `FOO` 로 사용(예: `JWT_SECRET_KEY_FILE`). 허용 키만(`shared/env.py` `FILE_ENV_KEYS`: DATABASE_URL·SYNC_DATABASE_URL·REDIS_URL·CLICKHOUSE_PASSWORD·JWT_SECRET_KEY·KIS_APP_KEY/SECRET·KAKAO_*·NAVER_CLIENT_SECRET·SOCIAL_STATE_SECRET) + `APP_FILE_ENV_EXTRA`(콤마 구분) 추가 허용, 목록 밖 `*_FILE`(SSL_CERT_FILE 등)은 무시. `FOO` 가 있으면 그대로, 허용 키 파일을 못 읽으면 기동 실패 |

## 🌍 환경 3단계 (local / develop / product)

프론트(admin_web·web_client)의 API 주소는 **빌드 타임에 `VITE_*` 로 번들에 구워진다.** 각 티어별 주입 지점:

| 티어 | 프론트 API URL 주입 | 백엔드 API 위치 | CORS |
|---|---|---|---|
| **local** | `npm run dev`(vite serve) — 값 없으면 `src/config.js` 의 localhost 폴백 | 로컬 uvicorn(8000/8001/8002) | `shared/cors.py` 의 localhost 기본 허용 |
| **develop** | `docker-compose.prod.yml` 의 **build args**(admin_web: haezean 터널 URL, web_client: 같은 도메인 `/_api/…` 상대 경로) | 미니PC(Cloudflare 터널) | admin/app.haezean.com 이 `shared/cors.py` 에 코드로 포함(web_client 는 같은 도메인이라 CORS 불필요) |
| **product** | 실서버 도메인 확정 시 build args 로 주입 | (미정) | 도메인 확정 시 `CORS_ORIGINS` env 로 추가 |

> **🔒 fail-fast (green-but-broken 차단)**: 배포 빌드(`vite build`)에서 `VITE_*` 가 비면 **localhost 로 폴백하지 않고 빌드가 실패**한다(`vite.config.js` + `src/config.js`). 과거 admin.haezean.com 이 localhost 를 부르던 류의 'green-but-broken' 배포를 원천 차단. dev serve(`npm run dev`)에서만 localhost 폴백을 허용한다.
>
> **CORS**: 프론트는 auth·blog·stock 3개 API를 모두 호출하므로 세 서비스가 동일 CORS 정책(`shared/cors.py`)을 공유한다. develop 도메인은 코드에 포함돼 서버 env 를 깜빡해도 CORS 가 동작한다.
>
> **🔀 web_client 는 같은 도메인 프록시(develop, 2026-10-20~)**: 카카오톡 인앱 브라우저(안드로이드 WebView)에서 `app.haezean.com` 은 뜨는데 다른 서브도메인(blog·api·auth) 요청만 응답 없이 실패(`NETWORK`)했다(같은 폰 크롬은 정상). 그래서 web_client 는 다른 도메인을 부르지 않는다.
> - 브라우저 → `app.haezean.com/_api/{blog,auth,stock,game}/…` → 웹 컨테이너(`web_client/server.cjs`)가 접두사를 떼고 `blog_api:8003`·`auth_api:8001`·`stock_api:8002`·`trading_game:8004`(WebSocket 포함)로 전달. compose·Swarm 모두 같은 서비스 이름.
> - build args 는 상대 경로(`/_api/blog/api/v1` 등, `docker-compose.prod.yml`). admin_web·모바일 앱은 기존처럼 각 서브도메인 직접 호출.
> - 정적 파일은 serve-handler 가 `public/serve.json` 규칙 그대로(이전 `serve dist` 와 같은 엔진). 백엔드가 내려가 있으면 프록시는 502 → 클라이언트 조회 재시도. 캐시 헤더 없는 API 응답엔 `no-store`.
> - 로컬 점검: 이미지를 상대 경로 build args 로 빌드 후 `docker run -p 4010:3000 -e PROXY_CHANGE_ORIGIN=1 -e BLOG_UPSTREAM=https://blog.haezean.com -e AUTH_UPSTREAM=https://auth.haezean.com -e STOCK_UPSTREAM=https://api.haezean.com -e GAME_UPSTREAM=https://game.haezean.com <이미지>`.
> - 화면 오류 문구 끝의 `(오류: NETWORK · app.haezean.com/_api/blog)` 는 요청 대상·원인 구분용(`web_client/src/lib/errorCode.ts`).

### 로컬 개발 → 개발서버(미니PC) DB 사용 (SSH 터널)

로컬에서 개발서버(미니PC)의 **PostgreSQL·ClickHouse** 를 그대로 쓴다(수집된 실데이터로 개발). DB 포트는 LAN 전용이라 Cloudflare 로 노출하지 않고, 기존 cloudflared SSH 경로(`ssh.haezean.com`→`127.0.0.1:2222`) 위로 **SSH 포트포워딩**만 얹는다. **Redis 는 로컬 유지**(Celery 브로커 충돌 방지).

```bash
# 1) 별도 터미널에서 터널 유지 (cloudflared LaunchAgent 가 2222 를 열고 있어야 함)
./scripts/dev-db-tunnel.sh          # localhost:15432→PG(5432), localhost:18123→CH(8123)

# 2) backend/.env.development 는 이미 15432/18123 을 가리킴 → 로컬 백엔드 그대로 기동
#    (완전 로컬로 되돌리려면 5432/8123 으로 바꾸고 docker-compose.dev.yml 기동)

# 3) 연결 확인
psql "postgresql://stock_user:stock_password@localhost:15432/stock_db" -c '\dt'
curl -s "http://localhost:18123/?query=SELECT%20count()%20FROM%20stock_data.daily_prices%20FINAL"
```

> ⚠️ **주의**: 로컬에서 alembic 마이그레이션/seed 를 돌리면 **개발서버 스키마·데이터가 바뀐다**(공유 DB). 개발서버 DB 비밀번호가 `.env.development` 값과 달라졌다면(compose.env 로 커스텀 설정 시) URL 의 비번을 맞춰야 한다. 터널이 내려가면 로컬 백엔드는 DB 연결 실패로 뜨니, 이땐 스크립트를 다시 실행하거나 완전 로컬로 전환한다.

> 백엔드는 `shared` 로드 시 `APP_ENV`(기본 `development`)에 따라 `backend/.env.{APP_ENV}` → `backend/.env` 를 자동 로드합니다. 템플릿은 `backend/.env.example`.

### 🔑 한국투자증권(KIS) 설정 (Phase 1 데이터 파이프라인)
```bash
cd backend
cp .env.example .env.development     # 템플릿 복사 (.env.* 는 git 무시)
# .env.development 를 열어 아래를 채웁니다:
#   KIS_MODE=vps          # 먼저 모의투자(sandbox)로 안전하게 테스트
#   KIS_APP_KEY=...        # https://apiportal.koreainvestment.com 에서 발급
#   KIS_APP_SECRET=...
#   KIS_ACCOUNT_NO=...     # 계좌번호(예: 12345678-01) — 시세조회만이면 생략 가능
```
- **앱키가 없으면** 수집기는 Mock 데이터로 폴백하므로 키 없이도 구조 개발이 가능합니다.
- `KIS_MODE=vps`(모의투자) → BASE `openapivts...:29443`, `prod` → `openapi...:9443` 로 자동 전환됩니다.

### 📊 최초 주식 데이터 적재 (KIS 설정 후, 최초 1회)
ClickHouse는 처음엔 비어 있어 `stock_api`가 온더플라이(가짜) 차트를 보여줍니다. 실데이터로 채우려면:
```bash
cd backend
# 전종목 14개월 백필 — 워커 없이 즉시 실행(약 1시간). 비-NXT 종목은 UN→J 폴백.
uv run python -c "from apps.collector.tasks.universe import backfill_all_daily; print(backfill_all_daily(months=14))"
```
- 이후 매일 20:30 `beat`이 `collect_all_daily`로 자동 갱신합니다.
- **이미 백업본이 있으면** 재수집(~1시간) 대신 복원이 빠릅니다 → `docs/deployment/clickhouse-backup.md`.
- 빠른 확인만 원하면 대형주 몇 종목만: `... backfill_domestic_daily('005930', months=14)`.

### 📈 시장 데이터 수집 (스크리너 프로젝트 1 — CANSLIM·주달 화면용)
설계 `docs/superpowers/specs/2026-10-18-market-data-foundation-design.md`. 모두 공식 경로(KIS·KIS 마스터 파일·FRED).

| 시각(KST) | 작업 | 저장 |
|---|---|---|
| 화~토 06:30 (+07:30 안전망) | 미국 지수(S&P500·나스닥·나스닥100·SOX·VIX·다우)·원/달러·대표 종목 — 미국 장 마감(서머타임 05:00 / 그 외 06:00) 뒤 | CH `market_index_daily` |
| 평일 15:40 | 국내 지수(KOSPI·KOSDAQ·KOSPI200) — KRX 정규장 마감 15:30 뒤 바로(20:30 파이프라인의 지수 단계는 안전망으로 유지). 설계 `docs/superpowers/specs/2026-10-20-market-close-schedule-design.md` | CH `market_index_daily` |
| 평일 09:00~15:35 30초마다 | 장중 국내 지수(KOSPI·KOSDAQ·KOSPI200)·원/달러 현재값 — `collector.poll_intraday_indices`(expires 25초), 시장 칩 "● HH:MM" 배지(스크린 리더는 "장중 HH:MM"). 휴장일·장 밖에는 KIS 를 부르지 않음. 0·NaN·음수 값은 실패로 보고 이전 값 유지. 끄기 `INTRADAY_INDICES_ENABLED=false`. 설계 `docs/superpowers/specs/2026-10-20-intraday-index-design.md` | Redis `market:intraday`(TTL 10분, 읽을 때도 10분 지난 항목 제외, CH 에는 안 씀) |
| 08:00 | FRED 거시 지표(CPI·근원CPI·PCE·실업률·고용·기준금리·국채) + CPI·고용·PCE 발표 예정일 — 키 있을 때만 | CH `macro_series`, PG `stock_events` |
| 20:30 | `collector.daily_market_pipeline`: 전종목 일봉 → 국내 지수(KOSPI·KOSDAQ·KOSPI200) → 투자자별 순매수(보통주만) | CH `daily_prices`·`market_index_daily`·`investor_daily` |
| 20:30 (마스터 동기화 때) | 종목 프로필(업종·시총·상장주식·ETF/스팩/우선주·관리/정지)·업종명·KIS 테마 | PG `stock_profile`·`sectors`·`themes`·`theme_stocks` |
| 21:30 | 공모주 청약·상장 일정 | PG `stock_events` |
| 토 10:00 | 재무비율(연간·분기 EPS·ROE·증가율) — 보통주만 | CH `fundamentals_periodic` |

- 지수는 처음 실행 때 2년치를 백필하고 이후 10일씩 겹쳐 받는다. CH 테이블은 각 태스크가 처음 돌 때 자동 생성.
- 수동 실행: `uv run celery -A apps.collector.celery_app call collector.collect_fundamentals` (같은 방식으로 `collect_market_indices --kwargs '{"region":"US"}'`·`collect_investor_daily`·`collect_ipo_events`·`collect_macro_series`).
- 테마 보정 API(관리자 JWT, stock_api): `GET/POST /api/v1/admin/themes`, `PATCH /api/v1/admin/themes/{id}`(이름·설명·숨김), `GET/POST /api/v1/admin/themes/{id}/stocks`, `DELETE /api/v1/admin/themes/{id}/stocks/{ticker}`(제외 표시). KIS 테마 동기화는 `source=kis` 연결만 바꿔 관리자 보정이 유지된다.
- 네이버 증권 크롤링은 하지 않는다(`robots.txt` 전체 거부) — 로드맵 "추후 확인".

### 🔍 시장 데이터 표본 점검 (로컬 CLI)

무작위 N 종목의 일봉을 KRX(pykrx, KRX 단독·수정주가)와 비교하고, 내부 계산값이 원천과 맞는지 검사한다. 읽기 전용이고 KIS 는 호출하지 않는다. pykrx 는 운영 의존성이 아니라서 `uv run --with pykrx` 로만 쓴다.

```bash
# 1) 별도 터미널에서 개발 DB 터널 유지(PG 15432 · CH 18123 — backend/.env.development 가 이미 가리킴)
./scripts/dev-db-tunnel.sh

# 2) 점검(기본: 일봉 최신일, 30종목, 보고서 ./spot_check_<date>.md)
cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 [--date YYYY-MM-DD] [--seed S] [--out PATH]
```

- **외부:** 우리 일봉은 KRX+넥스트레이드 통합 시세다. 그래서 고가≥·저가≤·거래량≥ 이면 정상이고, 거래량이 같으면(NXT 미상장) OHLC 도 같아야 한다. 분류는 일치·통합 정상·위반·missing(KRX 없음, 또는 우리 일봉이 없어 KRX 를 호출하지 않은 경우 — 오류 과반 계산에 안 셈)·오류다. pykrx 의 "KRX 로그인 실패" 경고는 무시해도 된다(개별 종목 OHLCV 는 로그인 없이 된다).
- **내부:**
  - (a) market_stock_daily 종가 = 일봉 종가
  - (b) 1일 등락 = 직전 봉 대비 재계산
  - (c) 테마·업종 1일 평균 = 구성 종목 평균(거래정지 제외)
  - (d) 같은 이름 그룹(경고)
  - 테마 소속·거래정지는 현재 PG 값이다. 그래서 구성 수가 다르면 "구성 변경 추정"(경고)으로 둔다.
- **종료 코드:** 0 이상 없음(경고만) / 1 위반·내부 불일치 또는 내부 점검 실패 / 2 그 날짜 일봉 없음 / 3 KRX 조회 오류가 표본의 과반(외부 비교 신뢰 불가).
- 보고서 파일은 커밋하지 않는다.

### 🗺️ 스크리너 탭 — 시장·테마·업종·일정 (스크리너 프로젝트 3)
설계 `docs/superpowers/specs/2026-10-19-market-dashboard-design.md`. 웹 `/screener/market|themes|sectors|calendar|leaders|finder`(`/screener` → 시장 탭, 비로그인 공개).
- **계산**: `collector.compute_market_groups` — 20:30 일일 파이프라인 맨 끝(CANSLIM 뒤). 보통주의 1·5·20일 등락·거래대금(종가×거래량)·시총(종가×상장주식수)을 CH `market_stock_daily`, 테마·업종 단순 평균·대장주·순위를 `market_group_daily` 에 저장. 관리자 테마 보정 API 가 바꿀 때마다 최신 기준일만 다시 계산(`send_task`).
- **처음 한 번**: 순위 추이·'n일째 상위'용 60거래일 — `uv run celery -A apps.collector.celery_app call collector.backfill_market_groups` (과거 날짜도 현재 테마 소속 기준).
- **API(stock_api GraphQL)**: `marketOverview`(지수·FRED 거시 — 장중엔 Redis 장중 값을 덧씌워 `MarketIndex.live`·`asOf`, 지수·거시 CH 조회 30초 메모리 캐시, resolver 는 스레드풀 실행), `marketGroups(kind, period, sort, limit, offset)`, `marketTreemap(kind, size, period)`, `marketGroup(kind, id)`, `marketCalendar(start, end, category)`.
- 기준값(테마 최소 3종목·상위 10위 연속)은 `apps/collector/market_groups/compute.py` 상수, 트리맵 색 상한(1일 ±5%·5일 ±10%·20일 ±20%)은 `web_client/src/lib/treemap.ts`.

### 🔎 CANSLIM 스크리너 (스크리너 프로젝트 2) — 화면 이름 '주도주'
설계 `docs/superpowers/specs/2026-10-18-canslim-design.md`. 웹 `/screener/leaders`(스크리너 탭 '주도주', `?ticker=` 로 종목 바로 열기, 비로그인 공개). 앱은 스크리너 탭 '주도주' 칩(시장 방향 줄·정렬·필터 바텀시트·50개씩 더 불러오기) + 종목 상세 `/stock/[ticker]`(같은 GraphQL, 서버 변경 없음 — 쿼리는 `mobile/src/features/leaders/api.ts`, 계약 테스트 `backend/tests/test_market_query.py`).
- **앱↔웹 알려진 차이**: 50일선 색이 다르다(앱 청록, 웹 주황). 분석 비대상 종목(ETF 등)의 일봉 차트는 가짜 캔들일 수 있다. 앱의 typedRoutes 타입 파일은 새 환경에서 dev 서버(`npx expo start`)를 한 번 띄워야 생성된다.
- **계산**: `collector.compute_canslim` — 20:30 일일 파이프라인 마지막 단계(일봉 → 국내 지수 → 투자자 → CANSLIM)와 토 10:40(재무 수집 뒤). 보통주 전체의 7항목 판정·0~100 점수를 CH `canslim_daily`·`canslim_market` 에 저장(같은 날 재계산은 멱등).
- **처음 한 번**: 점수 추이용 60거래일 채우기 — `uv run celery -A apps.collector.celery_app call collector.backfill_canslim` (과거 날짜도 실적은 최신값 사용).
- **API(stock_api GraphQL)**: `canslimMarket`, `canslimScreen(market, minPass, required, sort, liquidOnly, limit, offset)`, `canslimScore(ticker)`.
- **C(분기 실적)**: `FUNDAMENTALS_Q_CUMULATIVE` 를 설정해야 켜진다(그 전엔 '준비 중'). **실측(2026-10-22): KIS 분기 EPS 는 누적 → `true`** — 결산월 분기 EPS 가 같은 해 연간 EPS 와 11,494건 중 11,493건 일치(단독이면 약 1/4). 운영은 호스트 `/opt/stock_app/env/.env.production` 에 넣고 Deploy Server 재실행 → CANSLIM 60일 백필. A·I·M 은 재무·투자자·지수 데이터가 쌓인 뒤 "데이터 부족"이 풀린다.
- 기준값(25%·85%·RS 80 등)·가중치는 `apps/collector/canslim/rules.py` 상수.

### 🧮 조건검색 (스크리너 프로젝트 4) — 프리셋·커스텀 필터
설계 `docs/superpowers/specs/2026-10-21-screener-presets-design.md`, 계획 `docs/superpowers/plans/2026-10-21-screener-presets.md`. 웹 `/screener/finder`(스크리너 탭 '조건검색', 비로그인 공개), 앱은 스크리너 탭 '조건검색' 칩(프리셋 칩·필터 바텀시트·정렬·50개씩 더 불러오기, 행 → `/stock/[ticker]`).
- **대상·계산**: 분석 대상 보통주(CANSLIM·시장 탭과 같은 범위, 약 2,600종목). `collector.compute_screener` 가 매일 20:30 일일 파이프라인 **맨 마지막 단계**(시장 그룹 계산 뒤, 앞 단계 실패와 무관)에서 돌고, 결과를 CH `screener_daily` 에 저장한다(`ReplacingMergeTree`, 같은 날 재계산은 멱등, 조회는 `FINAL`; `daily_prices` 에는 컬럼을 더하지 않음). 저장 지표: 등락률·거래대금(종가×거래량)·시총(종가×상장주식수)·거래량 비율(당일/직전 20일 평균)·RSI(14, Wilder, 최근 100종가)·이동평균(5·20·50·60·120)·표준편차(20)·배열·직전 52주 고가와 신고가 경신·골든크로스(20/60) 경과일(0~2)·매물대 위쪽 비율(최근 120일·20구간)·연간 재무(ROE·EPS·BPS·PER·PBR·매출/영업이익 성장률·부채비율)·유동성(20일 평균 거래대금 10억·종가 1,000원 이상).
- **프리셋 4종**(서버 상수, 필터와 AND): `volume_surge` 거래량 비율 ≥ 2배 · `golden_cross` MA20이 MA60을 상향 돌파한 지 3거래일 이내(오늘 포함) · `oversold` RSI(14) ≤ 30 · `new_high` 당일 고가가 직전 251거래일 최고가를 넘음(52주 신고가 경신).
- **커스텀 필터**: 시장(KOSPI/KOSDAQ)·가격 범위·시총 범위(억 원)·거래대금 하한(억 원)·유동성만 보기(기본 켜짐)·거래량 비율 하한·RSI 범위·배열(정배열/역배열)·볼린저(σ 1·1.5·2·2.5·3, 그 밖은 2 + 위치 상단 돌파/하단 이탈/밴드 안 + 밴드폭 상한 %)·매물대 위쪽 비율 상한·ROE 하한·PER/PBR 범위·부채비율 상한·매출성장률 하한. 이상한 값(음수·뒤집힌 범위·숫자 아님)은 그 조건만 무시한다(ROE·매출성장률만 음수 허용). 정렬: 거래대금(기본)·등락률·거래량 비율·RSI·시총·매물대 위쪽 비율(오름차순).
- **API(stock_api GraphQL)**: `screenerScreen(preset, filters: ScreenerFilterInput, sort, limit, offset)` → `{ date, total, bbSigma, items }`(`limit` 최대 200). 쿼리는 `web_client/src/api/finder.ts`·`mobile/src/features/finder/api.ts`, 계약 테스트 `backend/tests/test_screener_contract.py`. 기준값은 `apps/stock_api/services/screener_query.py`(프리셋·σ·정렬)와 `apps/collector/screener/indicators.py`(기간·구간 수) 상수.
- **배포 후 꼭 할 일**
  1. Celery 워커와 stock_api 재시작 — 새 태스크 모듈 `apps.collector.tasks.screener` 와 바뀐 파이프라인 단계, 새 GraphQL 필드를 읽게 한다. 안 하면 20:30 에 스크리너 단계가 돌지 않는다.
  2. 처음 한 번 60거래일 채우기 — 서버에는 `uv` 가 없으니 워커 컨테이너 안에서 실행(compose·Swarm 공통):
     `docker exec $(docker ps -qf name=stock_celery_worker -f status=running | head -1) celery -A apps.collector.celery_app call collector.backfill_screener`
     (로컬은 `uv run celery -A apps.collector.celery_app call collector.backfill_screener`) — 워커 로그 "스크리너 백필: ok=… failed=…" 로 확인(일봉은 한 번만 읽고 날짜별로 잘라 쓴다). 계산 결과가 0행이거나 시도한 종목의 5% 이상 실패한 날은 실패(`failed`)로 남고, 일일 파이프라인에서는 `pipeline_record` 에 실패로 기록된다.
  3. 프리셋별 건수 점검(CH):
     ```sql
     SELECT count() AS total,
            countIf(liquid = 1) AS liquid,
            countIf(liquid = 1 AND vol_ratio20 >= 2) AS volume_surge,
            countIf(liquid = 1 AND gc_days IS NOT NULL) AS golden_cross,
            countIf(liquid = 1 AND rsi14 <= 30) AS oversold,
            countIf(liquid = 1 AND is_new_high = 1) AS new_high,
            countIf(vp_above_pct IS NULL) AS vp_null,
            countIf(per IS NULL) AS per_null
     FROM screener_daily FINAL
     WHERE date = (SELECT max(date) FROM screener_daily)
     ```
     기대: `total` 이 분석 대상 보통주 수 근처, 프리셋 4개가 0도 `liquid` 전체도 아님(보통 수십~수백). `vp_null` 은 상장 120일 미만 종목 정도, `per_null` 은 적자·재무 미수집 종목 정도. 아는 종목(예: 005930) 하나의 `rsi14`·`ma20`·`ma60`·`chg_1d`·`per` 를 한투 MTS 와 대조한다(RSI 는 입력 길이 때문에 1 안쪽 차이 허용).
- **알려진 한계**
  - 과거 날짜 백필은 최신 연간 재무를 쓰고 상장주식수·업종도 현재 프로필이라, 지난 날짜의 PER·PBR·시총은 근사값이다.
  - 재무는 필드별로 null 이 아닌 가장 최근 연간 값을 쓰므로(PER·ROE 가 통째로 비는 것 방지) 한 종목 안에서 지표마다 결산 연도가 섞일 수 있다.
  - KIS 연간 재무의 최신 행은 진행 중인 해의 누적(예: 202606 = 상반기)이다. EPS·ROE·성장률은 결산이 끝난 해만 쓰고(PER 이 약 2배로 부풀지 않게), BPS·부채비율은 시점 값이라 최신 행까지 쓴다. CANSLIM A(3년 성장)도 결산이 끝난 해만 본다. KIS 에 직전 연도 결산이 아직 없는 종목(약 400곳)은 그 전 해 값이 쓰인다.
  - 배당수익률(데이터 출처 없음)·MACD·저장 필터·알림은 없다. 관리자 작업 버튼은 '조건검색 계산'·'조건검색 60일 백필'(2026-10-22).
  - 앱 필터 시트는 `keyboardType="numeric"` 이라 iOS 숫자 키패드에 `-` 가 없어 ROE·매출성장률 음수 입력이 어렵다(Android 먼저, iOS 출시 전 `numbers-and-punctuation` 등으로 바꿀지 결정).


### 📐 차트 패턴 (스크리너 프로젝트 5) — 베이스·피벗·돌파·단계
- **무엇**: 매일 분석 대상 보통주의 일봉에서 베이스 패턴(컵·컵핸들·쌍바닥·플랫 베이스·박스권·하이 타이트 플래그)을 찾아 피벗(매수점)·깊이·길이·단계(베이스 카운트, 예 `2`·`1a`)·돌파 여부를 `chart_pattern_daily`(CH)에 저장. 엔진은 참고 프로젝트 v2 엔진(MarketSurge 화면에 맞춘 기준값)을 일봉 전용으로 그대로 이식(`apps/collector/patterns/`). 설계 `docs/superpowers/specs/2026-10-22-chart-patterns-design.md`.
- **화면**: 웹 `/screener/patterns`('패턴' 탭 — 리포트 형성 중·피벗 근접·오늘 돌파·최근 20일 돌파, 패턴·시장·정렬, 상세 차트에 피벗·매수 상단(+5%)·손절(−8%)·꼭짓점 마커와 베이스 이력), 앱 스크리너 '패턴' 칩 + 종목 상세 '차트 패턴' 영역.
- **API**: GraphQL `patternScreen(report, patternType, market, sort, limit, offset)`·`patternBases(ticker)`(stock_api, 공개).
- **계산**: `daily_market_pipeline` 마지막 단계(조건검색 다음, 20:30 시작). 최신 거래일 하나만 계산(과거 날짜 백필 없음 — 리포트는 최신 스냅샷만 씀). 새 결과를 먼저 넣고 성공하면 그날 이전 결과를 지운다(실패해도 기존 데이터 유지). 0행·종목 실패 5% 이상·기준일 봉 없는 종목 20% 이상이면 저장하지 않고 실패로 기록. 실측 약 35초(봉 로드 6초 + 감지 27초, 2,583종목).
- **전제 — 일봉 약 3년**: 엔진은 종목당 최근 770봉(표시 520 + 앞쪽 여유 250)을 본다. 처음 한 번 전종목 일봉을 37개월로 백필해야 긴 베이스·단계가 맞게 나온다(서버 워커 컨테이너에서):
  `docker exec $(docker ps -qf name=stock_celery_worker -f status=running | head -1) celery -A apps.collector.celery_app call collector.backfill_all_daily --kwargs '{"months": 37}'` — KIS 호출이 많아 약 1시간+, 20:30 수집과 겹치지 않게. 끝 날짜(`end`, YYYYMMDD)를 주지 않으면 마지막 확정 거래일(KST 평일 20:30 이후 오늘, 아니면 직전 평일)까지만 받아 장중 미완성 봉이 들어가지 않는다.
  **새 서버는 이 명령 대신 관리자 '초기 데이터 준비' 버튼**(일봉 37개월 → 지수·수급·재무 → 계산 전부를 순서대로, `docs/server_setup.md` §7-2)으로 한 번에 채운다.
- **수동 실행**: 관리자 작업 '차트 패턴 계산'(`collector.compute_patterns`).
- **알려진 한계**
  - 기준값은 미국 종목 MarketSurge 화면에 맞춘 값이다. 국내 상·하한가(±30%)·변동성 차이는 반영하지 않았다(실데이터 분포를 보고 조정 예정).
  - 일봉만(주봉 패턴 없음). 과거 날짜 스냅샷이 없어 차트의 베이스 이력은 최신 기준일에서 본 이력이다.
  - 돌파는 장중 고가가 피벗을 넘은 첫 봉(종가 아님, 거래량 조건 없음 — 참고 엔진·MS 와 같음). 돌파 거래량은 지표로만 표시.

### 🤖 AI 시황 분석 (ai_analyst) — 모닝 브리핑·급등락 원인·수급 해설·정성 평가
설계 `docs/superpowers/specs/2026-10-30-market-analyst-service-spec.md`, 계획 `docs/superpowers/plans/2026-10-30-market-tab-ai-analyst.md`. 코드 `backend/apps/ai_analyst/`(clients·schemas·prompts·repository·cache·services·tasks·router), 수급 수집 `backend/apps/collector/investor_flow.py`.
- **환경변수**: `GEMINI_API_KEY`·`GEMINI_MODEL`(기본 `gemini-3.8-flash` — `gemini-2.0-flash` 는 2026-06-01 종료)·`NAVER_SEARCH_CLIENT_ID/SECRET`(소셜 로그인 키와 별개, 검색 API 권한 필요)·`OPENDART_API_KEY`·`KRX_ID/KRX_PW`(pykrx 로그인). 위 "주요 환경변수" 표 참고, 이름은 `backend/.env.example`.
- **키가 없을 때(Graceful Fail)**: 아무것도 깨지지 않는다. 태스크는 `{"skipped": ...}` 로 끝나고, API 는 항상 200 + 빈 값(`brief: null`, 빈 목록 등). Gemini 만 없으면 급등락·수급 숫자는 그대로 나오고 원인·해설만 `null`. 네이버·DART 가 없으면 뉴스·공시 없이 분석. KRX 로그인이 없으면 수급은 KIS 폴백(`source: "kis"`, 연기금 빈 목록). Redis·PG·ClickHouse 장애도 API 는 200 + 빈 값.
- **Celery 스케줄**(beat, KST, `apps/collector/celery_app.py` 의 `ai-*`):

  | beat 키 | 태스크 | 시각 | 동작 |
  |---|---|---|---|
  | `ai-morning-briefing` | `ai.generate_morning_briefing` | 평일 08:30 | 미국 지수·거시·뉴스 → Gemini → PG `ai_daily_briefings`. 거래일만, 같은 날 이미 있으면 재사용 |
  | `ai-market-movers` | `ai.analyze_market_movers` | 평일 9~15시 10분 간격 | 거래일 09:10~15:30 만 실행(09:00·15:40·15:50 은 skipped). Redis 잠금(9분) → KIS 등락률 순위 → 뉴스 → Gemini → Redis `ai:market:movers:today`(10분)·`ai:market:keywords:today`(30분) + 마지막 결과 `ai:market:*:last`(4일, 장 마감 뒤 화면용) |
  | `ai-investor-flow-close` / `ai-investor-flow-final` / `ai-investor-flow-after-pipeline` | `ai.collect_investor_flow` | 평일 15:45 / 18:10 / 22:00 | pykrx(→ KIS 폴백) 외국인·기관·연기금 Top 10·쌍끌이 + Gemini 2줄 해설 → Redis `market:investor_flow:today`(26시간). 18:10 은 확정치 갱신, 같은 기준일·출처면 해설 재사용. 22:00 은 KIS 폴백(KRX 로그인 없음)일 때 20:30 파이프라인이 적재한 당일 숫자로 갱신 |
  | `ai-screener-evaluation` | `ai.evaluate_screener_stocks` | 평일 16:00 | CANSLIM 상위 30종목 DART·뉴스 → Gemini 정성 평가 → PG `ai_stock_evaluations`(이미 평가한 종목 건너뜀) |

  수동 실행 예: `uv run celery -A apps.collector.celery_app call ai.generate_morning_briefing`
- **REST(stock_api, 공개 GET, `Cache-Control: public, max-age=30`)**:
  - `GET /api/v1/market/morning-brief` → `{"brief": {...} | null}` (오늘 것, 없으면 최근 1건)
  - `GET /api/v1/market/movers` → `{"updated_at", "gainers": [...], "losers": [...], "keywords": [...]}` (오늘 캐시가 없으면 마지막 결과 — 화면은 `updated_at` 을 보여 줄 것)
  - `GET /api/v1/market/investor-flow` → `{"date", "source", "foreign_top", "institution_top", "pension_top", "double_buy", "ai_comment", "updated_at"}`
  - `GET /api/v1/market/heatmap?kind=sector|theme&size=mcap|value&period=1d|5d|20d` → GraphQL `marketTreemap` 과 같은 결과 `{"date", "groups": [{"id","name","chg","size","stocks":[{"ticker","name","chg","size"}]}]}`. 잘못된 값은 422 `{"detail": {"code", "message"}}`
  - `GET /api/v1/ai/screener-analysis/{ticker}` → `{"analysis": {...} | null}` (ticker 는 영문·숫자 6자리, 아니면 422)
- **DB 마이그레이션**: 리비전 `8e2b4c6d1f30`(`ai_daily_briefings`·`ai_stock_evaluations`) — 배포 워크플로(`deploy-server.yml`)의 `alembic upgrade head` 로 적용된다. 배포 후 Celery **beat·워커 재시작**(새 태스크 모듈·beat 엔트리)과 stock_api 재시작(새 라우터).
- **미검증 항목(실호출 확인 필요)**
  - KIS 등락률 순위(`FHPST01700000`)의 하락률 정렬 코드 `"1"` — 공식 예제에 없음. 서비스가 등락 방향을 다시 걸러서 틀려도 상승 종목이 하락 목록에 섞이지는 않지만, 하락 목록이 비어 있으면 이 값을 의심.
  - KIS 투자자 순매수 거래대금(`*_ntby_tr_pbmn`) 단위를 백만원으로 가정(×1,000,000 → 원). 검증 방법은 `apps/collector/investor_flow.py` 주석.
  - pykrx 순매수 응답 컬럼명(`종목명`·`순매수거래대금`) — 설치본 소스 기준, 컬럼이 없으면 경고 로그 후 KIS 폴백.

## 🔔 알림 아키텍처
- **웹(SSE)**: 블로그 서비스의 `GET /api/v1/notifications/stream` 에 EventSource 로 연결 → 새 글 작성 시 Redis pub/sub 로 즉시 토스트 알림.
- **새 글 앱 알림(Expo 푸시)**: 관리자 웹 글 **작성** 화면의 "앱 알림 보내기"를 체크한 글만(`POST /api/v1/blogs` 의 요청 전용 필드 `notify`) Celery `collector.send_new_post_notification` 에 위임한다. 대상은 `push_devices` ⨝ `users` — 활성 사용자, 역할 등급 ≥ 게시판 `min_role_required`, 기기의 `post_notice=true`(펀드 등록 여부와 무관). 제목 `[게시판] 새 글`, 본문 글 제목, Android 채널 `blog-post`. 무효 토큰은 지우고, 결과는 로그로만 남긴다(발송 이력 없음). 웹 SSE `new_post` 는 체크와 상관없이 모든 새 글에 발행. `users.fcm_token` 은 더 이상 쓰지 않는다(컬럼만 남음).
  - 앱: 로그인 + 알림 권한이면 펀드가 없어도 기기를 등록한다(`fund_notice`=펀드 ≥1, `post_notice`=내정보 "새 글 알림" 스위치, 기본 켜짐; 저장에 실패하면 스위치를 되돌리고 토스트로 안내). 알림 탭 → 글 상세, 앱이 앞에 있을 때는 새 글만 배너. 권한 안내 시트는 로그인 후 홈 탭·펀드 첫 등록·펀드 화면 진입 중 한 번.
- **펀드 리포트 알림(푸시 + SSE)**: 관리자 웹 `/fund-notices` → blog 관리자 API(`/api/v1/admin/fund-notices`·`push-sends`·`push-templates`) → Celery `collector.send_fund_notice` 가 `push_devices` 의 토큰으로 `PUSH_BACKEND=expo` 발송기(Expo Push → FCM)를 호출하고 SSE `fund_report_updated` 도 발행한다. 알림 메시지 뒤에 깨우기용 무음 메시지(`fund_refresh`)를 한 번 더 보낸다. 앱은 `PUT/DELETE /api/v1/push-devices` 로 토큰을 등록·해제한다. 만료 토큰(`DeviceNotRegistered`)은 서버가 지운다.
  - **예약 발송**: Celery beat `dispatch-scheduled-pushes`(`collector.dispatch_scheduled_pushes`, **1분마다**)가 예약 시각이 지난 건을 집어 발송한다. 오래 멈춘 `sending` 은 15분 뒤 `failed` 로 정리. 워커를 중단해 두면 재기동 후 지연 발송된다. 새 beat 엔트리이므로 배포 때 **beat 재시작**이 필요하다.

### 펀드 알림 배포 메모
1. 운영 DB 마이그레이션: 배포 워크플로(`deploy-server.yml`)가 `alembic upgrade head` 를 실행하는지 확인(새 리비전 `b9c0d1e2f3a4`, `push_devices`·`push_sends`·`push_templates`).
2. 서버 env 에 `PUSH_BACKEND=expo` — **EAS 에 FCM V1 키를 올린 뒤에** 바꾼다(먼저 바꾸면 Expo 가 `InvalidCredentials` 로 전부 실패, 이력에 실패로 남을 뿐 서비스 영향은 없음). 선택 `EXPO_ACCESS_TOKEN`.
3. Celery **beat 재시작**(새 엔트리 `dispatch-scheduled-pushes`) 및 워커 재시작.

### 새 글 알림 배포 메모
1. 운영 DB 마이그레이션: 새 리비전 `c1d2e3f4a5b6`(`push_devices.post_notice`, 기존 행은 true) — 배포 워크플로의 `alembic upgrade head` 로 자동 적용된다.
2. **서버를 먼저 배포해도 안전**: 구버전 앱은 펀드 등록 기기만 등록하고 `post_notice` 를 안 보내 기본 true → 그 기기들만 새 글 알림을 받는다. 새 앱 빌드를 배포해야 알림을 허용한 모든 로그인 기기로 넓어진다.
3. blog·Celery 워커 재시작(새 beat 엔트리 없음).

## 🛠 데이터 스토어
- **PostgreSQL**: 사용자·게시판·게시글·댓글 등 관계형 데이터
- **ClickHouse**: 주식 시계열/보조지표 — `daily_prices`(`ReplacingMergeTree(ingested_at)`, 멱등 적재·조회 FINAL), `fundamentals`
- **Redis**: Celery 브로커 + SSE pub/sub + 캐시

## 🚀 배포 (미니PC — 서버/웹 분리)

배포는 GitHub Actions self-hosted 러너(미니PC)에서 동작하며, **대상별 두 워크플로**로 분리돼 있다(프론트 배포가 수집 워커/API를 건드리지 않도록). 상세·명령은 [`docs/run_and_deploy.md`](docs/run_and_deploy.md), 서버 최초 부트스트랩은 [`docs/server_setup.md`](docs/server_setup.md).

> 📈 **상용 수평 확장(Docker Swarm · Kubernetes)**: 설정은 `deploy/swarm/`·`deploy/k8s/`, 초보자용 단계별 가이드는 [`docs/deploy/README.md`](docs/deploy/README.md).

> 🔁 **무중단 배포(단일 서버)**: compose `up -d` 는 옛 컨테이너를 먼저 꺼서 배포마다 수십 초 502 가 났다 → 앱 9개만 단일 노드 Swarm(start-first)으로 옮기는 전환을 준비했다(DB 는 compose 그대로). 1회 전환 `bash deploy/swarm/cutover.sh`, 되돌리기 `rollback-to-compose.sh`, 절차 [`docs/deploy/single-node-swarm.md`](docs/deploy/single-node-swarm.md). 워크플로는 스택 `stock` 이 있으면 Swarm(`deploy/swarm/deploy.sh`), 없으면 기존 compose. 웹·앱은 조회(GET·GraphQL query)만 연결 실패·502~504 에 1·3·6초 재시도(`web_client/src/lib/retry.ts`, `mobile/src/lib/api/retry.ts`).

| 워크플로 | 자동 트리거(경로) | 배포 대상 |
|---|---|---|
| `deploy-server.yml` | `backend/**`, `docker-compose.prod.yml` | auth/stock/blog API + trading_game(8004, `game.haezean.com`)·game_ws(KIS 실시간) + celery worker/beat. 기동 전 `alembic upgrade head` 자동 |
| `deploy-web.yml` | `web_client/**`, `admin_web/**`, `docker-compose.prod.yml` | web_client(3000) + admin_web(3001) |
| `deploy-prod.yml` | 태그 `release/vX.Y.Z` push(또는 수동, 태그 입력) | **상용 서버** 백엔드+웹 전체 — 지금은 꺼져 있음(`PROD_DEPLOY_ENABLED`), 상용 서버 준비 절차 [`docs/deploy/prod-release.md`](docs/deploy/prod-release.md) |

- **자동**: `dev → main` 병합 후 push → **변경 경로에 해당하는 워크플로만** 실행(각자 지정 서비스만 `up -d --build`, 나머지 컨테이너·볼륨 보존).
- **수동**: GitHub **Actions** 탭 → `Deploy Server`/`Deploy Web` → **Run workflow**(Branch `main`), 또는 `gh workflow run deploy-server.yml --ref main`. 수집 시간(매일 20:30)을 피해 배포할 때 사용.
- ⚠️ 최초 배포 후 **스키마 부트스트랩 1회** 필수(`server_setup.md §7`). **DB 포트(5432/8123/9000/6379)는 LAN 전용** — Cloudflare 터널에 노출 금지.
- **간편 로그인 배포 체크**: 서버 `backend/.env.production` 에 `KAKAO_REST_API_KEY`(+`KAKAO_CLIENT_SECRET`)·`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`·`SOCIAL_STATE_SECRET`·`SOCIAL_REDIRECT_BASE=https://auth.haezean.com/api/v1/auth/social`·`SOCIAL_WEB_RETURN_URL=https://app.haezean.com/auth/complete` 설정(파일은 gitignore — 여기가 유일한 기록). 공급자 콘솔에 등록할 **Redirect URI**:
  - 로컬: `http://localhost:8001/api/v1/auth/social/kakao/callback`, `http://localhost:8001/api/v1/auth/social/naver/callback`
  - 개발 서버: `https://auth.haezean.com/api/v1/auth/social/kakao/callback`, `https://auth.haezean.com/api/v1/auth/social/naver/callback`
  - 카카오는 플랫폼 > Web 사이트 도메인(`http://localhost:3000`, `https://app.haezean.com`)도 등록, 동의항목에서 **닉네임** 활성화. 네이버는 서비스 URL·Callback URL 등록, 제공 정보에 **별명** 선택 — **검수 전에는 등록한 테스트 계정만** 로그인 가능.
  - 앱 복귀는 커스텀 스킴(`stockapp://auth`)이라 공급자 콘솔 등록 대상이 아니다(공급자는 항상 auth 콜백으로 돌아오고, auth 가 앱으로 302).

## 📚 문서
- **일상 실행·배포 빠른 참조: `docs/run_and_deploy.md`**
- **DB 접속(DataGrip/DBeaver, 개발서버 터널 포함): `docs/db_access.md`**
- 아키텍처: `docs/architecture_plan.md`
- AMS 참고 분석: `docs/ams-reference/`
- 기능별 프롬프트: `docs/prompts/`
- **배포(미니PC + Cloudflare Tunnel + GitHub Actions)**:
  - 서버 최초 설정 런북: `docs/server_setup.md`
  - 배포 아키텍처/트러블슈팅: `docs/deployment_guide.md`
  - SSH 무포워딩 접속(Termius): `docs/cloudflare_termius_guide.md`
