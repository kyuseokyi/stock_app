# 관리자 AI 종목 심층 분석(AI Lab) 설계 — A·B·C 단계

> 작성 2026-11-27 · 원 기획: [`docs/admin_gemini_finance_skills_spec_and_plan.md`](../../admin_gemini_finance_skills_spec_and_plan.md)
> 이 문서가 원 기획과 다르면 **이 문서가 우선**(0절).

## 0. 원 기획에서 바꾼 것 (사용자 결정 2026-11-27)

| 원 기획 | 이 설계 | 이유 |
|---|---|---|
| "관리자 전용이라 네이버 뉴스 AI 입력 규제에서 자유" — 뉴스 촉매 랭킹·감성 점수·인과 사슬에 네이버 뉴스 | **Gemini 입력 = 우리 정량 데이터 + DART 공시만.** 촉매 랭킹·감성은 **DART 공시 제목** 기준. 네이버 뉴스는 AI 와 분리된 칸에 받은 그대로 원문 링크만(급등락 화면과 같은 규칙, 저장 안 함) | 네이버 검색 API 약관은 열람자와 무관하게 LLM 입력·요약·저장 금지([`naver-search-api-terms-issue.md`](../../naver-search-api-terms-issue.md)) |
| 유보율 | **제외** | 수집하지 않는 값 |
| PER·PBR·ROE 업종 비교 | PER = 종가 ÷ 연간 EPS, PBR = 종가 ÷ BPS(CH `fundamentals_periodic`, 연간 `Y` 최신), ROE·성장률·부채비율은 수집값 그대로. 업종 = `canslim_daily.sector_m` | 실제 수집 컬럼만 |
| Step 1 에 리포트 DB 모델 | **B단계**로 이동 | A단계는 저장 없이 계산만(비용 0원) |
| 한 번에 Step 1~5 | **A(정량 엔진·카탈로그) → B(Gemini 추론·저장) → C(관리자 화면)** 단계별 | 범위가 커서 단계마다 배포·확인 |

## 1. 공통 원칙
- 관리자 전용(권한 `SCREENER_VIEW`, 일괄 분석은 `DATA_PIPELINE`). 사용자 앱·웹 노출 없음.
- **숫자는 파이썬이 계산**하고 Gemini 는 해석만(환각 방지). Gemini 응답에 나온 숫자는 정량 팩트와 다르면 버린다(B단계 검증).
- 스킬 카탈로그 `SKILL.md` 는 7개 오픈소스(모두 MIT 또는 Apache-2.0, 2026-11-27 GitHub 확인)를 **참고해 국내 주식용으로 다시 쓴 우리 루브릭**. 원문 복사 아님, 각 파일에 출처 저장소·라이선스 표기.

| 카탈로그 id | 참고 저장소 | 라이선스 |
|---|---|---|
| `sepa_strategy` | himself65/finance-skills | MIT |
| `ev_and_catalysts` | tellmefrankie/ai-investment-skills | MIT |
| `financial_checks` | anthropics/financial-services | Apache-2.0 |
| `setup_backtest` | HKUDS/Vibe-Trading | MIT |
| `exposure_sizing` | tradermonty/claude-trading-skills | MIT |
| `k_dart` | NomaDamas/k-skill | MIT |
| `logic_chain` | RKiding/Awesome-finance-skills | Apache-2.0 |

## 2. A단계 — 정량 엔진·카탈로그·미리 보기 API (Gemini 호출 없음)

