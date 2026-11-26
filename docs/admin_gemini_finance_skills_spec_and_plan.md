# 관리자 전용 AI 종목 심층 분석기 (Open-Source Finance Skills + Gemini API 결합) 기획 및 구현 명세서

> **작성일**: 2026-11-26  
> **상태**: 확정 (클로드 코드가 바로 구현 가능한 상세 기획 및 단계별 구현 계획)  
> **목적**: 오픈소스 금융 분석 스킬 저장소인 **[`himself65/finance-skills`](https://github.com/himself65/finance-skills) (MIT 무료)**와 **[`tellmefrankie/ai-investment-skills`](https://github.com/tellmefrankie/ai-investment-skills) (무료 티어 스킬)**의 핵심 분석 알고리즘 및 프롬프트 프레임워크를 우리 서버의 **국내 주식 실데이터(ClickHouse 일봉·패턴·재무·수급 + OpenDART 공시 + 뉴스)** 및 **Google Gemini API(`GEMINI_API_KEY`)**와 결합하여, **관리자(`admin_web`)만 단독으로 열람·활용하는 AI 종목 심층 분석 워크스테이션(`/market/ai-lab`)**을 구축한다.  
> **법무·라이선스 안전성 (100% 본인 전용)**: 일반 사용자 웹(`web_client`)이나 모바일 앱(`mobile`)에는 노출하지 않고 `require_admin` 인증 가드로 보호되는 **관리자 전용 페이지**에서만 실행되므로, 시세 재배포·네이버 뉴스 AI 입력·유사투자자문업 규제로부터 완전히 자유롭고 구체적인 매수 피벗·손절가·시나리오별 목표가(EV)까지 제한 없이 산출할 수 있다.

---

## 1. 도입하는 5대 무료 오픈소스 스킬 & 국내 주식 데이터 매핑

해외 오픈소스 스킬들이 기본으로 사용하는 `yfinance` 대신, **우리 서버가 이미 매일 수집하고 있는 KIS/ClickHouse/OpenDART/네이버 뉴스 정밀 데이터**를 파이썬으로 먼저 계산한 뒤 각 스킬의 분석 규칙(Rubric)을 Gemini API에 주입합니다.

| # | 채택한 무료 오픈소스 스킬 | 원본 출처 | 핵심 분석 알고리즘 (파이썬 정량 계산 + Gemini 정성 판정) | 연결되는 우리 서버 국내 주식 데이터 |
| :--- | :--- | :--- | :--- | :--- |
| **Skill 1** | **`sepa-strategy`**<br>(마크 미너비니 SEPA & VCP 전략) | `himself65/finance-skills` (MIT) | • **Stage 1~4 단계 판별** (Stage 2 상승 국면인지 검증)<br>• **8가지 추세 템플릿(Trend Template)** 체크리스트 (주가 > 50 > 150 > 200일선, 200일선 1·5개월 기울기, 52주 저점 +30% / 고점 -25% 이내, RS ≥ 70)<br>• **VCP(변동성 축소) & 베이스 카운트**, 피벗 돌파 거래량(20일 평균 1.5x↑), 진짜/가짜 돌파 판별<br>• **리스크 기반 포지션 사이징** (손절폭 ≤ 7~8%, 손익비 ≥ 2:1) | • CH `daily_prices` (최근 2년 일봉 → 50/150/200일선 & 기울기 직접 계산)<br>• CH `canslim_daily` (`rs_score`, 52주 고저)<br>• CH `chart_pattern_daily` (VCP/컵앤핸들/피벗/손절가) |
| **Skill 2** | **`ev-calculator`**<br>(3-시나리오 확률 가중 기대값 계산기) | `tellmefrankie/ai-investment-skills` (Free) | • **Bull(강세) / Base(기본) / Bear(약세)** 3가지 시나리오별 예상 목표가·손절가 및 실현 확률(%) 산출<br>• 수급(외인·연기금), 뉴스 촉매, 섹터 모멘텀을 가중치로 반영한 **확률 가중 기대수익률(`Weighted EV %` & 기대 손익금)** 및 신뢰도(`HIGH / MEDIUM / LOW`) 판정 | • CH `investor_daily` & `investor_detail_daily` (외인·기관·연기금 연속 순매수)<br>• CH `market_group_daily` (소속 테마·업종 모멘텀)<br>• 지지·저항 및 POC 매물대 가격 |
| **Skill 3** | **`company-valuation`**<br>(내재가치 & 상대가치 멀티플 적정주가) | `himself65/finance-skills` (MIT) | • **Peer 상대가치(Relative Valuation)**: 동일 업종(`sector_m`) 내 상장사들의 중앙값(Median) PER·PBR·ROE 대비 현재 종목의 할증/할인율 및 적정 주가 밴드 산출<br>• **성장성 반영 간이 DCF / 멀티플 타겟**: 최근 3년 매출/영업이익 성장률과 부채비율·실효세율 기반 Bull/Base/Bear 적정주가 및 민감도 분석 | • CH `fundamentals_periodic` (연간·분기 EPS, BPS, SPS, ROE, 매출·영업이익 증가율, 부채비율)<br>• CH `screener_daily` (`per`, `pbr`)<br>• PG `stock_profile` (`sector_m`, 시가총액, 상장주식수) |
| **Skill 4** | **`earnings-recap`**<br>(실적 서프라이즈 & 이익 품질 검증) | `himself65/finance-skills` (MIT) | • 최근 4개 분기 매출·영업이익률(OPM)·순이익률·EPS 추이(YoY 및 QoQ 가속 여부) 분석<br>• **이익의 질(Quality of Earnings)**: 매출 성장 없는 비용 절감형 이익인지, 영업이익 중심의 본업 성장인지, 전환사채(CB)/유상증자 오버행은 없는지 판별 + 실적 발표 전후 주가 반응 분석 | • CH `fundamentals_periodic` (최근 5~8분기 실적 추이)<br>• `OpenDartClient` (`opendart.py` 최근 분기보고서·잠정실적·CB/BW 공시) |
| **Skill 5** | **`news-sentiment-engine`**<br>(촉매 임팩트 5단계 랭킹 & 감성 엔진) | `tellmefrankie/ai-investment-skills` (Free) | • 종목 관련 최신 뉴스 및 공시를 **5대 임팩트 위계(`1. 규제/정부정책 > 2. M&A/대규모수주/자금조달 > 3. 신기술/임상/신제품 > 4. 업황/수출변화 > 5. 일반 홍보`)**로 분류<br>• 각 뉴스의 임팩트 점수(`1~5점 ⭐`), 감성(`Positive / Negative / Neutral`), 주가 촉매 지속성 해설 및 원문 링크 카드 출력 | • `NaverNewsClient` (`naver_news.py` 최신·특징주 뉴스)<br>• 공개 경제 RSS + `OpenDartClient` 최근 30일 공시 목록 |

---

## 2. 관리자 전용 화면 UI / UX 설계 (`admin_web` > `/market/ai-lab`)

1. **사이드바 독립 메뉴 추가 & 기존 스크리너 원클릭 연동**:
   * 관리자 웹(`admin_web`)의 `시장 데이터` 그룹에 **`🧠 AI 종목 심층 분석 (/market/ai-lab)`** 메뉴를 신설합니다.
   * 또한 기존의 **4대 스크리너(`주도주`, `5·20 정배열`, `조건검색`, `차트 패턴`)** 및 앞서 기획한 **`🔥 급등락·거래대금 분석(/market/daily-surge)`**의 우측 상세 패널에 **`[🧠 AI 스킬 심층 분석 열기]`** 버튼을 달아, 포착된 종목을 클릭 한 번으로 즉시 분석할 수 있게 연결합니다 (`?ticker=053800`).

2. **화면 와이어프레임 (`/market/ai-lab`)**:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🧠 AI 종목 심층 분석 워크스테이션 (관리자 전용 · Open-Source Finance Skills + Gemini)      │
│ 국내 주식 실데이터(일봉·재무·수급·공시·뉴스)를 5대 무료 금융 스킬 프레임워크로 정밀 진단합니다. │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🔎 종목 선택: [ 053800 안랩 (KOSDAQ)        🔍 ]   💰 내 가상 투입금(사이징 계산용): [ 10,000,000 ] 원 │
│ 🛠️ 실행 스킬: [✅ 전체 통합 진단] [🎯 SEPA & VCP] [💰 EV 기대값] [📊 밸류에이션] [🧾 실적품질] [📰 뉴스촉매]│
│                                                    [⚡ 캐시 무시하고 Gemini로 지금 새로 분석] │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ 📌 [종합 판정 카드]  안랩 (053800)  | 종가 71,500원 (+18.18%) | 거래대금 3,447억 | RS 92점  │
│ • SEPA 단계 : 🟢 Stage 2 (상승 추세 · Base 2단계)  | 추세 템플릿: 8 / 8 통과 (Pass)        │
│ • 기대값(EV): 📈 Weighted EV +14.8% (+1,480,000원) [신뢰도: HIGH] | 손익비 2.8 : 1        │
│ • 밸류에이션: ⚖️ 업종(IT소프트웨어) 중앙 PER 24.5배 대비 현재 19.8배 (적정 밴드 68,000~84,000원)│
│ • 촉매/실적 : ⭐ 5/5 (정책/예산 확대) | 영업이익 YoY +34% 본업 성장 · 오버행(CB) 위험 없음 │
├──────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ 🎯 [Skill 1] 마크 미너비니 SEPA & VCP    │ 💰 [Skill 2] 3-시나리오 기대값 (EV Calculator)  │
│ ──────────────────────────────────────── │ ─────────────────────────────────────────────── │
│ ✅ 1. 주가 > 150일(58,200) & 200일(55,100)│ • 🐂 Bull (35% 확률): 86,000원 (+20.3%)         │
│ ✅ 2. 150일선 > 200일선 정배열           │   근거: 국가망 보안 예산 확대 + 외인·기관 쌍끌이│
│ ✅ 3. 200일선 기울기: 1개월 +4.2% 상승중 │ • ⚖️ Base (45% 확률): 75,000원 (+4.9%)          │
│ ✅ 4. 50일선(62,400) > 150·200일선       │   근거: 단기 급등 후 70,000원 위 박스권 소화    │
│ ✅ 5. 현재가(71,500) > 50일선            │ • 🐻 Bear (20% 확률): 66,500원 (-7.0% 손절선)   │
│ ✅ 6. 52주 저점(44,000) 대비 +62.5% (≥30%)│   근거: 피벗(67,000원) 하향 이탈 시 돌파 실패   │
│ ✅ 7. 52주 고점(74,000) 대비 -3.4% (≤25%)│ ─────────────────────────────────────────────── │
│ ✅ 8. 상대강도(RS): 92점 (≥70점 통과)    │ 👉 가중 기대수익률(Weighted EV): +14.8% (+148만원)│
│ • 패턴 & 타점: 컵앤핸들 피벗(67,000원)   │ 👉 권장 손절가: 66,500원 (-7.0%) / 권장 비중 25%│
│   거래량 640% 돌파 (진성 돌파 확인)      │                                                 │
├──────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 📊 [Skill 3 & 4] 밸류에이션 & 실적 품질  │ 📰 [Skill 5] 뉴스 & 공시 촉매 임팩트 (Top 5)    │
│ ──────────────────────────────────────── │ ─────────────────────────────────────────────── │
│ • 동종업계(소프트웨어 42사) 비교:        │ 1. [⭐⭐⭐⭐⭐ 5/5 · 정책/규제] 📈 Positive     │
│   - 업종 중앙 PER 24.5x / 당사 19.8x     │    "[단독] 국가망 클라우드 보안 예산 2배 확대"  │
│   - 업종 중앙 ROE 11.2% / 당사 15.4%     │    해설: 구조적 매출 상향 촉매 [원문 링크 ↗]    │
│ • 최근 4분기 실적 추이 (DART/KIS):       │ 2. [⭐⭐⭐⭐ 4/5 · 수주/공시] 📈 Positive       │
│   - 26.1Q 영업이익 +18% → 2Q +26% →      │    "공공 클라우드 보안 공급계약 체결 (DART)"    │
│     3Q +34% (3분기 연속 EPS 가속 확인!)  │    해설: 본업 수주잔고 증가 확인 [공시 링크 ↗]  │
│ • 지뢰(Red Flag) 점검: CLEAN             │                                                 │
└──────────────────────────────────────────┴─────────────────────────────────────────────────┘
```

---

## 3. 백엔드 아키텍처 및 데이터 파이프라인 설계

### 3.1 왜 "파이썬 정량 전처리 + Gemini 스킬 프롬프트" 하이브리드인가?
[`himself65/finance-skills`](https://github.com/himself65/finance-skills)의 `sepa-strategy/SKILL.md` 원문에도 다음과 같은 핵심 규칙이 명시되어 있습니다:
> *"Compute the moving averages, 200MA slope, 52-week range, volume ratio, and relative performance from daily price history in code rather than estimating them"* (이동평균선, 200일선 기울기, 52주 고저, 거래량 배수, 상대강도는 LLM이 어림짐작하지 말고 반드시 코드로 먼저 정확히 계산해서 넘겨라!)

따라서 우리 백엔드는 다음 **2단계 파이프라인**으로 동작합니다:

1. **Step A — 파이썬 정량 팩트 계산기 (`backend/apps/ai_analyst/skills/quant_facts.py`)**:
   * ClickHouse와 PostgreSQL에서 해당 종목의 데이터를 읽어 **오차 0%의 정량 팩트 JSON**을 계산합니다:
     * **SEPA 8조건 정량 판정**: 최근 300거래일 일봉에서 `MA50`, `MA150`, `MA200`, `1개월 전 MA200`, `5개월 전 MA200`, `52주 최고/최저가`, `20일 평균 거래량 대비 당일 거래량 배수`, `RS 점수`를 정확히 계산해 8개 조건 각각의 `pass: true/false`와 실제 수치를 산출합니다.
     * **업종 상대가치 & 유동성 지표**: 동일 업종(`sector_m`) 종목들의 중앙값(Median) `PER`, `PBR`, `ROE`와 최근 60일 일평균 거래대금(ADTV), 회전율, Amihud 비유동성 지표를 계산합니다.
     * **분기/연간 실적 및 수급 팩트**: 최근 4개 분기 및 3개년 EPS·매출·영업이익 성장률, 최근 20거래일 외국인·기관·연기금 누적 순매수 금액을 추출합니다.
     * **뉴스 & DART 공시 원문**: `OpenDartClient` 최근 60일 공시 + `NaverNewsClient` 최신/특징주 뉴스 10건을 가져옵니다.

2. **Step B — 오픈소스 스킬 루브릭 기반 Gemini 구조화 추론 (`backend/apps/ai_analyst/skills/skill_runner.py`)**:
   * Step A에서 계산된 정량 팩트 JSON과 5대 오픈소스 스킬(`sepa-strategy`, `ev-calculator`, `company-valuation`, `earnings-recap`, `news-sentiment-engine`)의 판단 루브릭을 시스템 프롬프트로 결합하여 `gemini_client.generate_json()`을 1회 호출합니다.
   * 결과는 PostgreSQL `admin_ai_skill_reports` 테이블에 저장되어, 관리자가 언제든 이력을 다시 열람하거나 날짜별로 비교할 수 있습니다.

---

### 3.2 신규 DB 테이블 (`admin_ai_skill_reports`)
```sql
CREATE TABLE admin_ai_skill_reports (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL,
    stock_name VARCHAR(100) NOT NULL,
    as_of_date DATE NOT NULL,                      -- 분석 기준 거래일
    quant_facts JSONB NOT NULL,                    -- 파이썬이 계산한 정량 팩트(SEPA 8조건 수치, 업종 멀티플, 실적, 수급)
    sepa_analysis JSONB NOT NULL,                  -- Skill 1: Stage(1~4), 베이스 단계, 돌파 품질, 피벗/손절가, 포지션 사이징
    ev_scenarios JSONB NOT NULL,                   -- Skill 2: Bull/Base/Bear 목표가·확률·근거, Weighted EV %, 신뢰도
    valuation_analysis JSONB NOT NULL,             -- Skill 3: 업종 상대가치(PER/PBR/ROE 비교), Bull/Base/Bear 적정주가 밴드
    earnings_recap JSONB NOT NULL,                 -- Skill 4: 최근 분기 실적 서프라이즈, 이익의 질(본업/일회성), 오버행 리스크
    news_catalysts JSONB NOT NULL,                 -- Skill 5: 5단계 임팩트 기준 Top 5 뉴스/공시 랭킹, 별점(1~5), 감성, 원문 링크
    overall_verdict VARCHAR(50) NOT NULL,          -- 종합 판정 ('STRONG_SETUP' | 'WATCH_PIVOT' | 'HOLD_WAIT' | 'AVOID_STAGE4')
    executive_summary TEXT NOT NULL,               -- 3줄 핵심 투자 메모
    model_name VARCHAR(50) NOT NULL,               -- 사용한 Gemini 모델명
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_admin_skill_report_ticker_date UNIQUE (ticker, as_of_date)
);
CREATE INDEX idx_admin_skill_reports_date ON admin_ai_skill_reports (as_of_date DESC);
```

---

### 3.3 관리자 전용 REST API 엔드포인트 (`backend/apps/ai_analyst/skills/router.py`)
> ⚠️ 모든 엔드포인트는 `Depends(require_admin)`으로 보호되어 관리자 본인만 호출할 수 있습니다.

| 메서드 & 경로 | 설명 |
| :--- | :--- |
| `POST /api/v1/admin/ai-skills/analyze/{ticker}` | 특정 종목(`ticker`)에 대해 5대 오픈소스 스킬 + Gemini 심층 분석 실행 (`?force_refresh=true` 시 캐시 무시하고 즉시 재생성, `?capital=10000000` 포지션 사이징 기준 자본금 전달) |
| `GET /api/v1/admin/ai-skills/reports` | 최근 내가 분석한 종목 리포트 히스토리 목록 조회 (`?limit=30`, 종합 판정·Weighted EV·SEPA Stage 요약 표시) |
| `GET /api/v1/admin/ai-skills/reports/{ticker}` | 특정 종목의 가장 최근(또는 `?date=YYYY-MM-DD`) 분석 리포트 조회 |
| `POST /api/v1/admin/ai-skills/batch-top` | **(일괄 자동 분석 버튼)** 당일 주도주 상위 5개 또는 당일 급등·거래대금 상위 5개 종목을 한 번에 배치로 분석 |

---

## 4. 클로드코드(Claude Code) 단계별 구현 계획

클로드 코드에서 작업할 때 아래 5단계 순서대로 진행합니다.

### Step 1: DB 모델(`AdminAiSkillReport`) 및 마이그레이션 추가
* `backend/shared/ai_models.py`에 `AdminAiSkillReport` 모델 추가 (기존 `AiDailyBriefing`, `AiStockEvaluation` 모델은 그대로 유지).
* Alembic 마이그레이션 생성 (`admin_ai_skill_reports` 테이블).

### Step 2: 5대 오픈소스 스킬 정량 전처리기 구현 (`backend/apps/ai_analyst/skills/quant_facts.py`)
* ClickHouse `daily_prices FINAL`에서 최근 300거래일 일봉을 읽어:
  * `MA50`, `MA150`, `MA200` 및 `MA200`의 20거래일(1개월)·100거래일(5개월) 기울기 계산.
  * `sepa-strategy`의 **8가지 추세 템플릿(Trend Template)** 각 항목 통불 여부(`pass: bool`)와 실제 값을 정확히 산출.
  * `stock-liquidity`의 60일 평균 거래대금(ADTV), 거래량 변동계수(CV), 회전율, Amihud 비유동성 등급 산출.
* ClickHouse `fundamentals_periodic`, `screener_daily`, PG `stock_profile`에서:
  * 동일 업종(`sector_m`) 중앙값 PER·PBR·ROE 대비 현재 종목의 상대 멀티플 격차 계산.
  * 최근 4분기 및 3개년 매출·영업이익·EPS 성장률 및 가속(Acceleration) 여부 계산.
* ClickHouse `investor_daily` / `investor_detail_daily`에서 외인·기관·연기금 수급 집계, `OpenDartClient` 및 `NaverNewsClient`에서 최신 공시·뉴스 원문 링크 수집.

### Step 3: 5대 오픈소스 스킬 프롬프트 & Gemini 실행기 구현 (`backend/apps/ai_analyst/skills/`)
* `backend/apps/ai_analyst/skills/schemas.py`:
  * `SepaSkillOutput`, `EvScenarioItem`, `EvCalculatorOutput`, `ValuationSkillOutput`, `EarningsRecapOutput`, `NewsCatalystItem`, `AdminSkillReportResponse` Pydantic 스키마 정의.
* `backend/apps/ai_analyst/skills/prompts.py`:
  * `himself65/finance-skills`(`sepa-strategy`, `company-valuation`, `earnings-recap`)와 `tellmefrankie/ai-investment-skills`(`ev-calculator`, `news-sentiment-engine`)의 분석 단계와 채점 루브릭을 한국 주식 시장(원화 호가, DART 공시, 외인/연기금 수급)에 맞게 이식한 시스템/유저 프롬프트 작성.
* `backend/apps/ai_analyst/skills/router.py`:
  * `require_admin` 전용 라우터 구현 및 `backend/apps/stock_api/main.py`에 등록.

### Step 4: 관리자 웹(`admin_web`) `/market/ai-lab` 워크스테이션 화면 및 스크리너 연동
* **신규 파일**:
  * `admin_web/src/api/aiSkills.ts`, `admin_web/src/types/aiSkills.ts`
  * `admin_web/src/pages/MarketAiLab.tsx`
* **수정 파일**:
  * `admin_web/src/components/Sidebar.tsx`, `admin_web/src/App.tsx`:
    * `시장 데이터` 사이드바에 `{ to: '/market/ai-lab', label: 'AI 종목 심층 분석', icon: '🧠' }` 추가.
  * 기존 스크리너(`MarketMaScreener.tsx`, `LeadersPage`, `MarketDailySurge.tsx`)의 종목 상세 헤더에 **`[🧠 AI 심층 분석]`** 바로가기 링크(`/market/ai-lab?ticker=${ticker}`) 버튼 추가.
* **화면 구성**:
  * 종목 검색 자동완성 + 투입 자본금 입력(기본 1,000만 원, SEPA 리스크 사이징 및 EV 기대 손익금 자동 환산) + `[⚡ Gemini 스킬 분석 실행]` 버튼 + 최근 분석 종목 히스토리 칩.
  * 상단 종합 판정 배너 + **① SEPA 8조건 체크리스트 & VCP 타점 카드**, **② Bull/Base/Bear 3-시나리오 기대값(EV) & 손절/비중 카드**, **③ 업종 상대가치 & 적정주가 밴드 카드**, **④ 분기 실적 가속 & DART 이익 품질 카드**, **⑤ 5단계 임팩트 뉴스/공시 촉매 랭킹(원문 링크 포함) 카드** + 하단 일봉 차트(`StockDailyChart`).

### Step 5: 테스트 및 검증
* `backend/tests/test_admin_ai_skills.py`:
  * `quant_facts.py`의 SEPA 8조건(50/150/200일선 정배열, 200일선 상승 기울기, 52주 고저 위치) 순수 함수 계산 정확도 테스트.
  * Fake Gemini 응답으로 `POST /api/v1/admin/ai-skills/analyze/{ticker}` 호출 시 DB 캐싱 및 Pydantic 스키마 정합성 검증.
  * 비관리자(일반 유저/익명) 호출 시 `401/403` 차단 검증.
* `admin_web`: `tsc --noEmit` 및 `vitest` 통과 확인.
