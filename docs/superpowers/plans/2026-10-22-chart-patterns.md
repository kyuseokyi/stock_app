# 차트 패턴 구현 계획

> 실행: superpowers:subagent-driven-development(작업마다 구현 → 리뷰 → 수정). 스펙 `docs/superpowers/specs/2026-10-22-chart-patterns-design.md`.

**목표**: 참고 v2 엔진을 일봉 전용으로 이식하고, 매일 최신 기준일의 베이스를 `chart_pattern_daily` 에 저장해 웹 '패턴' 탭·앱 '패턴' 칩·종목 상세에서 보여 준다.

**공통 규칙**: dev 브랜치, `git add` 는 파일을 지정(‑A·. 금지), `.serena/project.yml` 커밋 금지, 커밋 메시지 한국어 + Co-Authored-By/Claude-Session 두 줄, 테스트 실패 시 커밋 금지, `rm -rf`·`sleep` 금지, KIS 호출 금지, env 실파일 수정 금지, 백엔드 테스트 `cd backend && uv run pytest -p no:warnings`.

## 순서와 병렬
1 → 2 → 3 은 차례대로. 3 이 끝나면 4(웹)·5(앱)를 파일 범위를 나눠 병렬. 6(문서)은 마지막. 실데이터 검증은 사용자 일봉 백필(37개월) 뒤.

## 작업 1 — 엔진 이식(순수)
- 만들기: `backend/apps/collector/patterns/{__init__,constants,utils,swing,detector,base_count}.py`, `patterns/kinds/{__init__,cup,cup_with_handle,double_bottom,flat_base,consolidation,htf}.py`, 테스트 `backend/tests/test_patterns_*.py`.
- 참고(읽기만): `/Users/kyuseok/Documents/projects/ams/workspace/api/app/services/chart_pattern/`(detector·base_count·base_finder·utils·constants·schema·patterns/), 합성 시나리오 `/Users/kyuseok/Documents/projects/ams/workspace/api/scripts/validation/validate_*_detector.py`·`validate_htf_skeleton.py`.
- 일봉(D) 기준값만, 판정 로직·수치는 그대로. 사내 의존 제거. 입력 `[(date, open, high, low, close, volume)]`, 출력 dataclass `Base`(스펙 3절 필드). `detect(bars, display_bars=520) -> list[Base]`(표시 구간에 걸친 베이스만, 단계는 전체로 계산), 돌파 지표 계산 포함.
- 테스트: 패턴별 합성 감지·비감지, 돌파·길이·깊이, 병합·겹침 제거, 단계(리셋·sub·증가), HTF 피벗.

## 작업 2 — 저장·계산 태스크
- 만들기: `repositories/clickhouse_patterns.py`(DDL·`load_bars` open 포함 최근 770봉·기준일 삭제 후 적재), `tasks/patterns.py`(`compute_patterns(as_of=None)`, 실패 격리·실패율 5%·0행 error), `celery_app` include, `market_data.daily_market_pipeline` 마지막 단계 `patterns`, `admin_jobs` JOBS `patterns`. 테스트.

## 작업 3 — 조회·GraphQL
- 만들기: `stock_api/services/pattern_query.py`(`screen(report, pattern_type, market, sort, limit, offset)`, `bases(ticker)` + 매매 구간·숨김 규칙), `graphql/types.py`·`schema.py` 에 `patternScreen`·`patternBases`. 테스트 + 계약 테스트 틀(`test_pattern_contract.py` — 웹·모바일 `PATTERN_SCREEN_QUERY`·`PATTERN_BASES_QUERY`).

## 작업 4 — 웹 '패턴' 탭
- `web_client`: `api/patterns.ts`(`*_QUERY` export, `${}` 금지), `types/patterns.ts`, `lib/patterns.ts`(라벨·리포트·정렬 상수), `components/patterns/*`, `pages/screener/PatternsTab.tsx`, `App.tsx` 라우트·`ScreenerLayout.tsx` TABS, `StockDailyChart` 선택 prop `priceLines`·`markers`(lightweight-charts v4 `createPriceLine`·`setMarkers`). `tsc` 통과.

## 작업 5 — 앱 '패턴' 칩 + 종목 상세
- `mobile/src/features/patterns/*`(api·types·순수 함수+jest·훅·섹션·행·칩), `app/(tabs)/screener.tsx` 칩, `app/stock/[ticker].tsx` '차트 패턴' 영역(차트 `lines` 로 피벗·매수 상단·손절). typecheck·jest 통과.

## 작업 6 — 문서·마무리
- README(패턴 절: 계산·수동 실행·일봉 37개월 백필 전제·알려진 한계), ROADMAP Phase 2 항목, 계약 테스트가 웹·모바일 쿼리를 실제로 읽는지 확인. 전체 테스트.

## 실데이터 검증(백필 후)
- 터널로 읽기만: 1회 계산 시간, 패턴별·리포트별 건수, 대표 종목 몇 개의 베이스가 차트 눈으로 맞는지.
