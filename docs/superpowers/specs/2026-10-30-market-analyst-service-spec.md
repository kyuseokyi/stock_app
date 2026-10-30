# 시장(Market) 탭 독립 및 AI 시황/스크리너 서비스 상세 스펙

> **문서 상태**: 확정 (클로드 코드가 바로 코딩 가능한 상세 구현 스펙)  
> **작성일**: 2026-10-30  
> **관련 문서**: [`docs/ai_market_analyst_plan.md`](../ai_market_analyst_plan.md), [`docs/superpowers/specs/2026-10-19-market-dashboard-design.md`](2026-10-19-market-dashboard-design.md), [`docs/screener_plan.md`](../screener_plan.md)

---

## 1. 메뉴 및 정보 전면 재배치 (시황 탭 신설 & 스크리너 순수화)

### 1.1 개편 배경 및 핵심 원칙
* **기존 문제점**: 기존 스크리너 메뉴 안에 **시장(지수/FRED), 업종/테마 랭킹, 트리맵(히트맵), 일정(공모주/지표), CANSLIM 주도주**가 모두 한 화면에 혼재되어 있어, "시장 흐름 파악(Top-down)"과 "종목 조건 발굴(Bottom-up)"의 사용자 목적이 충돌함.
* **개편 원칙**:
  1. **시황(Market) 탭 독립 신설**: 시장 거시 환경, 테마/업종 흐름, 히트맵, 캘린더 일정 등 '시장 전체를 조망하는 정보'를 완전히 시황 탭으로 이전. 여기에 **Gemini AI 시황(모닝 브리핑, 실시간 급등락 원인, 핫 키워드)**을 결합.
  2. **스크리너(Screener) 탭 본연의 목적 회복**: 스크리너는 순수 '종목 발굴/검색'에 집중 (CANSLIM 주도주, VCP 차트패턴, 추천 프리셋, 커스텀 조건검색). 스크리닝 결과 종목 카드에만 **Gemini AI 1줄 검증 뱃지(실적 품질, CB 지뢰 감지)**를 표시.

### 1.2 화면별 세부 정보 배치

#### [A] 시황 (Market) 탭 — "오늘 시장의 자금과 관심은 어디로 흐르는가?"
1. **상단: AI 모닝 글로벌 브리핑**: 매일 08:30 발행 (뉴욕증시 3대 지수 + SOX + 빅테크 마감 요약, 오늘 국장 수혜/주의 섹터 예측, 환율/유가/금리 매크로 체크)
2. **국내외 지수 & 매크로**: 코스피, 코스닥, 나스닥, S&P500 + 미니 추세선 및 FRED 주요 지표 (CPI, 고용, 기준금리)
3. **시장 히트맵 (업종/테마 트리맵)**: *(기존 스크리너에서 시황으로 완전 이전)* 코스피/코스닥 전 종목 업종별 등락 히트맵 (시총/거래대금 기준 토글)
4. **실시간 모멘텀 & AI 원인 분석기**: 당일 급등 Top 10, 급락 Top 10 + 네이버 속보 기반 **급등락 진짜 원인 1줄 요약 및 재료 뱃지**
5. **투자자별 수급 전광판 (pykrx 연동)**:
   * 외국인 순매수 Top 10 / 기관 순매수 Top 10 / 연기금 순매수 Top 10
   * **🔥 외인·기관 쌍끌이 순매수 주도주**
   * **[AI] 오늘 큰손 자금 이동 2줄 해설** (어느 섹터를 팔고 어디를 샀는지 요약)
6. **테마 & 업종 랭킹 & 핫 키워드**: 기간별(1일, 5일, 20일) 테마/업종 순위 + 섹터별 대장주 + 오늘 시장을 관통하는 **핫 키워드 Top 10**
7. **증시/경제 일정 캘린더**: *(기존 스크리너에서 시황으로 완전 이전)* 공모주 청약/상장 일정, 경제지표 발표일, 선물옵션 만기일

