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
│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 FCM 푸시(Mock)
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
uv run celery -A apps.collector.celery_app beat   --loglevel=info   # 스케줄러(매일 20:30 전종목 수집 · 20:40 시즌 정산 · 21:00 퀴즈 풀 보충 · 월 08:50 주간 랭킹 마감 · 매월 1일 08:55 월간 랭킹 마감)

# 국내 주식 데이터 수집 — 수동 트리거 (워커 실행 중일 때)
# 전종목 일봉(겹침창) 수집:      collector.collect_all_daily
# 전종목 장기 백필(청킹):        collector.backfill_all_daily  (months=14)
# 단일 종목:                     collector.collect_daily_ohlcv / collector.backfill_domestic_daily
# 예) 워커 없이 즉시 실행:
uv run python -c "from apps.collector.tasks.universe import collect_all_daily; print(collect_all_daily(source='mst'))"
# 종목 마스터 소스: STOCK_MASTER_SOURCE=mst(전종목·.mst) | fallback(대형주 20) | auto(기본: mst→실패시 fallback)
# KIS 초당 호출 제한: KIS_RATE_PER_SEC(기본 8)

# 트레이딩 게임 실시간 시세 수집 데몬 (Phase 2) — ACTIVE 시즌 종목 틱을 Redis stock:tick:{ticker} 로 발행
# (Celery 아님. 단일 롱커넥션 상주 프로세스. ACTIVE 시즌이 있어야 함: python -m scripts.seed_trading_game)
MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws   # Mock 모드(장외/키 없이 검증)
# uv run python -m apps.collector.run_game_ws                       # 실 KIS WS(09:00~15:30 + NXT 애프터마켓 16:00~20:00, 키 필요)
# 체결 TR: 기본 H0UNCNT0(통합 KRX+NXT, 일봉 UN 종가와 일치). 구독 시 REST 일봉 UN 프로브가 빈 응답(NXT 미상장)이면
#   H0STCNT0(KRX). 프로브 실패 시 UN 시도 → UN 구독 2회 연속 거부면 H0STCNT0 런타임 폴백.
#   강제/롤백: GAME_WS_TR_ID=auto(기본)|H0UNCNT0|H0STCNT0|H0NXCNT0
#   TRADING_WINDOWS(기본 09:00-15:30,16:00-20:00, 분 단위) 밖 틱(NXT 프리마켓 등)은 발행하지 않음
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
- **환경변수**: `REDIS_URL`(기본 `redis://localhost:6379/0`) · `TRADING_WINDOWS`(기본 `09:00-15:30,16:00-20:00` KST — KRX 정규장+애프터마켓, NXT 프리마켓 제외) · `STALE_SECONDS`(기본 `10` — 최신가가 이보다 오래되면 주문 거부).
- **실시간 전송(묶기)**: 자동청산은 **모든 틱**에서 검사하되 포지션 메모리 캐시로 후보만 고르고 후보가 있을 때만 DB 확정(틱당 DB 조회 없음). 화면 전송은 최신 틱만 모아 `GAME_WS_TICK_INTERVAL_SEC`(기본 `0.25`)초마다 `{type:"tick"}` 1회(새 틱 없으면 전송 안 함), 개인손익 `position_pnl`·라이브 랭킹은 `GAME_WS_PNL_INTERVAL_SEC`(기본 `1.0`)초마다. 캐시는 주문·청산·보상 지급 시 즉시 무효화 + `GAME_POSITION_CACHE_TTL_SEC`(기본 `5`)초 주기 재적재(Celery 정산 등 다른 프로세스 변경 반영).
- **비로그인 공개 WS**: `ws://…:8003/ws/game/stream` 를 `token` 없이 연결하면 공개 연결(틱·시장심리만, 개인손익·넛지 없음). `token` 이 있으면 기존 검증 — 잘못된/빈 토큰은 4401(공개로 강등 안 함). 공개 연결 상한 IP당 `GAME_WS_PUBLIC_PER_IP`(기본 `3`)·전체 `GAME_WS_PUBLIC_MAX`(기본 `2000`), 초과 시 close `4429`(IP = `CF-Connecting-IP` 우선, 없으면 소켓 주소).
- **수평 확장(인스턴스 N개)**: WS 전달은 Redis Pub/Sub 버스(`game:ws:broadcast` — `aud: all|users`, `game:ws:user:{id}`) → 각 인스턴스가 자기 접속자에게만 전달(sticky 세션 불필요, 메시지 형식 불변). 틱 리스너(+자동청산)·틱 묶기·개인손익·시장심리는 **리더 1개만** 실행 — Redis 락 `game:leader:trading_game`(SET NX PX, ttl/3 주기 갱신, `GAME_LEADER_TTL_MS` 기본 `10000`). 리더가 죽으면(kill) 약 ttl + ttl/3 안에 다른 인스턴스가 승계(로컬 실측: ttl 3초 → 4.2초 후 틱 재개), SIGTERM 이면 락을 즉시 반납해 1초 안에 승계(실측 0.65초). 종료 시 클라이언트는 close 1012(uvicorn)를 받고 재연결. 주문 인스턴스의 캐시 무효화는 `game:cache:dirty` 로 리더에 알림(5초 TTL 재적재는 안전망). 단일 인스턴스(dev compose)도 같은 경로로 그대로 동작. 배포 설정은 `deploy/`·`docs/deploy/`.
- **헬스 프로브(모든 FastAPI 서비스)**: `GET /health` = 프로세스 생존(의존성 미검사, 기존 응답 그대로), `GET /ready` = DB `SELECT 1` + Redis `PING`(auth·blog·trading_game; stock_api 는 DB만) — 실패 시 503 `{"status":"not_ready","checks":{…}}`. 검사당 타임아웃 `READY_CHECK_TIMEOUT_SEC`(기본 `2`).
- **주문 이중 게이트**: 거래 세션 창 + 최신가 신선도. 둘 다 통과해야 체결(세션 밖/시세 끊김 → 409).
- **실시간 랭킹(Phase 4)**: Redis ZSET(`game:season:{id}:ranking`)에 매 틱 보유자 라이브 ROI·청산 시 실현 ROI 반영. 조회 — `GET /api/game/seasons/{id}/leaderboard`(Top100), `GET /api/game/seasons/{id}/my-rank`, `GET /api/game/hall-of-fame`.
- **시즌 정산(Phase 4)**: Celery beat `settle_trading_season` 매일 20:40 KST → 종료일 도래 시 ClickHouse 종가(종료일 당일, 주말·휴장이면 직전 거래일 — 평일 당일 봉이 없으면 보류 후 다음 날 전 종목 0행이면 휴장으로 판단, 최후 3일 뒤 폴백)로 전액 강제청산 → 명예의 전당 박제(+Trading MBTI) → 시즌 FINISHED + 차기 시즌 자동 생성(멱등). worker+beat 가동 필요(`uv run celery -A apps.collector.celery_app worker/beat`).
- **데일리 스마트 코치(Phase 5a)**: 관리자 `PUT /api/game/admin/coach-messages`(슬롯 upsert, `action=draft|publish` — 발행된 슬롯은 초안 저장 불가 409), `GET /api/game/admin/coach-messages?season_id&target_date`, `GET /api/game/admin/seasons`(ADMIN). 유저 `GET /api/game/coach/today`(KST 오늘·활성 시즌의 발행분, `active`=이브닝 우선). 발행 시 WS로 `{type:"coach", season_id, ...}` 전원 push(활성 시즌·오늘(KST) 브리핑일 때만).
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
- **게임 차트 분봉(일봉·1·5·15·60분)**: 마이그레이션 없음(ClickHouse 테이블 + `game_settings` 키). `game_ws` 가 발행한 틱을 1분봉으로 묶어 ClickHouse `game_minute_bars`(`ReplacingMergeTree(ingested_at) ORDER BY (ticker, ts)`, ts=분 시작 KST, `source`=`tick`|`kis`, 조회는 `FINAL`)에 저장 — 확정 바는 즉시, 진행 중 바는 15초마다(별도 큐·태스크라 CH 장애여도 틱 발행·게임 무관). 틱 시각은 발행 payload `timestamp`(KIS 체결시각), 거래량은 누적 거래량 증분 합. 테이블은 `game_ws` 시작 시 자동 생성(`init_clickhouse` 에도 포함). `game_ws` 시작·시즌 종목 전환 시 (종목, 날짜)당 1회 KIS 주식당일분봉조회(`FHKST03010200`, UN 우선 → 빈 응답이면 J)로 오늘 09:00~첫 틱 이전 분을 `source='kis'` 로 보충(이미 `tick` 행 있는 분·거래창 밖 제외, 주말·09:00 이전·Mock 모드는 생략, 실패는 로그만). Mock 틱(`MOCK_TICK_STREAM=true`)은 기본 미저장 — 로컬 스모크에서만 `GAME_MINUTE_BARS_MOCK=true` 로 저장. API `GET /api/game/candles?interval=1m|5m|15m|60m`(공개) → `{"interval","ticker","candles":[{"t"(버킷 시작 UTC epoch 초),"open","high","low","close","volume"}]}`, 범위는 데이터 있는 최근 거래일 1m=2·5m=5·15m=10·60m=20일, 활성 시즌 없으면 `ticker:null`, 데이터 없으면 `candles:[]`, 잘못된 단위 422, CH 장애·5초 무응답 503. 관리자 기본 단위 `game_settings.chart_interval_default`(`day`|`1m`|`5m`|`15m`|`60m`, 기본 `day`, `PUT /api/game/admin/settings`), `/api/game/rules` 에 `chart_interval_default`·`chart_intervals` 추가. 일봉은 기존 stock_api 경로 그대로.
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

