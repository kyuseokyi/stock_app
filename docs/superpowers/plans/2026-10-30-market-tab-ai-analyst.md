# 시황 탭 + AI 시황 분석(ai_analyst) 구현 계획

> **For agentic workers:** superpowers:subagent-driven-development 로 작업 단위마다 구현 → 리뷰.
> 스펙: [`specs/2026-10-30-market-analyst-service-spec.md`](../specs/2026-10-30-market-analyst-service-spec.md) (백엔드, 체크리스트 Step 1~7),
> [`specs/2026-10-30-mobile-market-tab-design.md`](../specs/2026-10-30-mobile-market-tab-design.md) (모바일).

**목표:** 시황 탭을 독립시키고(홈·시황·스크리너·게임·내정보), Gemini 기반 모닝 브리핑·급등락 원인·수급 해설·스크리너 정성 분석을 붙인다.
**원칙:** 외부 키(Gemini·네이버 검색·DART·KRX)가 없어도 아무것도 깨지지 않는다(Graceful Fail) — 태스크는 `{"skipped": ...}`, API 는 200 + 빈 값.

## 스펙과 실제 코드가 달라 조정한 것 (2026-10-30 조사)

| 스펙 | 실제 | 결정 |
|---|---|---|
| `shared/config.py` Settings | 저장소에 Settings 클래스 없음, 모듈마다 `os.getenv` getter(예: `fred.api_key()`) | `shared/config.py` 를 만들되 getter 함수로(`gemini_api_key()` 등) |
| 모델 `gemini-2.0-flash` | 공식 지원 종료 페이지 기준 2026-06-01 종료 | 기본 `gemini-3.8-flash`(현재 권장 안정), `GEMINI_MODEL` env 로 변경 가능 |
| `NAVER_CLIENT_ID/SECRET` | 소셜 로그인 앱 키 — 검색 API 권한과 별개, 바꾸면 로그인 깨짐 | 검색은 `NAVER_SEARCH_CLIENT_ID/SECRET` 로 분리(아직 미발급) |
| pykrx 투자자 수급 | KRX 가 로그인 요구 — `KRX_ID/KRX_PW` 없으면 빈 결과(실측) | pykrx 먼저(로그인 env 있을 때) → 실패·빈 결과면 CH `investor_daily`(KIS, 20:30 적재) 집계로 폴백. 폴백은 연기금 없음·기준일이 전 거래일일 수 있음 → 응답에 `source`·`date` |
| KIS 등락률 순위 | 코드 없음 | `FHPST01700000` `/uapi/domestic-stock/v1/ranking/fluctuation` 추가(공식 예제 파라미터). 하락률 정렬 코드 `"1"` 은 예제에 없어 **실호출 미검증**. UN→J 폴백, ETF·스팩은 `analysis_universe` 로 거름 |
| CANSLIM I 항목 pykrx 연동·수급 프리셋 | 체크리스트 밖, 기획서는 canslim 수정 금지 | 이번 범위 제외(후속) |
| 모바일 REST base URL | `EXPO_PUBLIC_STOCK_API_URL` 없음, env 파일 수정 금지 | `stockGraphqlUrl` 끝 `/graphql` 을 뗀 값(순수 함수 + 테스트) |

## API 계약 (stock_api, 공개 GET)

- `GET /api/v1/market/morning-brief` → `{"brief": Brief | null}` — 오늘 것, 없으면 최근 1건
  - Brief: `date, headline, us_market_summary, kr_impact_summary, bullish_sectors[{sector,reason}], bearish_sectors[{sector,reason}], macro_checkpoints[str], created_at`
- `GET /api/v1/market/movers` → `{"updated_at": str|null, "gainers": Mover[], "losers": Mover[], "keywords": Keyword[]}`
  - Mover: `ticker, stock_name, price|null, change_rate, reason_summary|null, category|null, reliability|null, risk_warning|null` (AI 없으면 원인 필드 null)
  - Keyword: `keyword, background, tickers[str]`