#### [B] 스크리너 (Screener) 탭 — "내 원칙에 맞는 알짜 종목은 어디 있는가?"
1. **주도주 스크리너 (CANSLIM)**: 윌리엄 오닐 원전 7항목 정량 판정 통과 종목 목록 + **[AI] 1줄 포착 사유 + DART 실적 품질 + 지뢰(CB) 뱃지** (I항목에 pykrx 연기금/외인 실데이터 연동)
2. **수급 기반 추천 프리셋**:
   * `[외인 5일 연속 순매수]`
   * `[연기금 집중 매집주 (10일 연속)]`
   * `[외인·기관 쌍끌이 52주 신고가]`
3. **차트 패턴 스크리너**: 마크 미너비니 VCP(변동성 축소 패턴), 컵앤핸들, 52주 신고가 근접, 베이스 카운트
4. **추천 기술 프리셋**: 골든크로스(20-60일), 거래량 급증(300%↑), 과매도 반등(RSI 30↓), 고배당주
5. **나만의 커스텀 조건 검색**: 재무(PER, PBR, ROE) + 기술(볼린저 밴드, 이평선 정배열/역배열, 매물대) 슬라이더 필터



---

## 2. 백엔드 아키텍처 및 패키지 구조

기존 `collector`, `stock_api`, `shared`의 무결성을 유지하면서, AI 시황 분석 전담 패키지를 `apps/ai_analyst/`로 독립 신설합니다.

```
backend/
  ├── apps/
  │    ├── collector/
  │    │    └── investor_flow.py     # [NEW] pykrx 기반 외인/기관/연기금 순매수 전종목 수집
  │    ├── ai_analyst/               # [NEW] AI 시황 분석 전담 패키지
  │    │    ├── __init__.py
  │    │    ├── clients/             # 외부 API 통신 클라이언트
  │    │    │    ├── __init__.py
  │    │    │    ├── gemini_client.py # Google GenAI SDK (Gemini 2.0/1.5 Flash)
  │    │    │    ├── naver_news.py    # 네이버 검색 Open API (뉴스)
  │    │    │    └── opendart.py      # OpenDART 전자공시 API
  │    │    ├── schemas.py           # Pydantic DTO (구조화된 AI 응답 모델)
  │    │    ├── prompts.py           # Gemini 시스템/유저 프롬프트 템플릿
  │    │    ├── services/            # 비즈니스 로직
  │    │    │    ├── __init__.py
  │    │    │    ├── morning_brief.py # 모닝 글로벌 시황 생성기
  │    │    │    ├── market_movers.py # 급등락 원인 분석기
  │    │    │    ├── investor_flow_ai.py # [NEW] 외인/기관 수급 AI 해설
  │    │    │    └── stock_qualitative.py # 스크리너 종목 AI 정성 분석기
  │    │    ├── tasks.py             # Celery Beat 주기적 태스크
  │    │    └── router.py            # FastAPI REST API 라우터
  ├── shared/
  │    └── config.py                 # 환경변수 추가 (GEMINI, NAVER, OPENDART 키)
```

---

## 3. 데이터베이스 스키마 및 캐시 설계

### 3.1 PostgreSQL 테이블 (Alembic 마이그레이션)

#### 테이블 1: `ai_daily_briefings` (일별 모닝 글로벌 시황)
```sql
CREATE TABLE ai_daily_briefings (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,              -- 발행일 (YYYY-MM-DD)
    headline VARCHAR(255) NOT NULL,         -- 브리핑 핵심 헤드라인
    us_market_summary TEXT NOT NULL,        -- 뉴욕증시 마감 요약
    kr_impact_summary TEXT NOT NULL,        -- 한국 증시 영향 예측
    bullish_sectors JSONB NOT NULL,         -- 수혜 예상 섹터 및 이유 [{"sector": "AI반도체", "reason": "..."}]
    bearish_sectors JSONB NOT NULL,         -- 주의 예상 섹터 및 이유 [{"sector": "정유", "reason": "..."}]
    macro_checkpoints JSONB NOT NULL,       -- 거시경제 체크포인트 목록
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_ai_daily_briefings_date ON ai_daily_briefings (date);
```

