# 펀드 히스토리 + Google Drive 백업 설계 (2026-10-19)

선행: [펀드 수익보기](2026-10-18-fund-report-viewer-design.md). 범위는 **앱(mobile)만**. 웹은 지금처럼 리포트만 보여준다.

## 1. 목표
- 리포트를 새로 가져올 때마다 계좌별 **현재평가금·당일 손익금·월 손익금**을 날짜별로 기기에 쌓는다(서버 저장 없음).
- 앱 삭제·재설치에 대비해 사용자 **본인 Google Drive**(앱 전용 숨김 폴더)에 백업·복원한다.
- 히스토리를 차트(현재평가금) + 날짜별 목록으로 보여준다.

범위 밖: 웹 히스토리, 여러 기기 실시간 동기화, 과거 날짜 소급(원본에 과거 값이 없음), 서버 백업.

## 2. 기록
```ts
type HistoryPoint = {
  date: string;          // 원본 '최종평가일' YYYY-MM-DD — 키
  value: number | null;  // 현재평가금
  day: number | null;    // 당일 손익금
  month: number | null;  // 월 손익금
  recordedAt: number;    // 가져온 시각(ms)
};
type FundHistory = { v: 1; url: string; accounts: Record<string /* 계좌명 */, HistoryPoint[]> }; // 날짜 오름차순
```
- **언제:** 원본을 새로 가져와 파싱에 성공한 순간만. 앱 `fund/[id].tsx` 에서 `entry && !refreshing && !error` 가 되고 `entry.fetchedAt` 이 바뀌었을 때 기록한다. 공용 훅 `useFundReport` 는 바꾸지 않는다(웹 영향 없음).
- **같은 날짜**가 다시 오면 덮어쓴다 → 날짜당 1건. 앱을 안 연 날은 비어 있다.
- **숫자 변환:** 원본 글자(`₩12,345,000`, `-15,000`, `−`)를 숫자로. 못 읽는 칸은 `null`, 나머지는 기록. 최종평가일이 없으면 그 회차는 기록하지 않는다.
- **계좌 구분:** 카드의 계좌 이름. 라벨은 `현재평가금` / `당일 손익금` / `월 손익금`(공백 차이는 무시해 비교).
- **저장:** 앱 문서 폴더 `fund-history-<펀드id>.json`(리포트 캐시와 같은 방식). 보관 기한 없음(연 ~250건 × 계좌 수).
- **펀드 삭제** 시 히스토리 파일도 지운다. 삭제 확인 문구에 "기록도 삭제됩니다" 추가.
- **쓰기 실패**는 무시(리포트 표시는 그대로, 그 회차 기록만 건너뜀).

core(`core/history.ts`, 순수 함수 · 웹 fundCore 에도 동기화 복사):
- `snapshotOf(report, now): { date; accounts: Record<string, Omit<HistoryPoint,'date'>> } | null`
- `mergePoint(history, snapshot): { history: FundHistory; added: boolean }` — 같은 날짜 교체, 날짜순 유지, 새 날짜 추가 여부 반환
- `parseHistory(raw, url): FundHistory` — 깨진 파일/항목은 버림

## 3. Google Drive 백업·복원
- **연결:** `@react-native-google-signin/google-signin`(네이티브, dev build). 권한은 `https://www.googleapis.com/auth/drive.appdata` 하나. 토큰은 모듈이 관리하고 호출마다 `getTokens()` 로 access token 을 받는다. 우리 저장소에는 연결 여부·계정 이메일·마지막 백업 상태만 둔다(SecureStore `fund_backup_state_v1`).
- **파일:** Drive `appDataFolder` 의 `fund-backup-v1.json` 하나(사용자 Drive 화면에 안 보임, 이 앱만 접근).
```ts
type Backup = {
  v: 1;
  exportedAt: number;
  funds: { name: string; url: string }[];                       // 재설치 시 목록도 사라지므로 함께
  history: Record<string /* url */, Record<string /* 계좌명 */, HistoryPoint[]>>;
};
```
  펀드 id 는 기기마다 새로 생기므로 **URL 이 키**.
- **Drive 호출**(`fetch` 직접, 서버 경유 없음): `files.list?spaces=appDataFolder&q=name='fund-backup-v1.json'`, 업로드(없으면 `POST multipart` 생성, 있으면 `PATCH uploadType=multipart`), 다운로드 `files/{id}?alt=media`.
- **자동 백업:** 연결 상태에서 `mergePoint` 가 새 날짜를 추가했고 마지막 성공 백업이 오늘(기기 날짜) 이전이면 백그라운드로 업로드 → 하루 최대 1번. 실패는 조용히 상태에만 기록, 다음 새 기록 때 재시도.
- **수동:** 백업 화면의 [지금 백업](로컬 전체로 덮어씀) / [복원] / [연결 해제](`signOut` + `revokeAccess`, Drive 파일은 남김).
- **복원 = 합치기(덮어쓰기 아님, 멱등):**
  - 펀드: URL 기준, 로컬에 없는 것만 추가. `MAX_FUNDS`(10) 초과분은 건너뛰고 개수 안내. 이름은 `MAX_NAME` 으로 자름.
  - 히스토리: (URL, 계좌, 날짜) 기준 합집합, 같은 날짜면 `recordedAt` 늦은 쪽.
  - 결과 안내: "펀드 N개 추가, 기록 M건 합침".
