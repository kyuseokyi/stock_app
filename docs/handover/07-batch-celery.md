# 7. 배치 작업 — Celery 와 주식 데이터 수집

> 목표: "매일 밤 데이터가 어떻게 자동으로 쌓이는지" 를 설명하고, 수집이 실패했을 때 어디를 보고 어떻게 다시 돌리는지 안다.

## 7-1. 왜 따로 돌리나

API 서버는 "요청이 오면 바로 답하는" 일을 한다. 그런데 **전종목(약 2,500개) 일봉을 KIS 에서 받아오는 일은 수십 분**이 걸린다. 이런 일을 요청 처리 중에 하면 서버가 멈춘다.
그래서 오래 걸리거나 정해진 시간에 해야 하는 일은 **Celery** 라는 별도 프로그램이 맡는다.

| 구성요소 | 역할 | 실행 명령 (`backend/` 에서) |
|---|---|---|
| **beat** | 알람시계. 정해진 시각에 "이 작업 해라" 메시지를 Redis 에 넣는다 | `uv run celery -A apps.collector.celery_app beat --loglevel=info` |
| **worker** | 일꾼. Redis 에서 메시지를 꺼내 실제로 작업을 실행한다 | `uv run celery -A apps.collector.celery_app worker --loglevel=info` |
| **Redis** | 둘 사이의 우체통(브로커) | 도커 |

```
beat ──(20:30 "daily_market_pipeline")──▶ Redis ──▶ worker ──▶ KIS API ──▶ ClickHouse / PostgreSQL
API 서버(blog) ──("새 글 알림 보내")──────▶ Redis ──▶ worker ──▶ Expo Push ──▶ 사용자 폰
```

- **beat 는 반드시 1개만** 띄운다. 2개면 같은 작업이 두 번 실행된다.
- 설정 파일: `backend/apps/collector/celery_app.py` (시간대는 `Asia/Seoul`).
- 작업 코드: `backend/apps/collector/tasks/*.py`, AI 작업은 `backend/apps/ai_analyst/tasks.py`.

## 7-2. 하루 일정표 (beat 스케줄)

| 시각 (KST) | 작업 이름 | 하는 일 |
|---|---|---|
| 매일 20:30 | `collector.daily_market_pipeline` | **핵심.** 전종목 일봉 → 국내 지수 → 투자자 순매수 → CANSLIM → 시장 그룹 → 스크리너 → 차트 패턴 (차례로) |
| 매일 20:40 | `settle_trading_season` | 게임 시즌 정산 |
| 매일 21:00 | `collector.generate_chart_quiz` | 차트 퀴즈 문제 보충 |
| 매일 21:30 | `collector.collect_ipo_events` | 공모주 일정 |
| 평일 15:40 | `collector.collect_market_indices` (KR) | 국내 지수 종가 |
| 화~토 06:30, 07:30 | `collector.collect_market_indices` (US) | 미국 지수·환율·대표 종목 |
| 매일 08:00 | `collector.collect_macro_series` | 미국 거시 지표(FRED) |
| 30초마다 | `collector.poll_intraday_indices` | 장중 지수·환율 (장중에만 KIS 호출) |
| 1분마다 | `collector.dispatch_scheduled_pushes` | 예약된 펀드 알림 발송 |
| 토 10:00, 10:40 | `collect_fundamentals` → `compute_canslim` | 재무 수집 후 CANSLIM 재계산 |
| 월 08:50 / 매월 1일 08:55 | `close_trading_week` / `close_trading_month` | 게임 주간·월간 랭킹 마감 |
| 평일 08:30 등 | `ai.*` | AI 모닝 브리핑, 급등락 원인, 수급 해설, 스크리너 정성 평가 (키 없으면 건너뜀) |

> 정확한 최신 목록은 항상 `celery_app.py` 의 `beat_schedule` 이다. **beat_schedule 을 바꾸면 beat 를 재시작**해야 반영된다.

## 7-3. 일일 파이프라인 들여다보기

`apps/collector/tasks/market_data.py` 의 `daily_market_pipeline()`:

```python
steps = (("daily", _daily_ohlcv), ("indices_kr", ...), ("investor", ...),
         ("canslim", ...), ("market_groups", ...), ("screener", ...), ("patterns", ...))
for name, step in steps:
    try:
        out[name] = step()
    except Exception as e:
        log.exception("일일 파이프라인 단계 실패: %s", name)   # 한 단계가 실패해도 다음 단계는 계속
        out[name] = {"error": repr(e)[:300]}
pipeline_record.save(...)   # 단계별 성공 여부·걸린 시간을 Redis 에 기록 → 관리자 웹 '데이터 현황'에서 보임
```