#### 테이블 2: `ai_stock_evaluations` (스크리너 통과 종목 정성 분석 캐시)
```sql
CREATE TABLE ai_stock_evaluations (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL,
    date DATE NOT NULL,                     -- 분석 기준일
    hook_summary VARCHAR(255) NOT NULL,     -- 1줄 포착 사유
    growth_quality VARCHAR(50) NOT NULL,    -- 실적 품질 (본업성장 / 일회성이익 / 회계착시)
    financial_quality_note TEXT NOT NULL,   -- DART 재무제표 분석 근거
    red_flag_level VARCHAR(20) NOT NULL,    -- 지뢰 위험도 (CLEAN / WARNING / DANGER)
    red_flags JSONB DEFAULT '[]'::jsonb,    -- 감지된 리스크 (CB/BW 전환물량, 대주주 매도 등)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_ticker_date UNIQUE (ticker, date)
);
CREATE INDEX idx_ai_stock_eval_date ON ai_stock_evaluations (date);
```

### 3.2 Redis 캐시 키 구조 (실시간 데이터 서빙)
* **급등락 AI 원인 캐시**:
  * 키: `ai:market:movers:today`
  * TTL: 600초 (10분)
  * 값: JSON 문자열 (상승 Top 10, 하락 Top 10의 원인 및 신뢰도 분석 결과)
* **오늘의 핫 키워드 캐시**:
  * 키: `ai:market:keywords:today`
  * TTL: 1800초 (30분)
  * 값: JSON 배열 (Top 10 키워드, 발생 배경, 관련 종목군)

---

## 4. 외부 클라이언트 및 프롬프트 상세 스펙

### 4.1 Gemini Client (`gemini_client.py`)
* 라이브러리: `google-genai` (Google GenAI 공식 신규 SDK) 또는 `google-generativeai`
* 모델: `gemini-2.0-flash` (비용 최적화 및 구조화 JSON 출력 완벽 지원)
* 호출 옵션:
  ```python
  from google import genai
  from google.genai import types

  client = genai.Client(api_key=settings.GEMINI_API_KEY)
  response = client.models.generate_content(
      model='gemini-2.0-flash',
      contents=prompt_text,
      config=types.GenerateContentConfig(
          response_mime_type="application/json",
          temperature=0.2, # 금융 팩트 기반이므로 낮은 온도 유지
      ),
  )
  ```

### 4.2 네이버 뉴스 검색 클라이언트 (`naver_news.py`)
* **신규 규격 (NAVER API HUB, 권장)**:
  * Endpoint: `GET https://naverapihub.apigw.ntruss.com/naversearch/v1/search/news.json`
  * Headers:
    * `X-NCP-APIGW-API-KEY-ID`: `config.naver_search_client_id()` (콘솔의 API Key ID)
    * `X-NCP-APIGW-API-KEY`: `config.naver_search_client_secret()` (콘솔의 API Key)
* **레거시 규격 (Developers Open API, 호환 유지)**:
  * Endpoint: `GET https://openapi.naver.com/v1/search/news.json`
  * Headers:
    * `X-Naver-Client-Id` / `X-Naver-Client-Secret`
* **호환성 처리**:
  * `NAVER_SEARCH_API_HUB=true` (기본값) 설정 시 최신 NAVER API HUB 규격으로 호출하며, `false` 설정 시 구규격으로 폴백 지원.
* **쿼리 규칙**:
  * 급등락 원인 검색: `query=f"{stock_name} 특징주"` (sort='date', display=5)
  * 테마/이슈 검색: `query=f"{theme_name} 관련주"` (sort='sim', display=5)


