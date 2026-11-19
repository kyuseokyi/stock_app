# 네이버 검색 API 약관 개정(2026-09-07 시행)과 우리 서비스 영향 (2026-11-19)

> 법률 판단이 아니다. 개정 정리 글과 공지를 바탕으로 한 조사 결과이며, 공식 약관 원문으로 다시 확인한다.
> 관련: 시세 재배포 계약 [`deploy/market-data-licensing.md`](deploy/market-data-licensing.md), 테마 뉴스 레이더 [`theme_news_radar_plan.md`](theme_news_radar_plan.md)

## 1. 개정 내용 요약
네이버 개발자센터가 2026-08-07 검색 API 특약 개정을 공지했고 **2026-09-07 부터 시행** 중이다.

| 행위 | 개정 후 |
|---|---|
| 검색 결과를 **LLM·생성형 AI 에 입력**(요약·분석, 프롬프트·RAG 문맥 포함 — 학습이 아니어도 해당) | ❌ 금지 |
| 결과를 **요약·재정렬·수정·자체 결과와 혼합** | ❌ 금지 — 결과는 **가공 없이 독립적으로** 노출 |
| 결과를 **복사·저장·캐싱, 자체 DB 구축·장기 축적** | ❌ 금지 — 예외: 서비스 연속성용 이력 조회 21일, 개인화 캐시 24시간(또는 새 질의 시점 중 짧은 쪽), 기간 지나면 즉시 삭제 |
| 검색 결과 화면의 **광고**, 제휴 링크·유료 검색 등 수익화 | ❌ 금지 |
| 제3자 판매·재제공, API 대가 수취 | ❌ 제한 |
| 차단 후 크롤링·IP 교체 우회 | ❌ 고위험 |
| **허용**: 네이버 검색 결과임을 BI 가이드대로 표시 + **원출처·원문 링크** + 가공 없이 독립 노출 | ✅ |

## 2. 우리 코드에서 걸리는 곳 (즉시 조치 대상)
`backend/apps/ai_analyst/clients/naver_news.py`(뉴스 검색)의 결과를 **Gemini 프롬프트에 넣는** 기능 세 곳 — 개발·상용 서버 모두에서 지금 동작 중.

| 파일 | 기능 | 걸리는 조항 |
|---|---|---|
| `backend/apps/ai_analyst/services/market_movers.py` | 급등락 종목·테마 **원인 분석**(`"{종목} 특징주"`, `"{테마} 관련주"`) | AI 입력, 요약, 캐시 보관 |
| `backend/apps/ai_analyst/services/morning_brief.py` | **모닝 브리핑**(시황 요약) | AI 입력, 요약 |
| `backend/apps/ai_analyst/services/stock_qualitative.py` | 종목 **정성 분석** | AI 입력, 요약 |

함께 볼 것: AI 결과 캐시(`backend/apps/ai_analyst/cache.py`)에 뉴스 원문 필드가 함께 저장되는지, 참고 기사 목록(R3 — 제목·출처·링크)이 AI 요약과 **한 칸에 섞여** 보이는지.

## 3. 테마 뉴스 레이더(검토 단계) 영향
[`theme_news_radar_plan.md`](theme_news_radar_plan.md) 는 네이버 검색을 **주력 출처**로 두고 ① 기사·사건 저장 테이블 ② 중복 제거·사건 묶기·점수 재정렬 ③ 사건마다 Gemini 호출을 설계했다 → **세 가지 모두 개정 약관과 충돌**한다. 문서 6절 1단계 "네이버 API 실측"은 진행하지 않는다. 출처를 바꾼 뒤 다시 설계한다.

## 4. 대응 방향
| # | 방법 | 내용 | 우선순위 |
|---|---|---|---|
| A | **AI 입력에서 네이버 뉴스 제거** | 세 기능의 프롬프트에서 뉴스를 빼고 우리 데이터(시세·수급·테마·공시)만으로 분석 | **즉시** |
| B | 관련 뉴스는 **목록으로만 분리 표시** | AI 요약과 다른 칸에 네이버 검색 결과를 가공 없이(제목·출처·원문 링크, 네이버 BI 표시), 저장하지 않고 요청 시 조회 | A 와 함께 |
| C | AI 처리 가능한 뉴스 출처로 교체 | 통신사·언론사 콘텐츠 제휴(유료, AI 처리·저장 권리를 계약으로 확보), 언론사 RSS 는 사별 약관 확인(대개 개인·비상업·출처·링크 조건) | 검토 |
| D | **DART 공시** 활용 | 기업 이벤트(수주·계약·증자 등)를 원인 분석·레이더의 근거로 — 이용 조건 확인 | 검토 |
| E | 정책브리핑(korea.kr) 보도자료 | 공공누리 유형에 따라 상업 이용 가능할 수 있음 — 유형 확인 | 검토 |

구글뉴스 RSS 는 비상업 조건이라 상업 서비스 주력으로 쓰지 않는다(레이더 문서와 같은 판단).

## 5. 할 일
1. [ ] 공식 원문 확인: [약관 개정 공지](https://developers.naver.com/notice/article/33400), [NAVER API 서비스 이용약관](https://developers.naver.com/products/terms/) — AI 입력·저장·가공 조항 문구
2. [ ] **A·B 설계 → 구현 → 배포**(개발 먼저, 상용은 "상용 배포" 요청 시)
   - [x] A 구현(2026-11-19, `fix/naver-news-ai-input`) — 세 기능 모두 네이버 호출 경로 제거. 급등락 원인·핫 키워드는 생성 중단(기본 꺼짐),
     브리핑·정성 분석은 우리 데이터만. 자세한 내용: 설계 [`2026-11-19-market-data-off-plan-a-design.md`](superpowers/specs/2026-11-19-market-data-off-plan-a-design.md) 6절 6번
   - [ ] B(관련 뉴스 목록 분리 표시) — 미착수. 다시 쓸 때 조건은 `backend/apps/ai_analyst/clients/naver_news.py` 머리말
   - [ ] 개발 배포 → 상용 배포
3. [x] AI 결과 캐시·참고 기사 저장 방식 점검(2026-11-19) — 새로 저장하는 곳 없음(sources 언제나 `[]`, Redis 원인 캐시에도 근거 기사 필드 없음).
   남은 옛 데이터: Redis 키는 TTL(최대 4일)로 사라지고 응답에서는 이미 뺀다. PG `ai_daily_briefings.sources`·`ai_stock_evaluations.sources` 는
   TTL 이 없어 **배포 후 정리 필요**(사용자 확인 뒤 `sources` 를 비우는 운영 작업). 옛 브리핑·평가 본문도 뉴스 요약 산출물이라 함께 판단.
4. [ ] C·D·E 출처 조사 → 테마 뉴스 레이더 재설계 여부 결정

## 출처
- [waffleboard — 네이버 검색 API 약관 개정 정리](https://waffleboard.io/blog/naver-search-api-terms-ai-ads-storage)
- [네이버 개발자센터 — 약관 개정 공지(2026.8.7)](https://developers.naver.com/notice/article/33400)
- [NAVER API 서비스 이용약관](https://developers.naver.com/products/terms/)