- `GET /api/v1/market/investor-flow` → `{"date": str|null, "source": "pykrx"|"kis"|null, "foreign_top": Flow[], "institution_top": Flow[], "pension_top": Flow[], "double_buy": Double[], "ai_comment": str|null, "updated_at": str|null}`
  - Flow: `ticker, name, net_amount`(원) · Double: `ticker, name, foreign_amount, institution_amount`
- `GET /api/v1/market/heatmap?kind=sector|theme&size=mcap|value&period=1d` → 기존 GraphQL `marketTreemap` 과 같은 서비스 결과(로직 복제 금지)
- `GET /api/v1/ai/screener-analysis/{ticker}` → `{"analysis": ScreenerQualitative | null}`

Redis 키: `ai:market:movers:today`(600s), `ai:market:keywords:today`(1800s), `market:investor_flow:today`(26h).
PG: `ai_daily_briefings`, `ai_stock_evaluations`(제약 이름 `uq_ai_stock_eval_ticker_date`).
Celery: `ai.generate_morning_briefing`(평일 08:30) · `ai.analyze_market_movers`(평일 9~15시 10분 간격, 태스크 안에서 09:10~15:30·거래일·nx 잠금 확인) ·
`ai.collect_investor_flow`(평일 15:45, 18:10) · `ai.evaluate_screener_stocks`(평일 16:00).

## 작업 단위

### 백엔드 (브랜치 `feature/ai-analyst`)
- **B1. 의존성·설정·클라이언트** — `uv add google-genai pykrx`, `shared/config.py`, `shared/env.py` FILE_ENV_KEYS, `.env.example` 키 이름,
  `apps/ai_analyst/clients/{gemini_client,naver_news,opendart}.py`, KIS 클라이언트에 등락률 순위 메서드. 테스트(주입 가능한 session/transport, 키 없음 → None).
- **B2. 스키마·프롬프트·모델·마이그레이션·서비스** — `schemas.py`, `prompts.py`, `shared/ai_models.py` + 손으로 쓴 마이그레이션(`down_revision="5c1e9a7d3b20"`),
  `apps/collector/investor_flow.py`(pykrx → CH 폴백), `services/{morning_brief,market_movers,investor_flow_ai,stock_qualitative}.py`. 테스트.
- **B3. 태스크·라우터·문서** — `apps/ai_analyst/tasks.py` + `celery_app.py` include·beat, `apps/ai_analyst/router.py` → stock_api `main.py`, README·스펙 체크리스트. 테스트(엔드포인트 200·키 없음·캐시 적중 시 Gemini 미호출).

### 모바일 (브랜치 `ui/market-tab`)
- **M1. 탭 재구성** — 5탭(홈·시황·스크리너·게임·내정보), 커뮤니티 목록 `src/app/blog/index.tsx` 로 이동 + 홈 링크, 시장 칩(개요·테마·업종·일정)을 `(tabs)/market.tsx` 로,
  스크리너는 주도주·조건검색·패턴만, 돌아가기 경로 `/screener` → `/market`(그룹 상세).
- **M2. 시황 탭 신규 섹션** — `stockApi` REST 클라이언트, AI 모닝 브리핑 카드(`surfaceBlue`, 바텀시트), 지수 가로 캐러셀, 트리맵(웹 `lib/treemap.ts` 이식),
  급등·급락 + AI 원인, 수급 전광판, 핫 키워드 칩, 일정 요약. 순수 함수 테스트(`*.test.ts`).
- **M3. 스크리너 AI 뱃지** — 주도주 카드에 포착 사유·지뢰 뱃지(`/api/v1/ai/screener-analysis/{ticker}`, 없으면 숨김).

## 공통 금지
`git add -A`/`git add .` 금지(경로 지정) · 실제 `.env*` 수정 금지 · 실제 KIS·Gemini·네이버·DART 호출 금지(테스트는 가짜) · 로컬 `alembic upgrade` 금지 ·
`rm -rf`·`git stash`·`git reset`·`git checkout --` 금지 · 커밋 메시지 한국어 + 끝 두 줄(Co-Authored-By, Claude-Session) · 비밀값 출력 금지.