### 4.3 Pydantic 스키마 정의 (`schemas.py`)

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class MoverReasonItem(BaseModel):
    ticker: str
    stock_name: str
    change_rate: float
    reason_summary: str = Field(description="급등 또는 급락의 핵심 원인 1문장 (30자 내외)")
    category: str = Field(description="수주계약 | 실적호조 | 테마수급 | 경영권 | 유상증자/악재 | 단순수급")
    reliability: str = Field(description="상 | 중 | 하 (뉴스 실체 여부)")
    risk_warning: Optional[str] = Field(None, description="단기 추격매수 시 주의점")

class MarketMoversResponse(BaseModel):
    updated_at: str
    gainers: List[MoverReasonItem]
    losers: List[MoverReasonItem]

class MorningBriefingResponse(BaseModel):
    headline: str
    us_market_summary: str
    kr_impact_summary: str
    bullish_sectors: List[dict] # {"sector": str, "reason": str}
    bearish_sectors: List[dict]
    macro_checkpoints: List[str]

class ScreenerQualitativeResponse(BaseModel):
    ticker: str
    hook_summary: str
    growth_quality: str # "본업성장" | "일회성이익" | "불확실"
    financial_quality_note: str
    red_flag_level: str # "CLEAN" | "WARNING" | "DANGER"
    red_flags: List[str]
```

---

## 5. Celery 배치 태스크 스케줄 (`tasks.py`)

| 태스크 이름 | 실행 스케줄 (KST) | 동작 설명 |
| :--- | :--- | :--- |
| `task_generate_morning_briefing` | 평일 **08:30** | 전일 미국 3대 지수 + SOX + 빅테크 마감 + 환율 + FRED 지표를 모아 모닝 브리핑 생성 후 DB/Redis 저장 |
| `task_analyze_market_movers` | 평일 **09:10 ~ 15:30 (10분 간격)** | KIS API 등락률 상/하위 10개 종목 조회 → 네이버 뉴스 검색 → Gemini로 사유 추출 후 Redis 갱신 |
| `task_collect_investor_flow` | 평일 **15:45 & 18:10** | `pykrx`로 코스피/코스닥 전 종목 외인/기관/연기금/개인 순매수 일괄 수집 → Top 10 순위 산출 및 Gemini 2줄 수급 해설 생성 후 Redis 캐시 |
| `task_evaluate_screener_stocks` | 평일 **16:00** | 당일 CANSLIM 통과 종목 10~30개에 대해 DART 공시/뉴스 및 pykrx 수급 조회 → AI 정성 평가 후 DB 저장 |

---

## 6. FastAPI REST 엔드포인트 명세 (`router.py`)

Prefix: `/api/v1/market` (또는 `/api/v1/ai`)

1. **`GET /api/v1/market/morning-brief`**
   * 당일 08:30에 생성된 모닝 글로벌 브리핑 반환 (없으면 최근 1건)
2. **`GET /api/v1/market/movers`**
   * 실시간 급등락 Top 10 종목 및 AI 1줄 원인 요약 반환 (Redis 캐시 기반)
3. **`GET /api/v1/market/investor-flow`**
   * 당일 외국인, 기관, 연기금 순매수 Top 10 및 쌍끌이 종목, AI 수급 해석 코멘트 반환
4. **`GET /api/v1/market/heatmap`**
   * (기존 스크리너 API에서 시황으로 라우팅 이전) 섹터/테마별 트리맵 데이터 반환
5. **`GET /api/v1/ai/screener-analysis/{ticker}`**
   * 특정 스크리너 통과 종목의 AI 정성 분석 카드(실적 품질, 리스크 지뢰) 반환


---

## 7. 클로드코드(Claude Code) 구현 체크리스트

클로드코드로 작업 시 아래 순서대로 정확하게 진행합니다:

- [x] **Step 1: 환경변수 및 의존성 추가**
  - `requirements.txt` / `pyproject.toml`에 `google-genai` 또는 `google-generativeai` 추가
  - `shared/config.py`에 `GEMINI_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `OPENDART_API_KEY` 선언
  - > 구현: `backend/pyproject.toml`(google-genai·pykrx), `backend/shared/config.py` getter 함수 — 네이버 검색은 `NAVER_SEARCH_CLIENT_ID/SECRET` 로 분리, 모델 기본 `gemini-3.8-flash`, `KRX_ID/KRX_PW` 추가([계획](../plans/2026-10-30-market-tab-ai-analyst.md) "조정한 것").
