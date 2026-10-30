# AI 주식 분석 & 글로벌/국내 시황 서비스 기획 및 구현 로드맵

> **작성일**: 2026-10-30  
> **상태**: Draft / Ready for Implementation  
> **목표**: Google Gemini API와 국내외 금융 데이터를 결합하여 **비용 효율적(무료~극저비용)**이면서 실전 투자에 유용한 **AI 분석 에이전트 서비스** 구축

---

## 1. 개요 및 기획 배경

현재 시스템은 KIS(한국투자증권) API 기반의 시세 수집기, 윌리엄 오닐의 CANSLIM 7항목 정량 스크리너, 차트 패턴(VCP 등) 감지기, FRED(연준) 거시지표 수집기를 보유하고 있습니다.

본 기획은 기존 **정량적 필터(숫자/지표)** 위에 **Gemini 2.0/1.5 Flash**를 결합하여 다음 4가지 핵심 가치를 제공합니다:
1. **스크리너 통과 종목 정성 분석**: "숫자는 좋은데 왜 올랐는가? DART 실적의 질과 숨은 리스크(CB/오버행)는 없는가?"
2. **실시간 급등락 AI 원인 브리핑**: "지금 상한가/급락한 종목의 진짜 이유 1줄 요약"
3. **실시간 뉴스 & 핫 키워드 분석**: "뉴스 속보 → 수혜주 매핑 및 오늘의 증시 키워드 Top 10"
4. **글로벌/미국 시황 모닝 브리핑**: "어젯밤 뉴욕증시/빅테크/유가/금리가 오늘 한국 증시에 미치는 영향"

---

## 2. 핵심 기능 명세

### Feature 1. 스크리너 연계 AI 정성 평가 (CANSLIM + AI)
* **대상**: 기존 정량 스크리너(CANSLIM, VCP 등)를 통과한 종목 (일 10~30개)
* **제공 정보**:
  * **포착 사유 1줄 요약**: 상승 드라이버 및 모멘텀 요약
  * **DART 실적 품질 검증**: 본업(영업이익) 중심의 성장인지, 일회성 자산매각에 의한 착시인지 판별
  * **지뢰 감지기 (Red Flag)**: 전환사채(CB), 신주인수권부사채(BW), 대주주 지분 매각 등 오버행 리스크 경고
* **실행 주기**: 매일 장 마감 후(16:00) Celery 태스크 1회 실행 후 DB 캐싱

### Feature 2. 실시간 급등락 & 원인 분석기 (Market Movers)
* **대상**: 당일 등락률 상위 10개, 하위 10개 종목 (KIS API 등락률 순위)
* **제공 정보**:
  * 급등/급락 핵심 이유 1줄 브리핑 (30자 내외)
  * 재료 성격 태그: `[호재/수주]` `[실적서프라이즈]` `[테마/수급]` `[경영권]` `[악재/유상증자]`
  * 신뢰도/지속성 점수: 상 / 중 / 하
* **실행 주기**: 장중(09:00 ~ 15:30) 10분 주기 Celery 태스크 실행 (Redis 10분 TTL)

### Feature 3. 뉴스 & 테마 키워드 분석 (News-to-Stock & Buzz Words)
* **제공 정보**:
  * **속보 뉴스-관련주 매핑**: 주요 경제 기사 헤드라인 요약 + 직접 수혜 대장주/테마주 매핑
  * **오늘의 시장 핫 키워드 Top 10**: 포털/뉴스 빈도 기반 키워드(예: `#HBM`, `#방산수출`) 및 관련주 평균 등락률
* **실행 주기**: 10~20분 주기 배치

### Feature 4. 장전 모닝 글로벌 브리핑 (Morning US-to-KR Brief)
* **대상**: 미국 3대 지수 + 필라델피아 반도체 지수 + 빅테크 + 환율/유가 + FRED 매크로
* **제공 정보**:
  * 뉴욕증시 마감 3줄 요약
  * 오늘 한국 증시 예상 영향: **오늘의 강세 예상 섹터** vs **주의 섹터**
  * 주요 일정/매크로 체크포인트 (CPI, FOMC, 고용지표 등)
* **실행 주기**: 매 영업일 아침 08:30 자동 발행 (웹/앱 메인 노출 + 푸시 알림)

---

## 3. 시스템 아키텍처 및 데이터 흐름

