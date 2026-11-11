# 펀드 기록 백업·복원 사용성 보강 설계 (2026-11-11)

선행: [펀드 히스토리 + Drive 백업](2026-10-19-fund-history-backup-design.md), [계정별 저장](2026-10-23-fund-per-account-storage-design.md).
범위는 **앱(mobile)만**이다. 서버는 바뀌지 않는다. 펀드 URL과 잔액은 지금처럼 기기와 본인 Drive에만 있다.

## 1. 목적과 결정
- 백업의 용도는 **앱을 지우거나 기기를 바꿀 때 기록을 옮기는 것**이다(사용자 결정 2026-11-11).
- 기록은 기기에만 있다. `allowBackup: false`라서 백업을 연결하지 않고 앱을 지우면 기록을 되살릴 수 없다. 이 사실을 사용자에게 알린다.

| 항목 | 결정 |
|---|---|
| 자동 복원 | 펀드 목록이 비었을 때 버튼 한 번으로 처리한다. Google 계정 선택 → 확인 창 없이 바로 복원 → 자동 백업 유지. 서버에 "백업 쓴 적 있음" 표시를 두지 않는다 |
| 사라짐 안내 | 펀드 목록 배너(미연결 또는 마지막 백업 7일 초과)와, 첫 펀드 등록 뒤 계정마다 한 번 띄우는 안내 시트 |
| 백업 내용 보기 | 마지막으로 올리거나 받은 합본의 요약(펀드 수, 기록 수, 마지막 기록 날짜)을 백업 화면에 표시 |
| 이전 백업 보관 | **하지 않는다.** 기기를 옮기는 데는 최신본 하나면 충분하다. 읽을 수 없는 Drive 파일은 지금도 덮어쓰지 않는다 |

범위 밖: 여러 개의 이전 백업, 백업 시점 선택 복원, 웹 복원, 서버 저장, 상용(prod) OAuth 설정.

## 2. 1탭 복원
- **연결+복원 흐름** `connectAndRestore()`을 `backup-service.ts`에 둔다. 화면 두 곳(펀드 목록 빈 화면, 백업 화면 [Google Drive 연결])이 같이 쓴다.
  1. `connect()`로 Google 계정을 고른다. 취소하면 `{ status: 'cancelled' }`를 돌려주고 아무것도 바꾸지 않는다.
  2. 백업 상태를 `connected: true, email`로 저장한다.
  3. `hasRemoteBackup()`
     - 참이면 `restoreFromDrive()`를 실행한 뒤 `backupNow()`를 실행한다. 복원한 기기 데이터를 내 계정 파일로 다시 올린다. 옛 파일에서 복원한 경우에도 내 파일이 생긴다.
     - 거짓이면 `backupNow()`만 실행한다(첫 백업).
  4. 결과로 `{ status: 'restored', addedFunds, skippedFunds, mergedPoints } | { status: 'fresh' } | { status: 'invalid' }`를 돌려준다.
     - `invalid`는 Drive 파일을 읽을 수 없는 경우다. 연결은 유지하고 올리지 않는다.
- 복원 뒤의 백업이 실패해도 복원 결과는 그대로 보여 준다. 오류는 지금처럼 백업 상태 `lastError`에 남긴다.
- 확인 창("이전 백업이 있어요, 합칠까요?")은 없앤다. 복원은 합치기(멱등)라서 기기의 기존 기록이 사라지지 않는다.
- **펀드 목록 빈 화면**: 버튼 "Google Drive에서 복원"은 그 자리에서 `connectAndRestore()`를 실행한다. 실행 중에는 버튼을 로딩 상태로 둔다.
  - 끝나면 목록을 다시 읽는다.
  - 결과 문구:
    - 복원: "펀드 N개, 기록 M건을 불러왔어요" (한도 초과가 있으면 " · K개는 한도로 건너뛰었어요")
    - 백업 없음: "불러올 백업이 없어요. 앞으로의 기록은 자동으로 백업돼요"
    - 읽기 실패: "Drive 백업 파일을 읽을 수 없어요"
  - 오류 문구는 백업 화면의 `errorText`를 공용으로 옮겨 같이 쓴다.
- **백업 화면 [Google Drive 연결]**도 `connectAndRestore()`를 쓰고 같은 결과 문구를 보여 준다.
- **`Google 미설정`**(`isBackupConfigured()`가 거짓)이면 지금처럼 버튼을 숨긴다.

## 3. "기록이 사라질 수 있어요" 안내
### 3-1. 판정(순수 함수, `features/fund/backup-risk.ts`)
```ts
export type BackupRisk = 'none' | 'disconnected' | 'stale';
export const STALE_DAYS = 7;
export function backupRisk(
  s: { connected: boolean; lastBackupAt: number | null },
  configured: boolean,
  fundCount: number,
  now: number,
): BackupRisk;
```
- `!configured` 또는 `fundCount === 0`이면 `'none'`
- `!s.connected`이면 `'disconnected'`
- 연결은 됐지만 `lastBackupAt === null`이거나 `now - lastBackupAt > STALE_DAYS × 24h`이면 `'stale'`
- 그 외에는 `'none'`
- 배너 문구에 쓰는 경과 일수 `daysSince(ts, now)`(내림한 정수)도 같은 파일에 둔다.

