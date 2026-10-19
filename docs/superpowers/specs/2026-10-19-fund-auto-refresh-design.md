# 펀드 리포트 자동 갱신 설계 (2026-10-19)

선행: [펀드 수익보기](2026-10-18-fund-report-viewer-design.md), [히스토리·백업](2026-10-19-fund-history-backup-design.md).
후속: [펀드 리포트 알림](2026-10-19-fund-report-notice-design.md) — 이 문서의 `runAutoRefresh({ force: true })` 를 SSE 신호·알림 탭에서 호출한다.
범위: 웹(`web_client`) + 앱(`mobile`). **서버 변경 없음**(URL 은 계속 기기에만).

## 1. 목표
- 앱 실행·앱 복귀·웹 접속 때 등록한 펀드 원본을 모두 다시 가져와 캐시를 갱신한다.
- 앱은 리포트를 열지 않아도 히스토리가 쌓인다(성공한 펀드마다 기록 + 새 날짜면 자동 백업).
- 목록 화면에서 갱신 결과(기준일·마지막 확인)를 볼 수 있다.

범위 밖: 앱이 꺼져 있을 때의 백그라운드 주기 작업, 서버 프록시.

## 2. core — `core/refresh-all.ts` (웹 fundCore 에도 동기화 복사)
```ts
type RefreshAllDeps = RefreshDeps & {
  minAgeMs?: number;       // 기본 10분 — 마지막 확인이 이보다 최근이면 건너뜀
  concurrency?: number;    // 기본 2
  force?: boolean;         // true 면 minAgeMs 무시(SSE 신호·알림 탭)
  onResult?: (fund: FundEntry, r: { entry: CacheEntry } | { error: FundErrorCode }) => void;
};
refreshAll(funds: FundEntry[], deps: RefreshAllDeps): Promise<{ refreshed: number; skipped: number; failed: number }>
```
- 펀드별로 `readValidCache` → `fetchedAt >= now - minAgeMs` 면 건너뜀, 아니면 기존 `refreshReport`.
- 동시 실행 상한 `concurrency`. 한 펀드 실패가 나머지를 막지 않는다(실패는 `onResult` 의 `error`).
- 중복 실행 방지(single-flight)는 플랫폼 래퍼 몫: 진행 중이면 같은 Promise 를 돌려준다. 진행 중에 `force` 호출이 오면 끝난 뒤 force 로 한 번 더 실행(신호 유실 방지).

## 3. 공용 훅 `useFundReport` — `reload()` 추가
- 기존 동작(캐시 먼저 → 열 때마다 다시 가져오기)은 그대로.
- `reload()`: 원본을 가져오지 않고 캐시만 다시 읽어 `entry` 교체. 자동 갱신이 끝났을 때 열려 있는 리포트 화면이 호출한다.

## 4. 앱 (mobile)
- `features/fund/record.ts` — `fund/[id].tsx` effect 안의 기록 규칙을 옮긴다(동작 동일).
  `recordFetched(fund, entry)`: 같은 `(fund.id, fetchedAt)` 은 한 번만 → `recordSnapshot` → 새 날짜면 `maybeAutoBackup()`. 리포트 화면과 자동 갱신이 함께 쓴다.
- `features/fund/auto-refresh.ts`
  - `runAutoRefresh({ force? })`: `loadFunds()` → 비었으면 끝 → `refreshAll(funds, { fetchHtml: fetchReportHtml, cache: fileCache, now: Date.now, force, onResult })`. 성공 펀드는 `recordFetched`. single-flight. 끝나면 `emitFundsRefreshed(ids)`.
  - `onFundsRefreshed(listener) → unsubscribe` (모듈 내 Set), `isAutoRefreshing()` + 상태 구독(목록 로딩 표시용).
- 훅 `useFundAutoRefresh()` 를 `app/_layout.tsx` 에 한 번: 로그인 상태일 때 마운트 1회 + `AppState` 가 `background|inactive → active` 로 바뀔 때.
- `fund/[id].tsx`: 갱신된 id 에 자기 펀드가 있으면 `reload()`.
- 목록 `fund/index.tsx`: 펀드 이름 아래 `기준일 YYYY.MM.DD · N분 전 확인`(캐시 기준, 캐시 없으면 줄 생략), 자동 갱신 중이면 헤더에 작은 로딩 표시. 갱신 이벤트에 캐시를 다시 읽는다. 기존 행 레이아웃은 유지하고 한 줄만 추가.

## 5. 웹 (web_client)
- `lib/fundAutoRefresh.ts`: 같은 구조(`localCache`, 히스토리 없음) + single-flight + 이벤트.
- `Layout` 에서 훅: 로그인 상태 + 펀드 있음 → 마운트 1회 + `visibilitychange` 로 다시 보일 때.
- `FundListPage`: 앱과 같은 한 줄 + 갱신 중 표시. `FundReportPage`: 자기 id 가 갱신되면 `reload()`.

## 6. 오류 처리
| 상황 | 처리 |
|---|---|
| 펀드 일부 실패(네트워크·형식) | 조용히 건너뜀. 리포트를 열면 기존처럼 오류 배너 |
| 펀드 목록 읽기 실패 | 아무것도 안 함 |
| 기록·백업 실패 | 기존 규칙대로 무시 |
| 로그아웃 상태 | 실행 안 함 |

## 7. 테스트
- core jest `refresh-all.test.ts`: 10분 이내 건너뜀, force 면 모두, 동시 2개 상한(진행 중 개수 측정), 한 펀드 실패해도 나머지 성공, onResult 호출, 캐시 없음 → 가져옴.
- 앱 jest: `auto-refresh`(single-flight, 진행 중 force → 한 번 더), `record`(같은 fetchedAt 1회, 새 날짜일 때만 백업).
- 웹 tsc·lint, `scripts/check-fund-core-sync.sh`.

## 8. 구현 순서
1. core `refreshAll` + 테스트 + 웹 동기화
2. 공용 훅 `reload()`
3. 앱 `record.ts` 로 기록 규칙 이동(동작 동일) → `auto-refresh.ts` + `_layout` 훅
4. 앱 목록 한 줄 · 리포트 화면 재읽기
5. 웹 자동 갱신 + 목록 한 줄 · 리포트 재읽기
6. README