- **검증:** `parseBackup` 이 `v`, `isFundUrl`, 날짜 형식, 숫자 타입을 확인하고 틀린 항목은 버린다. 최상위가 깨졌으면 "백업 파일을 읽을 수 없어요", 로컬은 건드리지 않는다.
- **재설치 진입점:** 펀드 목록이 비었을 때 빈 화면에 "Google Drive에서 복원" 버튼.

core(`core/backup.ts`): `buildBackup(funds, histories, now)`, `parseBackup(raw)`, `mergeBackup(local, backup) → { funds, histories, addedFunds, skippedFunds, mergedPoints }`.
앱: `features/fund/google-auth.ts`(로그인 래퍼), `features/fund/drive-backup.ts`(Drive REST), `features/fund/history-store.ts`(파일 I/O + 기록·자동백업 연결).

## 4. 화면
- `fund/[id]` 헤더 오른쪽: 새로고침 옆 **히스토리 아이콘** → `fund/history/[id]`.
- `fund/index` 헤더 오른쪽: **백업 아이콘** → `fund/backup`.
- **히스토리** `fund/history/[id].tsx`: 리포트와 같은 WebView 방식(`history-web/history-page.ts`, `String.raw`·백틱/`${` 금지·textContent 만). 화면 모델은 core `toHistoryView(history, range)`.
  - 계좌 칩(1개면 숨김) · 기간 1개월/3개월/전체
  - 현재평가금 선 차트(inline SVG, 라이브러리 없음, 세로 최소/최대 · 가로 시작/끝 날짜). 2건 미만이면 "기록이 쌓이면 그래프가 보여요".
  - 목록(최신 위): 날짜 · 평가금 / 아래 `당일 ±… · 월 ±…`. B안 포맷 규칙(쉼표·`원`·U+2212·오른쪽 정렬·tabular-nums, 손익만 상승 빨강/하락 파랑).
  - 기록 0건: "리포트를 열 때마다 하루 한 건씩 기록돼요".
- **백업** `fund/backup.tsx`(Unistyles 네이티브, 토스식 카드): 연결 계정/연결 안 됨, 마지막 백업 시각·실패 이유, [지금 백업] [복원] [연결 해제] 또는 [Google Drive 연결].

## 5. 오류 처리
| 상황 | 처리 |
|---|---|
| 로그인 취소 | 조용히 원래 상태 |
| 401/403(만료·권한 회수) | 연결 해제 상태로 바꾸고 "다시 연결해 주세요" |
| 네트워크 실패 | 수동: 문구 표시 / 자동: 상태만 기록 |
| 백업 파일 없음 | "아직 백업이 없어요" |
| 깨진 백업 | 복원 중단, 로컬 그대로 |
| 히스토리 쓰기 실패 | 무시(리포트 정상 표시) |
| Google 설정 없음(`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 비어 있음) | 백업 화면에 "백업 설정이 필요해요"만, 히스토리는 정상 동작 |

## 6. 테스트
- core jest(가린 픽스처): `snapshotOf`(current/legacy, 깨진 숫자→null, 날짜 없음→null), `mergePoint`(같은 날 교체·정렬·added), `parseHistory`, `parseBackup`(잘못된 항목 제거), `mergeBackup`(멱등·10개 한도·recordedAt 우선), `toHistoryView`(기간 필터·포맷).
- `drive-backup.ts`: fetch 모킹으로 요청 URL·헤더·multipart, 생성/갱신 분기, 401, 파일 없음.
- `history-page.ts`: 백틱·`${` 금지 규칙, 기본 렌더 스모크.
- 실제 로그인·Drive 는 OAuth 클라이언트 생성 후 dev build 에서 수동 확인.

## 7. 사용자 준비 작업(Google Cloud)
1. 프로젝트 생성 → **Google Drive API** 사용 설정
2. OAuth 동의 화면: 외부 · 테스트 모드 · 테스트 사용자에 본인 계정 추가 · 범위 `drive.appdata`
3. OAuth 클라이언트: **Android** × 2(`com.stockapp.dev`, `com.stockapp`, 각 서명 SHA-1 — EAS/로컬 keystore), **Web** × 1
4. Web 클라이언트 ID 를 `mobile/.env.development` · `.env.production` 의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 에 넣고 새 dev build
README 에 같은 절차를 적는다.

## 8. 구현 순서
1. core: history · backup · history view (+테스트, 웹 fundCore 동기화)
2. 앱 history-store + `[id].tsx` 기록 연결 + 펀드 삭제 시 정리
3. 히스토리 화면
4. google-auth · drive-backup (+fetch 모킹 테스트)
5. 백업 화면 + 자동 백업 + 빈 목록 복원 버튼
6. README

1~3 은 Google 설정 없이 동작한다.