### 4. 일반 유저 웹 (web_client)
일반 사용자(B2C)용 반응형 웹. 블로그/커뮤니티 조회 + SSE 실시간 알림 + **임시 로그인(닉네임)으로 댓글 작성**. 디자인은 **토스(Toss) 라이트 스타일**(`docs/mobile_design_language.md`의 토큰을 Tailwind `theme.extend`로 이식 — brand `#3182f6` 등)로 모바일과 통일.
> 헤더는 **2단 네비(커뮤니티·게임)**. 커뮤니티 섹션에서만 게시판 탭이 보이고, `/game`은 "시즌 준비 중" 스켈레톤(트레이딩 게임 백엔드 Phase 1~5 완성 후 실시간 화면으로 교체). 공통 UI는 `src/components/ui/`(Button·Card·Chip·EmptyState).
> 로그인은 **카카오·네이버 간편 로그인**(auth 서비스, 아래 "간편 로그인" 참조). 닉네임 게스트 로그인(`POST /api/v1/auth/guest`)은 **개발용** — 프론트 노출은 `VITE_ENABLE_GUEST_LOGIN`(미설정 시 dev serve 만 노출, 배포 빌드 숨김), 백엔드 허용은 auth 의 `AUTH_GUEST_ENABLED`(미설정 시 `APP_ENV=development|test` 에서만, 꺼지면 404). 둘은 짝으로 켜고 끈다. 댓글 작성 테스트에는 auth(8001)도 함께 띄워야 합니다.
```bash
cd web_client
npm install
npm run dev                            # http://localhost:3000
npm run build -- --mode development    # 빌드 검증(테스트 러너 없음 — 빌드 성공 + 육안)
```
> blog 서비스(8000)만 있으면 조회가 동작합니다. (`VITE_API_BASE_URL` 로 API 주소 오버라이드)
> `npm run build`(prod 모드)는 `VITE_API_BASE_URL`·`VITE_AUTH_BASE_URL` 누락 시 실패하므로, 로컬 검증은 `.env.development`를 로드하는 `-- --mode development`로 돌립니다.
- web_client 는 **TypeScript(strict)** 다. `npm run build` = `tsc --noEmit && vite build` 이므로 타입 에러가 있으면 빌드(및 Docker 배포 빌드)가 실패한다. 타입만 확인하려면 `npx tsc --noEmit`.
- API 응답 타입은 `web_client/src/types/`(백엔드 pydantic 스키마 기준)에 있다. 백엔드 응답 스키마를 바꾸면 admin_web 타입과 함께 갱신한다.
- **게임 탭(`/game`)** 은 trading_game(8003)·stock_api(8002, 일봉 차트)를 호출한다. 실시간 화면을 보려면 auth(8001)·blog(8000)와 함께 두 서비스도 띄운다. `VITE_GAME_API_URL`·`VITE_STOCK_API_URL`은 **선택** 변수 — dev 미설정 시 `http://localhost:8003`·`http://localhost:8002/graphql`, 배포 빌드 미설정이면 게임 탭은 "시즌을 준비하고 있어요"(빌드는 실패하지 않음). trading_game 운영 배포 전까지 필수 목록에 넣지 않는다.
- **게임 모달(6b)**: 헤더 `🏆 랭킹`(시즌 Top 100·명예의 전당 MBTI 칩, 비로그인 열람) · `🎯 퀘스트`(Q1~Q3 진행률·보상 수령·뱃지) · `🧩 퀴즈`(야간 10초 차트 퀴즈 — KST 15:30 이후·주말엔 주문 패널 위 배너, 관리자 플래그 QUIZ 가 꺼지면 숨김), 5x 🔒 칩 → 아카데미(활성 문항 전부 정답 시 5배 레버리지 해금), 헤더 `🔥 n일 연속` Streak 칩. 백엔드 변경 없음(Phase 5b API). 퀘스트·퀴즈·아카데미는 로그인 필요.
- **간편 로그인(카카오·네이버)**: 로그인 모달 버튼 → auth `GET /api/v1/auth/social/{kakao|naver}/start?client=web&cc=…` → 공급자 → auth 콜백 → `/auth/complete?code=…` → `POST /api/v1/auth/social/exchange {code, code_verifier}` 로 JWT 저장 후 원래 페이지로 복귀. **verifier(PKCE 방식)**: 시작 전 32바이트 난수 verifier 를 `sessionStorage`(`wc_social_verifier`)에 두고 `cc=base64url(SHA-256(verifier))` 만 보낸다 — 교환 코드만으로는 토큰을 받을 수 없음(로그인 CSRF 방지). `crypto.subtle` 이 필요하므로 https 또는 localhost 에서만 동작. 키가 없는 공급자 버튼은 숨김(`GET /api/v1/auth/social/providers`). 키 없이 로컬에서 흐름을 보려면 auth 를 `SOCIAL_FAKE_PROVIDER=true` 로 띄운다(공급자 대신 "테스트유저" 로그인, `APP_ENV` 가 명시적으로 `development`/`test` 일 때만 유효). 콜백·교환 코드는 Redis 를 쓰므로 Redis(도커)도 필요.
- **회원 탈퇴**: auth `DELETE /api/v1/auth/me {"confirm":"탈퇴"}`(인증 필요, 204 · 확인 문구 불일치 400 `CONFIRM_REQUIRED` · 관리자 403 `ADMIN_CANNOT_DELETE`) — 즉시 삭제(게임 계좌·거래·퀘스트·출석·퀴즈·댓글 CASCADE, 글·코치 메시지 작성자 NULL), 명예의 전당·주간 결과는 '탈퇴한 회원'으로 익명화, 커밋 후 Redis 랭킹 정리·카카오 연결 끊기(`KAKAO_ADMIN_KEY` 설정 시, 둘 다 실패해도 성공 처리).