- [x] **Step 2: 외부 API 클라이언트 모듈 작성**
  - `apps/ai_analyst/clients/gemini_client.py` (비용 최적화된 flash 모델 연결)
  - `apps/ai_analyst/clients/naver_news.py` (네이버 뉴스 검색)
  - `apps/ai_analyst/clients/opendart.py` (DART 전자공시 검색)
  - > 구현: `backend/apps/ai_analyst/clients/` 3종(키 없으면 None) + KIS 등락률 순위 `backend/apps/collector/kis/ranking.py`(하락 정렬 코드 실호출 미검증, [계획](../plans/2026-10-30-market-tab-ai-analyst.md)).
- [x] **Step 3: Pydantic 스키마 및 프롬프트 정의**
  - `apps/ai_analyst/schemas.py`, `apps/ai_analyst/prompts.py`
  - > 구현: `backend/apps/ai_analyst/schemas.py`·`prompts.py` — 급등락 category 구분자 `|`, API 응답 모양은 [계획](../plans/2026-10-30-market-tab-ai-analyst.md) "API 계약".
- [x] **Step 4: AI 서비스 레이어 작성**
  - `apps/ai_analyst/services/morning_brief.py`
  - `apps/ai_analyst/services/market_movers.py`
  - `apps/ai_analyst/services/stock_qualitative.py`
  - > 구현: 위 3개 + 수급 해설 `services/investor_flow_ai.py`, 수급 수집 `backend/apps/collector/investor_flow.py`(pykrx → KIS `investor_daily` 폴백). 급등락은 장 마감 뒤용 `ai:market:*:last`(4일) 폴백 추가([계획](../plans/2026-10-30-market-tab-ai-analyst.md)).
- [x] **Step 5: DB 마이그레이션 (Alembic)**
  - `ai_daily_briefings`, `ai_stock_evaluations` 테이블 생성 마이그레이션 생성 및 실행
  - > 구현: `backend/shared/ai_models.py` + 리비전 `8e2b4c6d1f30`(제약 이름 `uq_ai_stock_eval_ticker_date`). 실행은 배포 워크플로의 `alembic upgrade head`(로컬 미실행, [계획](../plans/2026-10-30-market-tab-ai-analyst.md)).
- [x] **Step 6: Celery 태스크 및 FastAPI 라우터 등록**
  - `apps/ai_analyst/tasks.py`를 Celery beat에 스케줄링
  - `backend/apps/stock_api` 또는 main FastAPI 앱에 라우터 연결
  - > 구현: `backend/apps/ai_analyst/tasks.py`(`ai.*` 4종, beat 5항목 `apps/collector/celery_app.py`, 급등락은 9~15시 10분 beat + 태스크 안에서 09:10~15:30·nx 잠금), `apps/ai_analyst/router.py` → `apps/stock_api/main.py`. heatmap 은 `market_query.treemap` 위임([계획](../plans/2026-10-30-market-tab-ai-analyst.md)).
- [x] **Step 7: 유닛 테스트 및 Mock 통합 테스트 작성**
  - 외부 API 키가 없을 때도 Graceful Fail 하는지 테스트 검증
  - > 구현: `backend/tests/test_ai_config.py`·`test_ai_schemas_prompts.py`·`test_ai_repository.py`·`test_ai_services.py`·`test_ai_tasks.py`·`test_ai_router.py`(가짜 클라이언트·fakeredis·sqlite, 실제 외부 호출 0회, [계획](../plans/2026-10-30-market-tab-ai-analyst.md)).