`backend/apps/ai_analyst/skills/`
- `catalog/<id>/SKILL.md` 7개 — frontmatter(`id`, `name`, `description`, `source_repo`, `license`, `uses_facts`) + 한국어 루브릭 본문.
- `skill_loader.py` — `list_installed_skills()`(메타 목록, 파일 수정 시각 기준 캐시), `get_skill(id)`, `build_combined_skill_prompt(ids | None)`. frontmatter 누락·중복 id 는 건너뛰고 경고.
- `quant_facts.py` (순수 함수, DB 없음)
  - `compute_sepa_template(bars, rs)` — 8조건(① 종가 > 150·200일선 ② 150 > 200일선 ③ 200일선 20봉 전보다 상승 ④ 50일선 > 150·200일선 ⑤ 종가 > 50일선 ⑥ 종가 ≥ 52주 최저 × 1.30 ⑦ 종가 ≥ 52주 최고 × 0.75 ⑧ RS ≥ 70), 조건별 `pass`·값, 통과 수, 단계(Stage 1~4 단순 판정). 200봉 미만이면 판정 불가 표시.
  - `run_setup_backtest(bars)` — 셋업 A(5일선이 20일선 상향 돌파 + 거래량 ≥ 20일 평균 1.5배), B(종가 > 50일선·20일선 5봉 상승 중 저가가 20일선 1% 이내 닿고 종가 ≥ 20일선), C(당일 +10% 이상). 신호일 종가 진입, D+3·5·10·20 종가 수익률의 발생 수·승률·평균, D+20 까지 MFE·MAE 평균. 미래 봉 부족한 신호는 제외. 오늘 해당 셋업 표시.
  - `compute_market_breadth(rows)` — 같은 시장 보통주의 종가 > 20·50일선 비율 → 레짐 `BULL`(20일선 ≥ 60% 그리고 50일선 ≥ 55%) / `BEAR`(둘 다 < 40%) / `CHOPPY`, 권장 리스크 범위(BULL 1.5~2.0% / CHOPPY 0.5~1.0% / BEAR 0~0.5%).
  - `suggest_stop(bars)` — max(종가 × 0.92, 최근 10봉 최저가) (종가보다 낮을 때), 근거 문자열.
  - `position_size(capital, risk_pct, entry, stop)` — 주식 수 = floor(자본 × 리스크% ÷ (진입 − 손절)), 투입 금액·비중·최대 손실. 손절 ≥ 진입이면 오류.
  - `classify_dart(disclosures)` — 호재(공급계약·자사주 취득/소각·무상증자·잠정실적) / 악재·오버행(유상증자·CB·BW·EB·전환청구·감사의견·관리종목) 태그, 오버행 여부.
  - `peer_valuation(target, peers)` — 업종 중앙값 PER·PBR·ROE(EPS·BPS 양수만) 대비 괴리율, 표본 수.
  - `earnings_trend(quarters)` — 최근 4분기 영업이익 성장률 나열·가속 여부.
- `quant_repository.py` — CH 일봉 520봉(FINAL), `canslim_daily` 최신(RS·업종·20일 평균 거래대금), `fundamentals_periodic`(연간 최신·분기 4개), 같은 업종 종목의 최신 연간 재무와 종가, 시장 폭용 그날 일봉 × 프로필(PG), DART 최근 90일(`OpenDartClient`, 키 없으면 생략).
  - **과거 기준일(as_of) 미래 자료 차단(보수적 규칙)**: 재무는 결산월 말일이 as_of 보다 연간(Y) 90일·분기(Q) 45일 이상 이전인 것만, DART 는 as_of 전날까지. as_of 가 없으면(오늘 기준) 최신 재무·오늘까지 공시. 업종 비교 종가는 대상 종목 일봉 날짜의 `daily_prices FINAL` 종가.
- 계산 보완(검토 반영): 하루 종가 변동 ±50% 초과 봉이 있으면 가장 최근 점프 이후 봉만 사용(`split_cut` 표시, 수정주가 미반영 방어), 백테스트 같은 셋업 쿨다운 5봉, 셋업 A 거래량 평균은 거래량 0 봉 제외·유효 15봉 이상, 분기 가속은 최근 3개 분기에 값 없는 분기가 끼면 판정 안 함, 해지·해제·철회·취소 공시는 호재 아님.
- `service.py` — `quant_preview(ticker, capital, risk_pct, as_of=None)` 가 위를 묶어 JSON.
- `router.py` — `/api/v1/admin/ai-skills`: `GET /catalog`, `GET /catalog/{id}`, `GET /quant-preview/{ticker}?capital&risk_pct`. stock_api 에 등록.

## 3. B단계 — Gemini 추론·저장 (다음)
- 모델 `AdminAiSkillReport`(원 기획 4.1, `news_catalysts` → `dart_catalysts`), 마이그레이션.
- `schemas.py`(구조화 출력), `skill_runner.py`: 선택 스킬 프롬프트 + 정량 팩트 + DART 제목 → `generate_json` 1회. 응답의 숫자(목표가·확률 합 100%)는 검증 후 저장.
- `POST /analyze/{ticker}`, `GET /reports`(페이징), `GET /reports/{ticker}`, `POST /batch-top`(급등락 대장주·주도주 Top 5, `DATA_PIPELINE`).

## 4. C단계 — 관리자 화면 `/market/ai-lab` (다음)
- 원 기획 3절 화면 구성. 네이버 뉴스는 별도 칸(`NaverNewsList` 재사용). 목록은 페이징, 모바일 상세는 전체 화면(사용자 규칙).
- 급등락·스크리너 상세에 "AI 심층 분석 열기" 버튼.

## 5. 테스트 (A단계)
- 로더: 7개 읽기, frontmatter 누락 파일 건너뜀, 조합 프롬프트에 선택 스킬만.
- SEPA 8조건 경계·200봉 미만, 백테스트 승률·평균(손으로 만든 봉), 미래 부족 신호 제외, 시장 폭 레짐 경계, 포지션 사이저(주식 수 내림·손절 ≥ 진입 오류), DART 태그, 업종 중앙값(음수 EPS 제외).
- API: 권한(EDITOR 403, ANALYST 200), quant-preview 가 Gemini 를 부르지 않음, 없는 종목 404.