### 5. 모바일 앱 (Expo / React Native)
Expo SDK 57 · React Native 0.86 · expo-router(하단 4탭: 홈/블로그/게임/내정보 — 스크리너·관심종목 탭은 제거됨) · **Unistyles v3**(테마 스타일링) · zustand.
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
```
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
- **공통 UI**: 공유 컴포넌트는 `mobile/src/ui/`에 있으며 토스 디자인 언어(`docs/mobile_design_language.md`)를 따른다.
- **테스트/검증**: 순수 로직 단위 테스트는 `cd mobile && npm test`(jest). 화면은 `npx tsc --noEmit`(+ 실기기 확인)로 검증한다. 이 프로젝트에는 eslint가 설정되어 있지 않아 모바일 lint 단계는 없다.
- **검증(설정 레벨)**: `npx tsc --noEmit` · `npx expo-doctor` · `APP_ENV=production npx expo config --type public --json`

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
| 새 글 실시간 알림(SSE)·푸시(Mock) | 위 + Redis(도커) + celery worker |
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
| `users` | 사용자(관리자·게스트·소셜) | email, nickname, provider, provider_id, role, is_active, password_hash, fcm_token |
| `boards` | 게시판 | name, order_index, is_active, min_role_required, comments_enabled |
| `blog_posts` | 게시글 | board_id, author_id, title, content, thumbnail_url, view_count, featured_at(홈 추천 켠 시각) |
| `blog_comments` | 댓글 | post_id, author_id, content |
| `push_templates` | 푸시 알림 템플릿 | title, body, last_sent_at |
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
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | auth | (빈값) | 카카오 로그인 키(시크릿은 콘솔에서 사용 설정 시만). 비면 카카오 버튼 숨김 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | auth | (빈값) | 네이버 로그인 키. 비면 네이버 버튼 숨김 |
| `SOCIAL_STATE_SECRET` | auth | (JWT_SECRET_KEY 폴백) | OAuth state 서명 키 — 운영은 별도 값(미설정 시 기동 경고) |
| `SOCIAL_REDIRECT_BASE` | auth | `http://localhost:8001/api/v1/auth/social` | 공급자 Redirect URI 앞부분(`/{kakao\|naver}/callback`). 개발 서버: `https://auth.haezean.com/api/v1/auth/social` (운영에서 기본값이면 기동 경고) |
| `SOCIAL_WEB_RETURN_URL` | auth | `http://localhost:3000/auth/complete` | 웹 복귀 주소. 개발 서버: `https://app.haezean.com/auth/complete` (운영에서 기본값이면 기동 경고) |
| `SOCIAL_APP_RETURN_URL_PROD` / `_DEV` | auth | `stockapp://auth` / `stockapp-dev://auth` | 앱 복귀 딥링크(앱 변형별) |
| `SOCIAL_FAKE_PROVIDER` | auth | `false` | `true` 면 가짜 공급자(로컬 스모크). `APP_ENV` 가 명시적으로 `development`/`test` 일 때만 유효(미설정·그 외는 무시), 켜지면 기동 경고 |
| `AUTH_GUEST_ENABLED` | auth | `APP_ENV` 가 `development`/`test` 일 때만 켬 | 닉네임 게스트 로그인(`POST /api/v1/auth/guest`) 허용(`true`/`false`). 꺼지면 404. 미설정+그 외 `APP_ENV`(미설정 포함)는 끔. 개발 서버(develop)는 `true`(웹 `VITE_ENABLE_GUEST_LOGIN=true` 와 짝), product 는 둘 다 `false` |
| `QUIZ_POOL_MIN_UNSEEN` / `QUIZ_POOL_BATCH` | collector | `100` / `50` | 퀴즈 정기 생성(21:00) — 미시도 문제 수가 MIN 미만이면 BATCH 개 생성 |
| `PUSH_BACKEND` | collector | `mock` | `mock` \| `fcm` (FCM은 자격증명 준비 후) |
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
| `KIS_RATE_PER_SEC` | collector | `8` | 전종목 수집 시 KIS 초당 호출 상한(실전 ~20 한도 내 보수적) |
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
| **develop** | `docker-compose.prod.yml` 의 **build args**(haezean 터널 URL) | 미니PC(Cloudflare 터널) | admin/app.haezean.com 이 `shared/cors.py` 에 코드로 포함 |
| **product** | 실서버 도메인 확정 시 build args 로 주입 | (미정) | 도메인 확정 시 `CORS_ORIGINS` env 로 추가 |

