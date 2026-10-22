# 내 펀드 — 로그인 계정별 저장 + 앱 삭제 시 정리

- 작성: 2026-10-23 · 상태: 승인(사용자 결정 2건, 아래 1장)
- 문제: 펀드 목록·백업 상태가 기기에 키 하나로 저장돼, 어느 계정으로 로그인해도 같은 펀드가 보인다(개발용 게스트로 추가한 펀드가 카카오 계정에도 나옴). 앱을 지워도 Android 자동 백업·iOS 키체인으로 되살아날 수 있다.
- 선행: `2026-10-18-fund-report-viewer-design.md`(URL 은 기기에만), `2026-10-19-fund-history-backup-design.md`(기록·Drive 백업), `2026-10-19-fund-report-notice-design.md`(푸시·백그라운드)

## 1. 결정
| 항목 | 결정 |
|---|---|
| 저장 위치 | **기기 안에서 계정별 분리**(사용자 선택). 서버는 계속 펀드 URL·잔액을 모른다("개인정보는 기기·본인 Drive 에만" 원칙 유지). 같은 계정의 다른 기기로는 Drive 복원으로 옮긴다 |
| 기존 데이터 | **처음 들어온 계정이 가져올지 선택**(사용자 선택). 옛 키에 펀드가 있으면 펀드 화면에 한 번 묻는다: [가져오기] / [버리기], 닫으면 다음에 다시 |
| 앱 삭제 | 앱을 지우면 펀드·기록·백업 상태·로그인 정보가 남지 않는다(사용자 요구 2026-10-23) |

## 2. 앱(mobile)
- **목록 키**: `fund_list_v1` → `fund_list_v1_u<userId>`(SecureStore 키 허용 문자 `[A-Za-z0-9._-]`). 소유자 = `useAuthStore.getState().user?.id`.
  로그인 안 됨(또는 hydrate 전)이면 `loadFunds`·`saveFunds` 모두 throw — 읽고 고쳐 쓰는 경로가 빈 목록으로 덮어쓰지 않게(호출부는 이미 catch).
- **캐시·기록 파일**(`fund-cache-<fundId>`·`fund-history-<fundId>`)은 그대로 — 펀드 id 가 무작위라 겹치지 않고 목록이 접근 범위를 정한다. 가져오기 때 파일 복사 불필요.
- **가져오기 안내**: 옛 키 `fund_list_v1` 에 펀드 ≥1 + 로그인 → 펀드 목록 화면 바텀시트.
  - 가져오기: 내 목록과 합침(URL 중복 제거, `MAX_FUNDS` 까지, 넘치면 남은 개수 안내) → **내 키 먼저 쓰고** 옛 키 삭제. 옛 백업 상태가 있고 내 백업 상태가 비었으면 함께 넘김.
  - 버리기(확인 후): 옛 키 + 그 펀드들의 캐시·기록 파일 + 옛 백업 상태 삭제.
  - 둘 다 끝나면 정기 작업 동기화(`syncBackgroundTasks`)·푸시 등록 갱신(펀드 수가 바뀜).
- **Drive 백업 경계**(계정 사이 누출 방지):
  - 백업 상태 `fund_backup_state_v1` → `fund_backup_state_v1_u<userId>`, 대기 표시 파일 `fund-backup-pending.json` → `fund-backup-pending-u<userId>.json`.
  - Drive 파일 이름 `fund-backup-v1.json` → `fund-backup-v1-u<userId>.json`. 복원은 내 파일이 없을 때만 옛 파일(`fund-backup-v1.json`)을 읽는다(같은 Google 계정 = 본인 Drive 의 옛 백업이 사라지지 않게). 업로드는 항상 내 파일.
  - 모든 Drive 작업 직전 현재 Google 로그인 이메일 = 이 계정 백업 상태의 email 확인. 다르면(다른 앱 계정이 연결한 Google) 작업하지 않고 "연결 안 됨"으로 본다.
- **계정 전환**: 정기 작업 want·SSE/푸시 `countFunds` 는 호출 시점의 현재 사용자 기준(저장소가 매번 읽음).
- **회원 탈퇴 성공**: 그 계정의 목록·캐시·기록·백업 상태·대기 파일 삭제 + Google 로그아웃.
- **앱 삭제**:
  - Android: `app.config.js` `android.allowBackup: false`(Google 자동 백업이 재설치 때 파일을 되살리지 않게). 네이티브 변경 → APK 재빌드 필요(OTA 불가).
  - iOS: 키체인은 앱 삭제 후에도 남는다 → 문서 폴더의 첫 실행 표식 파일이 없으면 SecureStore(로그인 토큰·펀드 목록·백업 상태·소유자 목록)를 지우고 표식을 쓴다. **iOS 에서만**(Android 는 업데이트 첫 실행에 로그아웃·옛 데이터 삭제가 생기므로 제외 — iOS 는 출시 전이라 업데이트 사용자 없음). SecureStore 는 키 나열 API 가 없어 계정별 키를 지우려고 소유자 목록 `fund_owners_v1` 을 둔다. 인증 hydrate 보다 먼저, 백그라운드 hydrate 경로에도.

## 3. 웹(web_client)
- localStorage `fund_list_v1` → `fund_list_v1_u<userId>`, 리포트 캐시 키도 같은 원리(펀드 id 기반이면 그대로). 옛 키에 펀드가 있으면 같은 가져오기 안내. 로그아웃 상태는 목록 없음.
- 브라우저 저장소는 사이트 데이터 삭제로 지워지므로 별도 처리 없음.

## 4. 테스트
- jest: 계정별 키·로그인 없음 throw, 가져오기 합치기(중복·상한·순서), 버리기 정리, 계정 A/B 전환 시 목록 분리, Drive 이메일 불일치 시 작업 생략, 복원 옛 파일 대체, 탈퇴 정리, iOS 첫 실행 정리(Android 미실행).
- 실기기: 게스트로 펀드 추가 → 카카오 로그인 → 가져오기 안내 → 게스트 재로그인 시 분리 확인 → 앱 삭제·재설치 후 데이터 없음.
