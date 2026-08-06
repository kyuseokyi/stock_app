# Phase 1 (b) — 국내 전종목 수집 확장

- 작성일: 2026-08-06
- 선행: `2026-07-21-phase1-kis-ohlcv-vertical-slice-design.md` (a 슬라이스, 005930 1종목)
- 관련: `docs/ROADMAP.md`(Phase 1-b), 메모리 `kis-market-code-un-nxt`

## 목표
(a)에서 검증한 단일 종목 파이프라인을 **국내 전종목(~2,800)** 으로 확장한다.
핵심은 종목 리스트가 15개든 2,800개든 동일한 **수집 인프라**(마스터 로더·레이트리밋·실패격리·beat).

## 구성 요소
```
backend/apps/collector/
  kis/master.py       # KRX 전종목 마스터(.mst) 다운로드/파싱 → (종목코드, 이름, 시장)
  stock_master.py     # load_domestic_tickers(source) — 소스 무관 로더(mst|fallback|auto)
  rate_limit.py       # RateLimiter(per_sec) — 동기 최소간격 보장
  tasks/universe.py   # collect_all_daily / backfill_all_daily (공통 루프 _run_universe)
```

## 핵심 결정
### ① 종목 마스터 = 소스 무관(pluggable), 매 수집마다 재로드
- `STOCK_MASTER_SOURCE`: `mst`(KRX .mst 전종목) | `fallback`(대형주 20) | `auto`(기본: mst→실패시 fallback).
- KIS 시세 API는 "전종목 목록"을 주지 않는다. 신규상장/상장폐지는 **KIS가 매일 갱신하는 .mst를 재다운로드**해야 반영됨 → 수집 태스크가 매 실행 시 `load_domestic_tickers()` 재호출.
- **다운로드 호스트**: `https://new.real.download.dws.co.kr/common/master/{kospi,kosdaq}_code.mst.zip` (dws.co.kr). ⚠️ 초기에 `dw.koreainvestment.com`으로 잘못 넣어 NXDOMAIN → dws.co.kr로 정정. 파싱: 고정폭·CP949, 라인 앞부분 `[0:9]`=단축코드/`[21:]`=한글명, 뒤 228바이트=수치필드.
  - 검증(2026-08-06 로컬 worker): KOSPI+KOSDAQ **4,383 instrument** 로드·수집 성공(주식+ETF/ETN/펀드/스팩 포함). 펀드/투자회사 등은 일봉 빈 응답 → 실패격리로 0행 스킵.

### ② 레이트리밋 = 동기 최소간격
- 수집 루프는 단일 Celery 워커 스레드에서 순차 실행 → `RateLimiter(per_sec)`로 호출 간 최소간격 보장.
- `KIS_RATE_PER_SEC`(기본 8; 실전 ~20/s 한도 내 보수적).
- 현 구조는 **동기 순차**(요청 latency 바운드). 전종목 성능이 부족하면 async(aiolimiter) 병렬로 승격(백로그). ams는 `AsyncLimiter` 사용.

### ③ 실패격리(failure isolation)
- 종목별 `try/except`로 한 종목 실패가 전체 루프를 막지 않음. 실패는 집계·샘플 반환.
- 상장폐지/합병 종목은 빈 응답 → 0행 적재(정상, 예외 아님).

### ④ 시장코드 UN (a에서 확립)
- 전종목도 `FID_COND_MRKT_DIV_CODE='UN'`(KRX+NXT 통합). 기존 J 수집분은 UN 재수집 필요.

## 태스크
| 태스크 | 용도 | 창/범위 |
|---|---|---|
| `collector.collect_all_daily(limit?, source?, rate_per_sec?)` | 전종목 일봉 정기수집 | 겹침창 today-30d~+2d |
| `collector.backfill_all_daily(months=14, ...)` | 전종목 장기 백필(청킹) | 종목별 전 시계열 MA 일괄 |

- MA는 종목별 **전체 시계열에 한 번만** 계산(청크별 계산 시 MA120 깨짐 — a 슬라이스 백필과 동일 원칙).

## Celery beat
- `collect-all-daily`: 매일 **20:30(Asia/Seoul)**. NXT 애프터마켓(~20:00) 종료 후 통합 일봉 확정 시점 이후.

## 검증(완료 기준)
1. `collect_all_daily(source='fallback')` → 다종목 적재, 종목별 MA 계산, 멱등. ✅ (fallback 20 → 18적재, 상폐 2종목 무시, 실패 0)
2. 실환경 `.mst` 로드 → **4,383 instrument** 수집. ✅ (로컬 worker, 정정 URL) — worker+beat 가동, 매일 20:30 자동수집.
3. 종목별 실패가 전체를 막지 않음(격리). ✅

## 비범위 (다음)
- `.mst` 실환경 값검증 + async 병렬 승격
- 해외/지수/재무, 정배열·역배열·매물대 CH 컬럼 영속화
- searchStocks(seed_catalog 15종목)와 수집 마스터 통합(현재 별개)