```
[외부 데이터 소스]
  ├─ KIS API (기존)         : 당일 시세, 등락률 순위, 거래대금, 해외 지수
  ├─ FRED API (기존)        : 미 국채금리, CPI, 환율 등 거시지표
  ├─ Naver Search API (신규): 종목별 실시간 뉴스 검색 (무료 25,000건/일)
  └─ OpenDART API (신규)    : 공시, 분기보고서, 재무제표 (무료 10,000건/일)
             │
             ▼
[백엔드 수집 및 AI 파이프라인 (FastAPI + Celery)]
  ├─ backend/apps/ai_analyst/
  │    ├─ clients/
  │    │    ├─ gemini_client.py   (Gemini 2.0/1.5 Flash SDK 연동)
  │    │    ├─ naver_news.py      (네이버 검색 뉴스 API 클라이언트)
  │    │    └─ opendart.py        (DART 전자공시 클라이언트)
  │    ├─ prompts/                (구조화된 JSON 응답 유도 프롬프트)
  │    ├─ services/
  │    │    ├─ screener_ai.py     (스크리너 통과 종목 정성 분석)
  │    │    ├─ market_movers_ai.py(급등락 원인 추출)
  │    │    └─ morning_brief_ai.py(글로벌 시황 분석)
  │    └─ tasks.py                (Celery 주기적 스케줄링)
             │
             ▼
[저장 및 서빙]
  ├─ Redis           : 실시간 급등락 원인 및 뉴스 매핑 캐시 (TTL 5~15분)
  ├─ PostgreSQL      : 일별 모닝 브리핑, 스크리너 AI 평가 결과 영구 보관
  └─ FastAPI Routers : /api/v1/ai/... (REST 엔드포인트)
```

---

## 4. 단계별 구현 로드맵 (Roadmap)

### Phase 1: 기반 연동 및 외부 API 클라이언트 구축
- [ ] Google GenAI SDK (`google-genai` 또는 `google-generativeai`) 설치 및 클라이언트 작성
- [ ] 네이버 검색 API(뉴스) 클라이언트 작성 (`apps/ai_analyst/clients/naver_news.py`)
- [ ] OpenDART API 클라이언트 작성 (`apps/ai_analyst/clients/opendart.py`)
- [ ] `.env` 환경변수 키 주입 및 연결 테스트 유닛테스트 작성

### Phase 2: AI 분석 코어 서비스 구현 (프롬프트 & JSON 파싱)
- [ ] Gemini 구조화 출력(`response_mime_type="application/json"`) 기반 Pydantic 스키마 정의
- [ ] 급등락 원인 추출 서비스 (`analyze_market_mover_reasons`)
- [ ] 스크리너 종목 심층 분석 서비스 (`analyze_screener_stock_quality`)
- [ ] 글로벌 시황 브리핑 생성 서비스 (`generate_morning_briefing`)

### Phase 3: Celery 스케줄러 등록 및 DB/캐시 연동
- [ ] DB 테이블 마이그레이션 (Alembic): `ai_daily_briefings`, `ai_stock_evaluations`
- [ ] Celery Beat 스케줄 등록:
  - 평일 08:30: 모닝 글로벌 브리핑
  - 평일 09:10~15:30 (10분 주기): 급등락 원인 분석
  - 평일 16:00: 스크리너 AI 정성 분석
- [ ] Redis 캐싱 레이어 적용

### Phase 4: FastAPI REST API 엔드포인트 개설
- [ ] `GET /api/v1/ai/morning-brief` (오늘의 글로벌 시황)
- [ ] `GET /api/v1/ai/market-movers` (실시간 급등락 및 AI 사유)
- [ ] `GET /api/v1/ai/screener/{ticker}` (종목별 AI 정성 분석 카드)
- [ ] `GET /api/v1/ai/hot-keywords` (오늘의 핫 키워드 및 관련주)

### Phase 5: 프론트엔드 연동 (web_client & mobile)
- [ ] 스크리너 화면: 종목 카드에 'AI 1줄 포착 사유' 및 '지뢰 감지 뱃지' 표시
- [ ] 종목 상세 화면: 'AI 심층 진단' 탭/카드 추가 (실적 품질, 리스크, 모멘텀)
- [ ] 홈/시황 탭: 상단에 '오늘 아침 글로벌 브리핑' 및 '실시간 급등락 원인 피드' 카드 노출

---

## 5. 클로드코드(Claude Code) 구현 시 주의사항 및 컨벤션

1. **기존 코드베이스 무결성(Regression 방지)**:
   - 기존 `apps/collector/canslim`, `patterns`, `kis` 코드를 직접 수정하지 않고, 그 결과를 입력으로 소비하는 독립 패키지(`apps/ai_analyst`)로 분리합니다.
2. **비용 및 레이트 리미트 보호**:
   - Gemini API 호출 전 반드시 Redis 캐시를 조회하여 중복 호출을 차단합니다.
   - 네이버 뉴스 검색 시 `display=5` 정도로 요약된 데이터만 LLM에 전달하여 토큰 소모를 최소화합니다.
3. **타입 안전성 및 예외 처리**:
   - 외부 API(네이버, DART, Gemini) 실패 시 전체 파이프라인이 중단되지 않도록 Graceful Fallback 처리합니다.
