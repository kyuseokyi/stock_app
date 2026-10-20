# 장 마감 시간에 맞춘 지표 갱신 설계 (2026-10-20)

스크리너의 주요 지표를 **한국·미국 장이 끝나는 시간에 맞춰** 갱신한다. 서버 수집 일정(Celery beat)과 화면 안내 문구만 바꾼다.

## 1. 지금 (모두 한국 시간)

| 대상 | 지금 수집 | 장 마감 | 차이 |
|---|---|---|---|
| 국내 지수(코스피·코스닥·코스피200) | 20:30 일일 파이프라인 안 | KRX 정규장 15:30 | 약 5시간 늦음 |
| 종목 일봉·투자자 순매수·CANSLIM·테마·업종 | 20:30 | NXT 애프터마켓 20:00 | 마감 직후 |
| 미국 지수·환율·대표 종목 | 07:30 | 05:00(서머타임 3~11월) / 06:00(그 외) | 1.5~2.5시간 늦음 |

## 2. 결정

| # | 내용 |
|---|---|
| D1 | **국내 지수만 15:40 에 따로 수집**(`collect_market_indices(region="KR")`). KRX 지수는 15:30 종가로 확정되고 NXT 거래와 무관하다 |
| D2 | 20:30 파이프라인의 국내 지수 단계는 **그대로 둔다** — 15:40 수집이 실패해도 메꾸는 안전망. 같은 날짜는 덮어쓰기라 중복 없음 |
| D3 | **미국 지수 07:30 → 06:30.** 서머타임(05:00 마감)·겨울(06:00 마감) 모두 마감 뒤. 07:30 은 **안전망으로 한 번 더** 둔다(멱등) |
| D4 | 종목 일봉·테마·업종·CANSLIM 은 **20:30 유지** — KRX+NXT 통합 시세(UN)가 NXT 20:00 마감 뒤에 확정되기 때문(앞당기면 한투 MTS 와 달라짐) |
| D5 | 화면 안내 문구에 **실제 갱신 시각**을 적는다: "국내 지수 15:40 · 종목·테마·업종 20:30 · 미국 06:30 갱신" |

## 3. 바꾸는 것

**서버 `backend/apps/collector/celery_app.py` beat 일정**
- 새 항목 `collect-kr-indices`: `collector.collect_market_indices`, `crontab(hour=15, minute=40, day_of_week="mon-fri")`, `kwargs={"region": "KR"}`
- `collect-us-indices`: `crontab(hour=6, minute=30, day_of_week="tue-sat")` (미국 월~금 장 → 한국 화~토 아침)
- 새 항목 `collect-us-indices-retry`: 같은 태스크, `crontab(hour=7, minute=30, day_of_week="tue-sat")`(안전망)
- 휴장일에 돌아도 마지막 거래일 값을 다시 쓰는 멱등 동작이라 문제없다.

**화면 문구**
- 웹 `web_client/src/components/market/BasisNote.tsx`: `매일 장 마감 후 갱신` → `국내 지수 15:40 · 종목·테마·업종 20:30 · 미국 06:30 갱신`
- 웹 `MarketStrip.tsx`(주도주 머리글)는 CANSLIM(20:30)만 다루므로 `매일 20:30 갱신`
- 웹 빈 상태 두 곳(`MarketTab`·`GroupTab` "매일 장 마감 후 갱신돼요")은 그대로(일반 안내)
- 모바일 스크리너 계획(`docs/superpowers/plans/2026-10-20-mobile-screener.md`)의 `basis-note.tsx` 문구도 같은 내용으로 바꾼다

**문서** — README "시장 데이터 수집" 절의 일정 설명, `docs/server_setup.md` 의 beat 설명(있으면)

## 4. 영향 확인
- **데이터 현황(관리자)**: 국내 지수는 "일봉 기준일보다 **오래되면** 늦음" 판정 → 15:40 에 지수가 일봉보다 하루 앞서도 경고 없음.
- **KIS 호출 겹침**: 15:40 에는 다른 KIS 수집이 없다(일봉 파이프라인 20:30). 지수 13개 내외라 호출량이 작다.
- **실제 확인(배포 뒤)**: 실제 KIS 호출은 로컬에서 하지 않는다(작업 규칙). 배포 다음 거래일 15:40 이후 관리자 **데이터 현황 → 국내 지수** 기준일이 당일인지, 06:30 이후 미국 지수가 전날(미국 날짜)인지 본다.

## 5. 테스트
- `backend/tests/test_market_tasks.py::test_beat_schedule_entries` 확장: `collect-kr-indices`(15:40·월~금·KR), `collect-us-indices`(06:30·화~토·US), `collect-us-indices-retry`(07:30·화~토·US) 확인.
- 전체 백엔드 테스트, 웹 `tsc`.