## 7-4. KIS(한국투자증권) 수집 규칙 — 꼭 지킬 것

`CLAUDE.md` 의 규칙을 쉽게 풀면:

1. **시세는 통합(UN) 먼저, 비면 KRX(J)로 다시.** 넥스트레이드(NXT) 출범 후 증권사 앱 차트는 통합 시세를 보여 준다. 단 NXT 에 없는 종목은 UN 으로 조회하면 빈 응답이라 J 로 다시 물어야 한다. → `apps/collector/kis/fetcher.py`
2. **수정주가**는 액면분할·병합만 반영된다(배당은 반영 안 됨).
3. **전종목 목록**은 KIS 시세 API 가 주지 않는다. KRX `.mst` 파일을 매번 내려받아 파싱한다 → `apps/collector/stock_master.py`
4. **멱등 적재**: 같은 날짜를 다시 넣어도 `ReplacingMergeTree` 가 1행으로 정리한다. 조회는 항상 `FINAL` ([5장](./05-database.md)).
5. **호출 속도 제한**: `KIS_RATE_PER_SEC`(실전 15/모의 8), 병렬 `KIS_WORKERS`(기본 4). KIS 한도(초당 ~20)를 넘으면 차단된다.

KIS 키 설정: `backend/.env.development` 에 `KIS_MODE=vps`(모의) 또는 `prod`(실전), `KIS_APP_KEY`, `KIS_APP_SECRET`. 키가 없으면 가짜(Mock) 데이터로 동작한다.

## 7-5. 손으로 돌려 보기

```bash
cd backend
# 워커 없이 바로 실행 (함수를 직접 호출) — 디버깅할 때 가장 편하다
uv run python -c "from apps.collector.tasks.universe import collect_all_daily; print(collect_all_daily(source='mst'))"

# 종목 하나만 14개월 백필 (빠른 확인용)
uv run python -c "from apps.collector.tasks.backfill import backfill_domestic_daily; print(backfill_domestic_daily('005930', months=14))"

# 처음 서버에 데이터가 비어 있을 때 전종목 14개월 백필 (약 1시간)
uv run python -c "from apps.collector.tasks.universe import backfill_all_daily; print(backfill_all_daily(months=14))"
```
- 관리자 웹 **시장 데이터 › 데이터 현황**(`/market/status`)에서 KIS 를 안 쓰는 계산 작업(CANSLIM·시장 그룹)은 버튼으로 다시 돌릴 수 있다.
- 시장 데이터 표본 점검 CLI 는 [README "시장 데이터 표본 점검"](../../README.md#-시장-데이터-표본-점검-로컬-cli).

## 7-6. 게임 실시간 수집 데몬 (Celery 아님)

`apps/collector/run_game_ws.py` 는 KIS **WebSocket** 에 계속 붙어 있는 상주 프로그램이다(Celery 작업이 아니다).

```bash
uv run python -m apps.collector.run_game_ws                       # 실제 KIS (장 시간, 키 필요)
MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws # 가짜 틱 (장외·키 없이 테스트)
```
진행 중인(ACTIVE) 게임 시즌 종목의 체결가를 Redis `stock:tick:{종목}` 으로 보낸다. 운영에선 `game_ws` 컨테이너로 돈다.

## 7-7. 장애 대응 — "오늘 데이터가 안 들어왔어요"

1. 관리자 웹 **데이터 현황**에서 최신일과 파이프라인 단계별 결과를 본다.
2. 서버에서 컨테이너 상태 확인: `docker ps | grep celery` (worker·beat 둘 다 있어야 함).
3. 로그 확인: `docker logs --since 3h <celery_worker 컨테이너 이름> | grep -i "error\|실패"`.
4. 흔한 원인: KIS 키 만료/한도 초과, 휴장일(정상), worker 재시작 중 작업 유실, ClickHouse 연결 실패.
5. 원인을 고친 뒤 7-5 처럼 손으로 다시 돌린다(멱등이라 다시 돌려도 안전).

## 직접 해보기

1. 로컬에서 worker 를 켜고(`--loglevel=info`), 다른 터미널에서 관리자 웹으로 "앱 알림 보내기"를 체크한 글을 써 본다. worker 로그에 `send_new_post_notification` 이 찍히는지 본다(로컬은 `PUSH_BACKEND=mock` 이라 실제 발송 없이 로그만).
2. `celery_app.py` 의 `beat_schedule` 을 읽고 7-2 표와 다른 점이 있으면 이 문서를 고친다.
3. KIS 키가 있다면 `backfill_domestic_daily('005930', months=1)` 을 돌리고 ClickHouse 에서 `FINAL` 로 조회해 본다.

이전: [6. API](./06-api.md) · 다음: [8. 웹](./08-web.md)
