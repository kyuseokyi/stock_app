# 관리자 전용 AI 종목 심층 분석기 (7대 오픈소스 금융 스킬 생태계 + Gemini API 결합) 기획 및 구현 명세서

> **작성일**: 2026-11-26 (2026-11-27 개정: **파이낸셜 서비스 · 바이브 트레이딩 · 트레이딩 스킬즈 · K 스킬 · 어썸 파이낸스** 5대 추가 오픈소스 생태계 통합 반영)  
> **상태**: 확정 (프론트엔드 UI 개편 전에 클로드 코드가 먼저 바로 구현할 수 있는 상세 명세 및 단계별 계획)  
> **목적**: 글로벌 및 한국 특화 **7대 무료 오픈소스 금융 AI 스킬 저장소**의 핵심 정량 알고리즘과 정성 분석 프레임워크를 우리 서버의 **국내 주식 실데이터(ClickHouse 일봉·패턴·재무·수급 + OpenDART 공시 + 한국은행 ECOS + 뉴스)** 및 **Google Gemini API(`GEMINI_API_KEY`)**와 결합하여, **관리자(`admin_web`)만 단독으로 열람·활용하는 AI 종목 심층 분석 워크스테이션(`/market/ai-lab`)**을 구축한다.  
> **법무·라이선스 안전성 (100% 본인 전용)**: 일반 사용자 웹(`web_client`)이나 모바일 앱(`mobile`)에는 노출하지 않고 `require_admin` 인증 가드로 보호되는 **관리자 전용 페이지**에서만 실행되므로, 시세 재배포·네이버 뉴스 AI 입력·유사투자자문업 규제로부터 완전히 자유롭고 구체적인 매수 피벗·손절가·시나리오별 목표가(EV)·인과 사슬·백테스트 승률까지 제한 없이 산출할 수 있다.

---

## 1. 통합하는 7대 무료 오픈소스 금융 스킬 생태계 총정리

기존 2개 저장소(`himself65/finance-skills`, `tellmefrankie/ai-investment-skills`)에 더해, 요청하신 **5대 오픈소스 스킬 생태계(`파이낸셜 서비스`, `바이브 트레이딩`, `트레이딩 스킬즈`, `K 스킬`, `어썸 파이낸스`)**의 핵심 모듈을 조사하여 우리 서버(국내 주식 전용)에 가장 실전 가치가 높은 **8개 코어 스킬 모듈**로 통합했습니다.

### 1.1 7대 오픈소스 저장소별 역할 및 채택 모듈