### 3-2. 펀드 목록 배너
- 위치: 펀드 목록 화면, 추가 카드 아래와 목록 위. 펀드가 1개 이상일 때만 보인다.
- 문구:
  - `disconnected`: 제목 "기록은 이 폰에만 있어요", 본문 "백업하지 않고 앱을 지우거나 폰을 바꾸면 기록이 사라져요"
  - `stale`: 제목 "마지막 백업이 N일 전이에요" (백업한 적 없으면 "아직 백업하지 못했어요"), 본문 "지금 백업해 두세요"
- 배너를 누르면 `/fund/backup`으로 간다. 닫기 버튼은 없다.
- 색은 경고용 강조색을 쓴다(`docs/mobile_design_language.md`의 기존 토큰에서 고르고 새 색은 만들지 않는다).
- 백업 상태는 화면 포커스마다 다시 읽는다(백업 화면에서 돌아오면 바로 사라지도록).

### 3-3. 한 번 안내 시트
- 조건: 펀드 추가로 0개가 1개가 된 순간 + `backupRisk(...) === 'disconnected'` + 이 계정에서 아직 본 적 없음.
- 저장: SecureStore `fund_backup_notice_seen_v1_u<userId>`(`keys.ts`에 키 함수 추가). 계정 소유자 목록 기록(`rememberFundOwner`)과 회원 탈퇴 정리 목록에도 넣는다.
- 겹침 방지: 푸시 안내 시트(`promptOpen`)나 옛 데이터 가져오기 시트(`legacyPreview`)가 열려 있으면 기다렸다가, 둘 다 닫힌 뒤에 연다.
- 내용: 제목 "기록은 이 폰에만 저장돼요", 본문 "Google Drive에 백업해 두면 앱을 지우거나 폰을 바꿔도 기록을 되살릴 수 있어요", 버튼 [백업 연결] / [나중에].
  - [백업 연결]은 `connectAndRestore()`를 실행하고 결과 문구를 보여 준다.
  - 어느 버튼을 누르거나 닫아도 "봤음"으로 저장한다.

### 3-4. 백업 화면 문구
- 안내 문구에 "백업하지 않고 앱을 지우거나 폰을 바꾸면 기록을 되살릴 수 없어요"를 더한다.

## 4. 백업 내용 보기
- 코어 `core/backup.ts`(웹 복사본도 동기화):
```ts
export type BackupSummary = { funds: number; points: number; lastDate: string | null }; // lastDate = 'YYYY-MM-DD'
export function summarizeBackup(b: Backup): BackupSummary;
```
  - `points`는 모든 펀드·계좌의 기록 건수 합이다.
  - `lastDate`는 그중 가장 늦은 날짜이고, 기록이 없으면 `null`이다.
- `doBackup`: 올린 합본(`buildBackup` 결과)의 요약을 `lastBackupAt`과 함께 저장한다.
- `doRestore`: 받은 백업의 요약을 저장한다. Drive에 있는 내용이기 때문이다.
- 백업 상태 `BackupState`에 `summary: BackupSummary | null`을 추가한다.
  - `parseBackupState`는 모양이 틀리거나 없으면 `null`로 읽는다(옛 상태와 호환).
  - `resetBackupState`(연결 해제) 때 같이 비운다.
- 백업 화면 카드에 "Drive 백업 · 펀드 N개 · 기록 M건 · M.D 기록까지"를 마지막 백업 시각 위에 표시한다. 요약이 `null`이면 표시하지 않는다.

## 5. 오류 처리
- 연결 취소: 문구 없이 원래 상태로 돌아간다.
- 복원은 성공했는데 뒤이은 백업이 실패: 복원 결과 문구를 보여 주고, `lastError`가 백업 화면과 배너(`stale`)에 반영된다.
- Google 계정 확인 불가(`unverified`)나 권한 오류(`auth`) 같은 지금 있는 오류 분류와 문구는 그대로 쓴다.

## 6. 테스트
- jest(코어): `summarizeBackup`(빈 백업, 여러 펀드·계좌, 가장 늦은 날짜)
- jest(앱):
  - `backupRisk` 경계: 미설정, 펀드 0, 미연결, 정확히 7일, 7일 초과, 백업한 적 없음
  - `daysSince`
  - `parseBackupState`: 옛 상태(요약 없음)는 `summary: null`, 잘못된 모양도 `null`
  - `connectAndRestore`: 취소, 백업 있음(복원 후 백업 호출 순서), 백업 없음(백업만), 읽기 실패(올리지 않음), 복원 후 백업 실패(복원 결과 유지)
  - 백업과 복원 성공 시 요약 저장
- 웹: 코어 동기화 검사(`scripts/check-fund-core-sync.sh`), 웹 테스트 통과
- 실기기(Google Cloud 설정 뒤): 기기 A에서 연결과 백업, 기기 B나 재설치에서 빈 목록 버튼 한 번으로 복원, 배너가 생기고 사라지는지

## 7. 반영과 준비
- 네이티브 변경이 없다. `ota:dev`로 반영한다.
- 실제로 켜려면 사용자가 준비해야 한다(README '펀드 히스토리 · Google Drive 백업' 절차).
  1. Google Cloud에서 Drive API를 켜고 OAuth 동의 화면을 테스트 모드로 만든다. 본인 계정을 테스트 사용자로 넣는다.
  2. OAuth 클라이언트를 만든다. Android(`com.stockapp.dev`, 개발 APK 서명 keystore `mobile/android/app/debug.keystore`의 SHA-1)와 웹 애플리케이션.
  3. `mobile/.env.development`에 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`를 넣는다.
- 문서: README 해당 절, `docs/feature-report/app.md` 10절(백업 화면)과 펀드 목록 설명을 갱신한다.