> **🔒 fail-fast (green-but-broken 차단)**: 배포 빌드(`vite build`)에서 `VITE_*` 가 비면 **localhost 로 폴백하지 않고 빌드가 실패**한다(`vite.config.js` + `src/config.js`). 과거 admin.haezean.com 이 localhost 를 부르던 류의 'green-but-broken' 배포를 원천 차단. dev serve(`npm run dev`)에서만 localhost 폴백을 허용한다.
>
> **CORS**: 프론트는 auth·blog·stock 3개 API를 모두 호출하므로 세 서비스가 동일 CORS 정책(`shared/cors.py`)을 공유한다. develop 도메인은 코드에 포함돼 서버 env 를 깜빡해도 CORS 가 동작한다.

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

## 🔔 알림 아키텍처
- **웹(SSE)**: 블로그 서비스의 `GET /api/v1/notifications/stream` 에 EventSource 로 연결 → 새 글 작성 시 Redis pub/sub 로 즉시 토스트 알림.
- **모바일(FCM)**: 새 글 작성 시 Celery 워커로 위임(`collector.send_new_post_notification`) → 대상 유저에게 푸시. 현재 발송기는 Mock(로그), `PUSH_BACKEND=fcm` + 자격증명으로 교체 예정.

## 🛠 데이터 스토어
- **PostgreSQL**: 사용자·게시판·게시글·댓글 등 관계형 데이터
- **ClickHouse**: 주식 시계열/보조지표 — `daily_prices`(`ReplacingMergeTree(ingested_at)`, 멱등 적재·조회 FINAL), `fundamentals`
- **Redis**: Celery 브로커 + SSE pub/sub + 캐시

## 🚀 배포 (미니PC — 서버/웹 분리)

배포는 GitHub Actions self-hosted 러너(미니PC)에서 동작하며, **대상별 두 워크플로**로 분리돼 있다(프론트 배포가 수집 워커/API를 건드리지 않도록). 상세·명령은 [`docs/run_and_deploy.md`](docs/run_and_deploy.md), 서버 최초 부트스트랩은 [`docs/server_setup.md`](docs/server_setup.md).

> 📈 **상용 수평 확장(Docker Swarm · Kubernetes)**: 설정은 `deploy/swarm/`·`deploy/k8s/`, 초보자용 단계별 가이드는 [`docs/deploy/README.md`](docs/deploy/README.md).

| 워크플로 | 자동 트리거(경로) | 배포 대상 |
|---|---|---|
| `deploy-server.yml` | `backend/**`, `docker-compose.prod.yml` | auth/stock/blog API + trading_game(8004, `game.haezean.com`)·game_ws(KIS 실시간) + celery worker/beat. 기동 전 `alembic upgrade head` 자동 |
| `deploy-web.yml` | `web_client/**`, `admin_web/**`, `docker-compose.prod.yml` | web_client(3000) + admin_web(3001) |

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