| 오픈소스 생태계 | GitHub 저장소 (라이선스) | 특징 및 강점 | 우리 서버(`ai_analyst/skills`)에 이식하는 핵심 모듈 |
| :--- | :--- | :--- | :--- |
| **1. 파이낸스 스킬즈** | [`himself65/finance-skills`](https://github.com/himself65/finance-skills) (MIT) | 마크 미너비니 SEPA, 기업 밸류에이션, 실적 리뷰, 유동성 정량 공식 | • **`sepa-strategy`** (Stage 1~4, 8대 추세 템플릿, VCP 돌파 품질)<br>• **`company-valuation` & `stock-liquidity`** (업종 상대 멀티플 & Amihud 유동성)<br>• **`earnings-recap`** (최근 4분기 실적 가속 & 이익의 질) |
| **2. AI 투자 스킬즈** | [`tellmefrankie/ai-investment-skills`](https://github.com/tellmefrankie/ai-investment-skills) (MIT Free Tier) | 시나리오 확률 가중 기대값(EV) 및 촉매 5단계 랭킹 | • **`ev-calculator`** (Bull/Base/Bear 3-시나리오 확률 가중 기대수익률 `Weighted EV %`)<br>• **`news-sentiment-engine`** (정책>수주/M&A>기술>업황>일반 5단계 촉매 랭킹) |
| **3. 파이낸셜 서비스**<br>*(Financial Services)* | `anthropics/financial-services` (Open) | 기관급 3대 재무제표 교차 검증 및 **투자 논리 추적(Thesis Tracker)** | • **`thesis-tracker & 3-statement-check`**: 손익계산서(영업이익) vs 현금흐름표/재무상태표(부채비율·유보율) 괴리 검증 및 **핵심 투자 가설 성립/훼손 조건(Kill Switch) 정의** |
| **4. 바이브 트레이딩**<br>*(Vibe-Trading)* | [`HKUDS/Vibe-Trading`](https://github.com/HKUDS/Vibe-Trading) (MIT, ⭐39k) | 퀀트 신호의 **과거 승률·손익비 백테스트 검증(Signal Replay)** 및 리스크 엑스레이 | • **`vibe-signal-backtest`**: 해당 종목의 과거 2년 일봉(`daily_prices`)에서 **동일한 기술적 셋업(예: 5·20 정배열 돌파, 20일선 지지 반등, 거래량 200% 돌파) 발생 시 5일/10일/20일 뒤 실제 승률(%)·평균 수익률·최대 낙폭(MDD)**을 파이썬으로 즉시 시뮬레이션 |
| **5. 트레이딩 스킬즈**<br>*(Claude Trading Skills)* | [`tradermonty/claude-trading-skills`](https://github.com/tradermonty/claude-trading-skills) (MIT, ⭐8.6k) | 시장 폭(Breadth)·노출도 코치(Exposure Coach)·포지션 사이저·매매 전 체크리스트 | • **`exposure-coach & position-sizer`**: 현재 KOSPI/KOSDAQ 시장 폭(`market_breadth`: 20일/50일선 위 종목 비율, 상승/하락 종목 수)을 계산해 **오늘 허용 가능한 종목당 리스크(0.5% ~ 2.0%)와 정확한 매수 주식 수·투입 금액** 산출 + 매매 전 7대 체크리스트 |
| **6. K 스킬**<br>*(K-Skill 한국 특화)* | [`NomaDamas/k-skill`](https://github.com/NomaDamas/k-skill) (MIT, ⭐8.5k) | **한국 주식 시장(KRX·DART·ECOS·국내 증권사 리포트) 100% 현지화** 분석 구조 | • **`k-dart & korean-company-analysis`**: 한국 DART 공시 특화 분석(CB/BW 전환사채 리픽싱·전환청구, 유상증자, 단일판매·공급계약 규모 대 매출 비중), 한국은행 ECOS 금리/환율 영향 및 **6섹션 한국형 기업 분석 프레임워크** |
| **7. 어썸 파이낸스**<br>*(Awesome Finance Skills)* | [`RKiding/Awesome-finance-skills`](https://github.com/RKiding/Awesome-finance-skills) (Apache-2.0, ⭐3.1k) | **인과관계 전달 사슬 시각화(`alphaear-logic-visualizer`)** 및 시그널 진화 추적(`signal-tracker`) | • **`logic-chain-visualizer & signal-tracker`**: 뉴스/거시 이벤트가 해당 종목의 매출과 주가로 이어지는 **인과 전달 사슬(`이벤트 → 산업/정책 변화 → 수급/실적 영향 → 주가 촉매`) 다이어그램 데이터** 생성 및 신호 상태(`강화 Strengthen / 약화 Weaken / 기각 Falsify`) 판정 |

---

## 2. 파이썬 정량 엔진(`quant_facts.py`) + Gemini 추론(`skill_runner.py`) 8대 모듈 상세

LLM이 숫자를 어림짐작(Hallucination)하지 못하도록, **파이썬 코드가 ClickHouse·PostgreSQL·OpenDART에서 아래 정량 지표를 먼저 오차 없이 계산**한 뒤 Gemini에 전달합니다.

### 모듈 1: [트레이딩 스킬즈 + 파이낸스 스킬즈] 시장 폭(Market Breadth) & SEPA 8조건 정량 판정
* **파이썬 정량 계산 (`compute_sepa_and_breadth`)**:
  1. **시장 레짐 & 노출도 코치 (`tradermonty/claude-trading-skills`의 `market-breadth-analyzer`)**:
     * 당일 해당 시장(KOSPI 또는 KOSDAQ) 전체 보통주 중 `close > ma20` 비율(%), `close > ma50` 비율(%), 52주 신고가 종목 수 vs 신저가 종목 수를 ClickHouse에서 집계.
     * 시장 레짐을 `BULL_EXPANDING`(종목당 리스크 1.5~2.0% 허용) / `CHOPPY_SELECTIVE`(0.5~1.0% 허용) / `BEAR_DEFENSIVE`(신규 진입 자제, 현금 비중 확대)로 자동 판정.
  2. **마크 미너비니 SEPA 8가지 추세 템플릿 (`himself65/finance-skills`의 `sepa-strategy`)**:
     * 최근 300봉 일봉으로 `MA50`, `MA150`, `MA200`, `1개월(20봉) 전 MA200`, `5개월(100봉) 전 MA200`, `52주 최고/최저가`, `RS 점수`를 계산하여 8개 항목 각각의 `pass: true/false`와 수치 산출.
  3. **정밀 포지션 사이저 (`tradermonty/claude-trading-skills`의 `position-sizer`)**:
     * 입력된 총 자본금(예: `10,000,000원`), 허용 리스크 `%`(예: `1.0% = 100,000원 최대 손실`), 권장 손절가(`stop_loss_price`)를 바탕으로 **`권장 매수 주식 수 = floor((자본금 × 리스크%) / (현재가 - 손절가))`** 및 실제 투입 금액·비중(%)을 원화 단위로 정확히 계산.

### 모듈 2: [바이브 트레이딩] 퀀트 셋업 과거 승률 백테스트 (`HKUDS/Vibe-Trading`)
* **파이썬 정량 계산 (`run_vibe_setup_backtest`)**:
  * 해당 종목의 최근 2년(약 500거래일) 일봉 데이터에서 **현재 종목이 놓인 기술적 셋업과 동일한 과거 시점(Signal Occurrences)**을 찾아 실제로 매수했을 때의 성적을 시뮬레이션합니다:
    * **셋업 A (`5·20일선 골든크로스/정배열 + 거래량 1.5배 돌파`)**
    * **셋업 B (`상승 추세 중 20일선 또는 볼린저 하단 눌림목 반등`)**
    * **셋업 C (`당일 +10% 이상 장대양봉 출현 직후 추격 vs 3일 눌림 후 진입`)**
  * 각 셋업에 대해 **과거 발생 횟수(`N회`), `D+3 / D+5 / D+10 / D+20`일 뒤 승률(`Win Rate %`), 평균 수익률(`Avg Return %`), 평균 최대익절(`MFE %`) vs 최대낙폭(`MAE %`)**을 테이블로 산출합니다. (감으로 매매하는 것이 아니라 *"이 종목은 과거 +10% 급등 날 추격 매수 시 5일 뒤 승률이 32%였으나, 20일선 눌림목에서는 승률이 71%였다"*는 객관적 백테스트 팩트를 제공!)

### 모듈 3: [K 스킬 + 파이낸셜 서비스] 한국형 DART 공시·3대 재무 교차검증 (`NomaDamas/k-skill` & `anthropics/financial-services`)
* **파이썬 + DART 연동 (`analyze_k_dart_and_financials`)**:
  * **`k-dart` 한국형 지뢰 & 촉매 스캐너**:
    * 최근 90일 OpenDART 공시 제목에서 한국 증시 특유의 핵심 이벤트를 자동 분류:
      * 🟢 **호재 공시**: `단일판매ㆍ공급계약체결`, `잠정실적(영업이익 호조)`, `자기주식취득결정 / 소각`, `무상증자`, `최대주주등소유주식변동(장내매수)`
      * 🔴 **악재/오버행 공시**: `유상증자결정(제3자배정 외 주주배정/일반공모)`, `전환사채권발행결정(CB)`, `전환청구권행사(물량 상장)`, `신주인수권부사채(BW)`, `감사보고서 제출 지연/한정`
  * **`financial-services` 3대 재무 건전성 & 이익 품질**:
    * 최근 4개 분기 및 3개년 `매출 증가율`, `영업이익 증가율`, `순이익 증가율`, `ROE`, `부채비율`, `유보율`을 대조하여 매출 성장과 영업이익 성장이 동반되는 진성 성장인지 검증.

### 모듈 4: [어썸 파이낸스] 인과 전달 사슬(`Logic Chain`) & 시그널 진화 추적 (`RKiding/Awesome-finance-skills`)
* **Gemini 구조화 추론 (`alphaear-logic-visualizer` & `alphaear-signal-tracker`)**:
  * **인과 전달 사슬 (`logic_chain`)**:
    * 해당 종목을 움직이는 핵심 재료를 4단계 노드(`① 거시/정책/산업 트리거` ➡️ `② 밸류체인/수요 변화` ➡️ `③ 동사 수주·판가(ASP)·점유율 영향` ➡️ `④ 실적 반영 시점 & 주가 모멘텀`)로 구조화하여 관리자 웹에서 시각적 플로우차트로 즉시 렌더링.
  * **투자 가설 & 시그널 트래커 (`thesis_and_signal`)**:
    * 현재 시그널 강도를 `STRENGTHEN (강화 🟢)` / `MAINTAIN (유지 🟡)` / `WEAKEN (약화 🟠)` / `FALSIFY (기각 🔴)`로 판정하고, **어떤 조건이 깨지면 즉시 손절/철수해야 하는지(`Falsification Trigger / Kill Switch`)**를 명시.

### 모듈 5: [AI 투자 스킬즈 + 파이낸스 스킬즈] 3-시나리오 기대값(EV) · 상대가치 밸류에이션 · 뉴스 촉매 5단계 랭킹
* **`ev-calculator`**: Bull / Base / Bear 3가지 시나리오별 목표가·확률(%)·확률 가중 기대수익률(`Weighted EV %`).
* **`company-valuation`**: 동일 업종(`sector_m`) 중앙값 PER·PBR·ROE 대비 상대가치 적정주가 밴드.
* **`news-sentiment-engine`**: 관련 뉴스/공시를 임팩트 5단계(`정책 > 수주/M&A > 신기술 > 업황 > 일반`)와 별점(`1~5점`), 감성 점수(`-1.0 ~ +1.0`)로 랭킹화하고 원문 링크 제공.

---

## 3. 관리자 전용 화면 UI / UX 설계 (`admin_web` > `/market/ai-lab`)

```text
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🧠 AI 종목 심층 분석 워크스테이션 (관리자 전용 · 7대 오픈소스 금융 스킬 + Gemini)          │
│ K-Skill(DART) · SEPA · Vibe-Trading(백테스트) · Trading-Skills(사이징) · Awesome-Finance(인과사슬) │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🔎 종목 선택: [ 053800 안랩 (KOSDAQ)     🔍 ]  💰 기준 자본금: [ 10,000,000 ]원  리스크: [ 1.0% ▼] │
│ ⚡ 빠른 일괄 분석: [🔥 오늘의 급등·거래대금 대장주 Top 5 분석]  [🏆 오늘의 주도주 Top 5 분석] │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ 📌 [종합 판정 & 포지션 사이저 (Trading-Skills Exposure Coach)]                             │
│ • 시장 폭(KOSDAQ): 🟢 상승장 (20일선 상회 61%) → 권장 리스크 1.0% (최대 허용 손실 100,000원)│
│ • 종합 판정: 🟢 STRONG_SETUP (SEPA Stage 2 · 8/8 통과) | 시그널 상태: 🟢 STRENGTHEN (강화) │
│ • 정밀 매수 계산: 현재가 71,500원 / 손절가 66,500원(-7.0%) → 권장 매수: 20주 (1,430,000원, 비중 14.3%)│
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🔗 [Awesome-Finance 인과 전달 사슬 (Logic Chain Visualizer)]                               │
│  [① 정부 국가망 클라우드 보안 예산 2배 확대] ──▶ [② 공공·금융 제로트러스트 보안 발주 급증] │
│       ──▶ [③ 국내 공공 보안 MS 1위 안랩 수주 직결] ──▶ [④ 4Q~내년 1Q 영업이익 레버리지 폭발]│
│  ⚠️ 가설 기각 조건(Kill Switch): 66,500원(피벗 하단) 종가 이탈 또는 외국인 3일 연속 대량 순매도 시 철수│
├──────────────────────────────────────────┬─────────────────────────────────────────────────┤
│ 🎯 [Skill 1] SEPA 8조건 & VCP 돌파 품질  │ 🧪 [Skill 2] Vibe-Trading 과거 셋업 백테스트    │
│ ──────────────────────────────────────── │ ─────────────────────────────────────────────── │
│ ✅ 1~5. 주가(71,500) > 50 > 150 > 200일선│ 최근 2년(500봉) 내 동일 셋업 발생 시 실제 성적: │
│ ✅ 3. 200일선 기울기: 1개월 +4.2% 상승중 │ • [현재 셋업: 5·20 정배열 + 거래량 200%↑ 돌파]  │
│ ✅ 6~7. 52주 저점 +62.5% / 고점 -3.4%    │   - 발생 횟수: 11회                             │
│ ✅ 8. 상대강도(RS): 92점 (상위 8%)       │   - D+5일 승률 : 72.7% (평균 +6.8%)             │
│ • 유동성 등급: VERY_HIGH (일평균 480억)  │   - D+10일 승률: 81.8% (평균 +11.4%, MDD -4.1%) │
│ • 돌파 판정: 피벗 67,000원 거래량 640%   │ • [주의: 당일 +15% 이상 급등 종가 추격 매수 시] │
│   동반 진성 돌파 (True Breakout)         │   - D+3일 단기 승률: 40.0% (눌림목 분할 권장!)  │
├──────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 💰 [Skill 3] 3-시나리오 기대값 (EV) & 가치│ 🇰🇷 [Skill 4] K-Skill DART 공시 & 3대 재무 검증 │
│ ──────────────────────────────────────── │ ─────────────────────────────────────────────── │
│ • 🐂 Bull (35%): 86,000원 (+20.3%)       │ • DART 오버행/지뢰 점검: 🟢 CLEAN (CB/BW 없음)  │
│ • ⚖️ Base (45%): 75,000원 (+4.9%)        │ • 최근 주요 공시: 공공 클라우드 보안 공급계약 ↗ │
│ • 🐻 Bear (20%): 66,500원 (-7.0% 손절)   │ • 3대 재무 & 실적 가속 (최근 4분기):            │
│ 👉 확률 가중 기대값(EV): +7.9% (신뢰 HIGH)│   - 영업이익 YoY: +18% → +26% → +34% (3연속 가속)│
│ • 업종(SW) 중앙 PER 24.5x vs 당사 19.8x  │   - 부채비율 28.4% (우량) / ROE 15.4%           │
├──────────────────────────────────────────┴─────────────────────────────────────────────────┤
│ 📰 [Skill 5] 뉴스 & 공시 촉매 임팩트 랭킹 (Top 5 · 감성 점수 -1.0 ~ +1.0 & 원문 링크)      │
│ 1. [⭐⭐⭐⭐⭐ 5/5 · 정책/규제] 감성 +0.88 | "[단독] 국가망 클라우드 보안 예산 2배 확대" [원문↗]│
│ 2. [⭐⭐⭐⭐ 4/5 · 수주/공시]   감성 +0.82 | "안랩, 공공 클라우드 보안 공급계약 체결"    [공시↗]│
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 데이터베이스 및 백엔드 API 설계

### 4.1 PostgreSQL 테이블 (`admin_ai_skill_reports`)
```sql
CREATE TABLE admin_ai_skill_reports (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL,
    stock_name VARCHAR(100) NOT NULL,
    as_of_date DATE NOT NULL,                      -- 분석 기준 거래일
    quant_facts JSONB NOT NULL,                    -- 파이썬 계산 정량 팩트 (SEPA 8조건, 시장 폭, Vibe 백테스트 승률, 업종 멀티플, 포지션 사이징)
    sepa_analysis JSONB NOT NULL,                  -- [Finance-Skills] Stage(1~4), 베이스 단계, 돌파 품질, 피벗/손절가
    vibe_backtest JSONB NOT NULL,                  -- [Vibe-Trading] 최근 2년 동일 기술적 셋업 발생 횟수, D+5/10/20 승률·평균수익률·MDD
    exposure_and_sizing JSONB NOT NULL,            -- [Trading-Skills] 시장 폭 레짐, 권장 리스크 %, 매수 가능 주식 수·투입 금액, 7대 체크리스트
    logic_chain_and_thesis JSONB NOT NULL,         -- [Awesome-Finance & Financial-Services] 4단계 인과 전달 사슬 노드, 시그널 상태(강화/약화/기각), 가설 기각 조건(Kill Switch)
    ev_scenarios JSONB NOT NULL,                   -- [AI-Investment-Skills] Bull/Base/Bear 목표가·확률·근거, Weighted EV %, 신뢰도
    k_dart_and_valuation JSONB NOT NULL,           -- [K-Skill & Finance-Skills] DART 오버행(CB/BW/유증) 점검, 3대 재무 건전성, 업종 상대가치 적정주가 밴드
    news_catalysts JSONB NOT NULL,                 -- [AI-Investment-Skills & Awesome-Finance] 5단계 임팩트 Top 5 뉴스/공시, 감성 점수(-1.0~+1.0), 원문 링크
    overall_verdict VARCHAR(50) NOT NULL,          -- 'STRONG_SETUP' | 'WATCH_PULLBACK' | 'HOLD_WAIT' | 'AVOID_RISK'
    executive_summary TEXT NOT NULL,               -- 3줄 핵심 투자 메모
    model_name VARCHAR(50) NOT NULL,               -- 사용한 Gemini 모델명
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_admin_skill_report_ticker_date UNIQUE (ticker, as_of_date)
);
CREATE INDEX idx_admin_skill_reports_date ON admin_ai_skill_reports (as_of_date DESC);
```

### 4.2 관리자 전용 REST API 엔드포인트 (`backend/apps/ai_analyst/skills/router.py`)
> ⚠️ 모든 엔드포인트는 `Depends(require_admin)`으로 보호되어 관리자 본인만 호출할 수 있습니다.

| 메서드 & 경로 | 설명 |
| :--- | :--- |
| `GET /api/v1/admin/ai-skills/quant-preview/{ticker}` | **(Gemini 토큰 소모 0원!)** 파이썬이 계산한 **정량 팩트(SEPA 8조건, Vibe-Trading 2년 셋업 백테스트 승률, 시장 폭 기반 포지션 사이징, 업종 상대 PER/PBR, DART 최근 공시 목록)**를 0.1초 만에 즉시 반환 |
| `POST /api/v1/admin/ai-skills/analyze/{ticker}` | 정량 팩트 위에 Gemini API를 호출하여 **인과 전달 사슬(Logic Chain), EV 3-시나리오, 투자 가설 Kill Switch, 뉴스 촉매 감성 점수**까지 포함한 전체 7대 스킬 통합 리포트 생성 및 DB 저장 (`?force_refresh=true&capital=10000000&risk_pct=1.0`) |
| `GET /api/v1/admin/ai-skills/reports` | 최근 분석한 종목 리포트 히스토리 목록 조회 (`?limit=30`) |
| `GET /api/v1/admin/ai-skills/reports/{ticker}` | 특정 종목의 저장된 분석 리포트 조회 |
| `POST /api/v1/admin/ai-skills/batch-top` | **일괄 분석 버튼**: 당일 `급등·거래대금 대장주 Top 5` 또는 `주도주 Top 5` 종목을 한 번에 분석 |

---

## 5. 클로드코드(Claude Code) 단계별 구현 계획

프론트엔드 UI 개편 전에 클로드 코드로 아래 5단계를 순서대로 구현합니다.

### Step 1: DB 모델(`AdminAiSkillReport`) 및 마이그레이션 추가
* `backend/shared/ai_models.py`에 `AdminAiSkillReport` 모델 추가.
* Alembic 마이그레이션 생성 (`admin_ai_skill_reports` 테이블).

### Step 2: 7대 오픈소스 스킬 파이썬 정량 엔진 구현 (`backend/apps/ai_analyst/skills/quant_facts.py`)
1. **`compute_sepa_template(candles_300d, rs_score)`** (`himself65/finance-skills`):
   * 50/150/200일선, 200일선 20일·100일 기울기, 52주 고저 대비 위치, RS ≥ 70 등 8대 조건 정밀 판정.
2. **`run_vibe_setup_backtest(candles_500d)`** (`HKUDS/Vibe-Trading`):
   * 최근 2년 일봉에서 ① `5·20일선 정배열 돌파(거래량 1.5x↑)`, ② `상승 추세 중 20일선 눌림목 지지`, ③ `당일 +10% 이상 급등 봉 종가 진입` 3가지 시그널의 과거 발생 횟수와 `D+3 / D+5 / D+10 / D+20` 승률(%), 평균 수익률(%), 최대 낙폭(MAE %)을 넘파이/파이썬 루프로 즉시 시뮬레이션.
3. **`compute_exposure_and_sizing(market_breadth, close_price, stop_loss_price, capital, risk_pct)`** (`tradermonty/claude-trading-skills`):
   * KOSPI/KOSDAQ 시장 폭(20일/50일선 상회 종목 비율) 기반 시장 레짐 판정 + 리스크 금액 기준 권장 매수 주식 수 및 비중(%) 산출.
4. **`scan_k_dart_and_peer_valuation(ticker, sector_m)`** (`NomaDamas/k-skill` & `anthropics/financial-services`):
   * OpenDART 최근 공시에서 호재(수주/자사주/실적) vs 악재·오버행(CB/BW/유상증자/전환청구) 자동 태깅 + 동일 업종(`sector_m`) 중앙값 PER·PBR·ROE 대비 상대 밸류에이션 격차 및 최근 4분기 영업이익/EPS 가속 여부 계산.

### Step 3: 7대 스킬 통합 Gemini 프롬프트 & 추론 서비스 구현 (`backend/apps/ai_analyst/skills/`)
* `backend/apps/ai_analyst/skills/schemas.py`:
  * `SepaSkillOutput`, `VibeBacktestOutput`, `ExposureSizingOutput`, `LogicChainAndThesisOutput`(`Awesome-Finance` 4단계 인과 노드 + `Financial-Services` 가설 기각 Kill Switch), `EvCalculatorOutput`, `KDartValuationOutput`, `NewsCatalystItem`, `AdminSkillReportResponse` 정의.
* `backend/apps/ai_analyst/skills/prompts.py` & `skill_runner.py`:
  * Step 2의 정량 팩트 JSON과 뉴스/공시 제목을 입력받아 Gemini 1회 구조화 호출로 전체 리포트를 생성하고 `admin_ai_skill_reports`에 Upsert.
* `backend/apps/ai_analyst/skills/router.py`:
  * `require_admin` 가드가 적용된 5개 엔드포인트 구현 및 `backend/apps/stock_api/main.py`에 라우터 등록.

### Step 4: 관리자 웹(`admin_web`) `/market/ai-lab` 화면 및 기존 스크리너 연동
* **신규 파일**:
  * `admin_web/src/api/aiSkills.ts`, `admin_web/src/types/aiSkills.ts`
  * `admin_web/src/pages/MarketAiLab.tsx`
* **수정 파일**:
  * `admin_web/src/components/Sidebar.tsx`, `admin_web/src/lib/navPermissions.ts`, `admin_web/src/App.tsx`:
    * `시장 데이터` 사이드바에 `{ to: '/market/ai-lab', label: 'AI 종목 심층 분석', icon: '🧠' }` 추가.
  * 기존 관리자 화면(`MarketDailySurge.tsx`, `MarketMaScreener.tsx`, `LeadersPage`)의 종목 상세 영역에 **`[🧠 AI 심층 분석 열기]`** 버튼(`/market/ai-lab?ticker=${ticker}`) 추가.
* **핵심 UX**:
  * 종목을 고르는 즉시 **`quant-preview` API(0원, 0.1초)**가 먼저 호출되어 **SEPA 8조건 표, Vibe-Trading 2년 백테스트 승률 표, 포지션 사이징(권장 매수 주식 수), 업종 상대 PER, DART 공시 체크**가 화면에 즉시 뜹니다!
  * 이어서 저장된 Gemini 리포트가 있으면 바로 보여주고, 없거나 **`[⚡ Gemini 7대 스킬 심층 추론 실행]`** 버튼을 누르면 **인과 전달 사슬(Logic Chain 플로우), Bull/Base/Bear EV 시나리오, 투자 가설 Kill Switch, 뉴스 감성 랭킹**이 완성됩니다. (토큰 비용을 아끼면서도 모든 종목의 정량 백테스트·SEPA·사이징은 무제한 0원으로 즉시 확인 가능!)

### Step 5: 테스트 및 검증
* `backend/tests/test_admin_ai_skills.py`:
  * SEPA 8조건 판정, Vibe-Trading 과거 셋업 백테스트(`D+5`, `D+10` 승률 계산), Trading-Skills 포지션 사이저(자본금·리스크%·손절폭 기반 매수 주식 수), K-Skill DART 오버행 키워드 탐지 단위 테스트.
  * `quant-preview` 무과금 즉시 응답 및 Fake Gemini 기반 `analyze` E2E 테스트, 비관리자 401/403 차단 테스트.
* `admin_web`: `tsc --noEmit` 및 `vitest` 통과 확인.
