# 펀드 리포트 알림 설계 — 관리자 발송 · 푸시 · SSE · 백그라운드 기록 (2026-10-19, 10-21 백그라운드 기록 추가)

선행: [펀드 리포트 자동 갱신](2026-10-19-fund-auto-refresh-design.md)(`fundRefresher.run({ force: true })` 사용).
범위: backend(blog 8000 + collector Celery) · admin_web · mobile · web_client.

## 1. 목표
- 관리자가 admin_web 에서 "오늘 수익률 리포트 업데이트"를 **명시적으로** 알린다.
- **푸시**(모바일): 사용자에게 **알리기** 위한 것. 리포트 데이터는 싣지 않는다(탭하면 앱이 열리고 자동 갱신이 가져옴). 별도의 무음 push 는 앱을 깨우는 신호일 뿐(§5·§7.1).
- **SSE**(웹·앱이 열려 있을 때): 데이터 **갱신 신호**. 받으면 각 기기가 자기 URL 을 다시 가져온다.
- 서버는 계속 펀드 URL 을 모른다. 아는 것은 "이 기기가 펀드 알림을 원한다"뿐.
- 관리자 기능: 문구 수정, 즉시·테스트·예약 발송, 발송 이력, 문구 템플릿 관리.
- **백그라운드 기록**(모바일만): 앱·웹을 열지 않은 날에도 히스토리가 쌓이게 한다(§7.1).
  - 원본은 그 순간의 스냅샷(기준일 1개)뿐이라 그날 못 가져오면 나중에 되살릴 수 없다 → 앱이 꺼져 있어도 기기가 직접 가져온다.
  - ① 관리자 발송 때 **무음 데이터 push**를 함께 보내 앱을 깨운다(가장 정확한 시점).
  - ② **정기 백그라운드 작업**(`expo-background-task`)을 안전망으로 둔다(push 를 못 받은 날·발송 안 한 날).
  - 남는 빈 날은 메우지 않고 히스토리에 "이전 기록 M.D" 로 드러낸다(§7.2). 기대치: Android 대부분 채움, iOS 는 OS 재량이라 가끔.
- 웹은 백그라운드 실행 수단이 없어 히스토리를 계속 저장하지 않는다(현재와 같음).

범위 밖: iOS 실발송 확인(APNs 키는 iOS 출시 때 — Apple Developer 연 $99), 펀드별 개별 알림, 웹 푸시(Web Push API), 새 글 알림의 `push_devices` 이전, **서버가 펀드 URL 을 받아 대신 수집**(URL·잔액·이름이 서버에 쌓여 "개인정보는 기기·본인 Drive 에만" 원칙과 충돌 — 하려면 별도 설계).

## 2. 기존 자산 재사용
| 기존 | 이번에 |
|---|---|
| `collector/push/` `PushSender`(mock·fcm 스켈레톤), `PUSH_BACKEND` | `ExpoPushSender` 추가(`PUSH_BACKEND=expo`). 기본값 `mock` 유지 |
| `collector/tasks/notifications.py` 새 글 태스크(Celery 위임 패턴) | 같은 패턴으로 `send_fund_notice` 추가. 새 글 태스크는 **변경 없음** |
| `push_templates`(모델만 있음) | 문구 템플릿으로 사용(목록·추가·수정·삭제), `last_sent_at` 갱신 |
| `blog/events.py` Redis `notifications` 채널 + SSE `/api/v1/notifications/stream` | 새 type `fund_report_updated` 발행 |
| `users.fcm_token`(1인 1토큰, 저장 경로 없음) | **사용 안 함·변경 없음**. 기기 단위 조건(펀드 등록 기기)이라 새 테이블 |

## 3. 데이터 (alembic 마이그레이션 1개)
```
push_devices
  id PK, token varchar(255) UNIQUE, user_id FK users ON DELETE CASCADE,
  platform varchar(16) ('android'|'ios'), fund_notice bool default true,
  created_at, updated_at
push_sends
  id PK, kind varchar(32) ('fund_report'), mode varchar(16) ('now'|'test'|'scheduled'),
  ref_date date, title varchar(100), body varchar(500),
  status varchar(16) ('scheduled'|'sending'|'done'|'failed'|'cancelled'),
  scheduled_at timestamptz null, started_at, finished_at null,
  target_count int default 0, success_count int default 0, failure_count int default 0,
  template_id FK push_templates null ON DELETE SET NULL, created_by FK users, created_at
  INDEX (status, scheduled_at), INDEX (kind, ref_date)
```
시드: 기본 템플릿 1개 — 제목 `수익률 리포트 업데이트`, 본문 `{date} 수익률 리포트가 올라왔어요`.
`{date}` 는 `ref_date` 를 `M월 D일` 로 치환(서버에서, 발송 직전).

## 4. API (blog 서비스, Router → Service → Repository)
| 메서드·경로 | 권한 | 내용 |
|---|---|---|
| `PUT /api/v1/push-devices` `{token, platform, fund_notice}` | 로그인 | token 기준 upsert(다른 사용자 토큰이면 소유자 교체) |
| `DELETE /api/v1/push-devices/{token}` | 로그인 | 본인 토큰만 삭제(없으면 204) |
| `GET /api/v1/admin/fund-notices/preview?date=` | ADMIN | `{targetCount, myDeviceCount, alreadySent: bool, lastSend}` |
| `POST /api/v1/admin/fund-notices` `{date, title, body, mode, scheduled_at?, template_id?, force?}` | ADMIN | 아래 규칙 |
| `POST /api/v1/admin/push-sends/{id}/cancel` | ADMIN | `scheduled` 일 때만(조건부 UPDATE), 아니면 409 |
| `GET /api/v1/admin/push-sends?limit=&offset=` | ADMIN | 이력(최신 순) |
| `GET/POST/PUT/DELETE /api/v1/admin/push-templates` | ADMIN | 템플릿 관리 |

발송 규칙(`POST /admin/fund-notices`):
- 검증: 제목 1~100자, 본문 1~500자(공백만 불가), `date` 필수.
- `mode=now`: 같은 `ref_date` 의 `now|scheduled` 발송이 `done|sending|scheduled` 로 있으면 `force` 없이는 409(`already_sent`). 통과 시 `push_sends(status=sending)` 저장 → **SSE 발행** → Celery `send_fund_notice.delay(id)`.
- `mode=test`: 중복 검사 없음, SSE 없음. 대상 = 요청 관리자 본인의 `push_devices`(fund_notice 무관). 0대면 400(`no_device`).
- `mode=scheduled`: `scheduled_at` 이 지금+1분 이후여야 함. 중복 검사는 now 와 같음. `status=scheduled` 저장만.
- 템플릿을 썼으면 `push_templates.last_sent_at` 갱신(발송 시점).

## 5. 발송 (collector Celery)
- `collector.send_fund_notice(send_id)`: 행을 읽어 대상 토큰 조회(test=관리자 기기 / 그 외=`fund_notice=true`) → `target_count` 기록 → `ExpoPushSender.send_batch(tokens, message)` → 성공·실패 수, `DeviceNotRegistered` 토큰 삭제 → `status=done`(전부 실패면 `failed`), `finished_at`.
- 메시지는 기기마다 **2개**(같은 토큰 목록, 같은 100개 묶음 규칙):
  - 알림용: `{title, body, data: {type: 'fund_report', date}, channelId: 'fund-report', sound: 'default'}` — 사용자에게 보이는 알림.
  - 깨우기용(무음): `{data: {type: 'fund_refresh', date}, priority: 'high', contentAvailable: true}` — 제목·본문 없음(Android 데이터 전용 메시지, iOS `content-available`). 앱 백그라운드 태스크가 받아 갱신·기록(§7.1).
  - 알림 메시지가 백그라운드일 때 OS 가 표시만 하고 JS 를 깨우지 않을 수 있어 둘을 나눈다. 플랫폼별 수신 조건은 구현 첫 단계(§12-8)에서 Expo 문서로 확인하고 다르면 이 절을 고친다.
  - 이력의 성공·실패 수는 **알림용 기준**. 깨우기용 결과는 로그만 남기고, `DeviceNotRegistered` 토큰은 똑같이 삭제한다.
  - `mode=test` 도 2개 모두 보낸다(관리자 기기에서 백그라운드 기록까지 확인).
- `collector.dispatch_scheduled_pushes` — **beat 1분마다**: `status=scheduled AND scheduled_at <= now()` 를 `FOR UPDATE SKIP LOCKED` 로 집어 `status=sending, started_at` 으로 바꾸고 커밋 → 각 행마다 **SSE 발행**(sync Redis publish, 같은 채널·형식) → `send_fund_notice.delay(id)`.
- Celery `eta` 는 쓰지 않는다(Redis 브로커 visibility_timeout 중복 전달·취소 어려움).
- `ExpoPushSender`: `POST https://exp.host/--/api/v2/push/send`, 100개씩, 타임아웃 10초, `EXPO_ACCESS_TOKEN` 있으면 Bearer. 응답 tickets 의 `status=error` + `details.error=DeviceNotRegistered` 를 무효 토큰으로 돌려준다. 네트워크 오류 묶음은 실패로 센다(재시도 없음 — 관리자가 이력 보고 재발송). receipts 조회는 범위 밖.
- `PushSender` 에 기본 구현이 있는 `send_batch(tokens, message) -> BatchResult(success, failure, invalid_tokens)` 추가(기존 `send_multicast` 그대로).

SSE 이벤트: `{"type": "fund_report_updated", "date": "YYYY-MM-DD"}` — 제목·본문·개인정보 없음.

## 6. admin_web — `/fund-notices` (사이드바 "펀드 리포트 알림")
- **작성 카드**: 기준일(기본 오늘) · 템플릿 선택 → `{date}` 치환된 제목·본문 채움(수정 가능, 글자 수 표시) · 폰 알림 미리보기 · "대상 기기 N대 · 오늘 이미 보냄(시각)" 표시.
- 버튼: [테스트 발송](내 기기 N대, 0대면 비활성) · [지금 발송](이미 보냈으면 확인 모달 → force) · [예약 발송](날짜·시각 입력, 과거 불가).
- **발송 이력 표**: 기준일·제목·종류(테스트/즉시/예약)·상태·대상·성공/실패·보낸 사람·시각(예약은 예약 시각). `scheduled` 행에 [취소]. 발송 중 행이 있으면 5초마다 새로고침.
- **템플릿 관리**: 같은 화면 하단 탭 — 목록·추가·수정·삭제(제목·본문, `{date}` 사용 안내).
- api: `src/api/fundNotices.ts`, `src/api/pushTemplates.ts`(기존 client 패턴), TS.

## 7. 모바일 (mobile)
- 의존성: `expo-notifications`(config plugin, 새 dev build), `react-native-sse`(순수 JS).
- `app.config.js`: `extra.eas.projectId`(env `EAS_PROJECT_ID`), `android.googleServicesFile`(env `GOOGLE_SERVICES_JSON`, 없으면 생략), `expo-notifications` 플러그인. projectId 가 없으면 푸시 기능 꺼짐(`isPushConfigured()`).
- `features/push/`
  - `permission.ts`: 펀드 **첫 등록** 직후 앱 안내 시트("리포트가 올라오면 알려드릴까요?") → [알림 받기] 일 때만 OS 권한 요청. 결과를 SecureStore `push_prompt_v1` 에 기록(다시 묻지 않음).
  - `registration.ts`: `syncPushRegistration()` — 로그인 + 펀드 ≥1 + 권한 허용 + 설정됨 → `getExpoPushTokenAsync({projectId})` → `PUT /push-devices`. 펀드 0개·로그아웃 → `DELETE`. 마지막 등록 토큰은 SecureStore 에 두고 바뀌었을 때만 PUT. 실패는 조용히(다음 시점에 재시도). 호출 시점: 앱 실행, 펀드 추가·삭제, 로그인 직후, 로그아웃 직전.
  - `handlers.ts`: Android 채널 `fund-report`(이름 "펀드 리포트"). 포그라운드 수신은 배너 표시 안 함(`shouldShowBanner:false`). 탭 → `data.type==='fund_report'` 이면 `router.push('/fund')` + `fundRefresher.run({ force: true })`. 콜드 스타트는 `getLastNotificationResponseAsync`.
  - 권한 거부 상태면 펀드 목록 상단에 "알림이 꺼져 있어요 · 설정 열기"(닫기 가능, 닫음 기억).
- `features/fund/fund-signal.ts` SSE: 로그인 + 펀드 있음 + `AppState=active` 일 때만 `EXPO_PUBLIC_BLOG_API_URL/api/v1/notifications/stream` 연결, 백그라운드면 닫음. `fund_report_updated` → 0~30초 무작위 지연 후 `fundRefresher.run({ force: true })`.

### 7.1 백그라운드 기록 — `features/fund/background/`
- 의존성 추가: `expo-background-task`, `expo-task-manager`(config plugin, 같은 새 dev build). `expo-notifications` 는 위와 공유.
- `run-core.ts`: `backgroundRecordWith(reason: 'push' | 'periodic', deps)` — 두 태스크가 공유하는 본문(`tasks.ts` 가 실제 의존성을 넣은 `backgroundRecord`).
  1. `useAuthStore.getState().hydrate()` 대기 → 로그아웃이면 종료(화면 없이 실행돼 저장소가 아직 안 읽혔을 수 있음).
  2. (push 만) 0~10초 무작위 대기 — 한 번에 깨어난 기기들이 원본을 동시에 치지 않게. 그다음 `fundRefresher.run({ force: reason === 'push' })` — 1단계 자동 갱신과 **같은 함수**(10분 건너뛰기·동시 2개·single-flight·지운 펀드 처리 그대로). 정기 작업은 force 없이(10분 이내 확인한 펀드는 건너뜀).
  3. 실행 시간 한도(iOS 약 30초)를 넘기지 않게 전체를 25초 타임아웃으로 감싼다. 시간이 다 되면 그때까지 기록한 것만 남긴다.
- **백업은 백그라운드에서 하지 않는다**(구글 토큰 갱신이 화면 없이 실패할 수 있고 시간이 짧다).
  - `background-mode.ts`: 백그라운드 실행 중 플래그. `auto-refresh.ts` 의 실행 끝 구독은 이 플래그가 켜져 있으면 `maybeAutoBackup()` 대신 보류 파일 `Paths.document/fund-backup-pending.json` 만 쓴다(SecureStore 는 iOS 잠금 중 못 읽을 수 있어 파일).
  - 플래그는 25초 타임아웃 시점이 아니라 **`fundRefresher.run()` 프라미스가 실제로 끝났을 때** 끈다(타임아웃 뒤 늦게 끝난 실행이 백그라운드에서 백업을 부르지 않게).
  - 앱이 다시 `active` 가 되면(`useFundAutoRefresh` 의 기존 복귀 처리) 이 값이 있으면 `maybeAutoBackup()` → 시도 후 지운다(하루 1회 규칙은 `maybeAutoBackup` 그대로).
  - 보류 표시를 메모리가 아니라 파일에 두는 이유: Android 는 앱이 종료된 상태에서 태스크만 따로 실행될 수 있어 다음 실행과 메모리를 공유하지 않는다.
- `tasks.ts`(push): `TaskManager.defineTask('fund-refresh-push', …)` + `Notifications.registerTaskAsync` — 푸시가 설정됐으면 모듈 최상위에서 항상 등록(Expo 문서 요구, 서버가 펀드 등록 기기에만 보내므로 결과는 같음). 받은 데이터가 `type==='fund_refresh'` 일 때만 `backgroundRecord('push')`. 다른 type 은 무시.
  - 태스크가 받는 payload 모양은 Expo 문서에 정의가 없다(2026-10-21 확인) → `push-payload.ts` 의 방어적 파서 `pushTypeOf(payload)` 가 `data.data`(객체), `data.data.body`·`data.body`(JSON 문자열), `data.dataString` 을 모두 본다. 실제 Android payload 모양은 **미확인(푸시 설정 후 확인)** — 확인되면 로그로 남겨 여기에 적는다.
- config 플러그인: `expo-notifications` 를 `['expo-notifications', { enableBackgroundRemoteNotifications: true }]` 로, `expo-background-task` 추가(iOS `UIBackgroundModes: processing` 을 플러그인이 넣는지 prebuild 결과로 확인).
- Expo 문서 확인(2026-10-21): 앱 코드를 깨우는 push 는 제목·본문 없이 `data` 만 + iOS `contentAvailable: true`. 태스크는 앱이 일찍 읽는 모듈 최상위에서 정의·등록. 사용자가 앱을 강제 종료하면 정기 작업은 멈췄다가 다음 실행 때 재개.
- `tasks.ts`(정기): `TaskManager.defineTask('fund-refresh-periodic', …)` → `backgroundRecord('periodic')`. 최소 간격 6시간(`minimumInterval: 360`) — 실제 시각은 OS 가 정한다.
- 태스크 정의(`defineTask`)는 **컴포넌트가 아닌 모듈 최상위**에서 해야 한다(화면 없이 깨어날 때도 등록돼 있어야 함) → `background/tasks.ts` 를 앱 엔트리 `mobile/index.ts` 에서 import(라우트 `_layout` 은 화면 없이 깨어날 때 평가되지 않을 수 있음).
- 등록·해제 `syncBackgroundTasks()`(판단은 `periodic-core.ts`): 로그인 + 펀드 ≥1 이면 정기 작업 등록, 아니면 해제. 호출 시점은 `syncPushRegistration()` 과 같다(앱 실행, 펀드 추가·삭제, 로그인 직후, 로그아웃 직전).
  - 정기 작업은 **푸시 설정·권한과 무관**하게 등록(푸시를 거부해도 안전망은 동작). push 태스크는 푸시가 설정된 경우만.
- 포그라운드에서 깨우기용 push 가 오면: SSE 가 이미 같은 일을 하므로 무시(중복 갱신 방지). `fund_report_updated` SSE 와 겹쳐도 single-flight 라 한 번만 실행된다.

#### 실기기 관찰 (2026-10-21, Android)
갤럭시 A53, 개발 앱(`com.stockapp.dev`) 재빌드 후 확인.
1. 로그인 + 펀드 1개 이상이면 `[fund-bg] periodic sync registered` 가 찍히고, `adb shell dumpsys jobscheduler` 에 `com.stockapp.dev/androidx.work.impl.background.systemjob.SystemJobService` 작업이 생긴다(WorkManager). 조건이 안 되면 `unchanged` 이고 작업이 없다.
2. 앱을 홈으로 보낸 뒤 `adb shell cmd jobscheduler run -f com.stockapp.dev <작업번호>` 로 강제 실행하면 `[fund-bg] periodic start` 가 찍힌다. **OS 가 백그라운드에서 JS 를 깨우는 것이 확인됐다.**
3. 함정 1 — 직전 10분 안에 받은 펀드는 다시 받지 않는다(`AUTO_REFRESH_MIN_AGE_MS`, `core/refresh-all.ts`). 펀드를 추가한 직후 강제 실행하면 갱신이 일어나지 않는 것이 정상이다. 기록 파일 수정 시각으로 구분한다: `adb shell "run-as com.stockapp.dev stat -c '%y %n' files/fund-history-*.json"`
4. 함정 2 — 첫 실행 뒤에는 WorkManager 가 주기(약 6시간)를 직접 관리한다. 주기 안에서 jobscheduler 로 강제 실행해도 무시되어 JS 가 깨어나지 않고, 작업 번호도 실행할 때마다 바뀐다(0 → 1). `dumpsys` 의 `Minimum latency` 로 다음 실행까지 남은 시간을 본다. 다시 강제 실행하려면 등록을 새로 해야 한다 — 펀드를 모두 지웠다가 다시 추가하거나, 로그아웃 후 다시 로그인한다. 이때도 함정 1 때문에 10분 넘게 기다려야 갱신이 일어난다.
5. **아직 확인하지 못한 것**: 백그라운드 갱신이 히스토리에 실제로 기록되는지, 무음 push(`fund_refresh`) 수신과 payload 모양(미확인, 푸시 설정 후 확인). 푸시 설정(EAS projectId, FCM V1 키)이 아직 없어 푸시 기능이 꺼져 있다.

### 7.2 빈 날 표시 — core `history-view.ts`
- 메우지 않는다(앞뒤 값으로 보간하면 실제와 다른 수익률이 생긴다).
- `HistoryRowView` 에 `gapFrom: string | null` 추가: 바로 이전 기록 날짜가 "직전 평일"(토·일 건너뜀)보다 앞이면 그 날짜(`M.D`), 아니면 null. 공휴일은 판단하지 않는다(공휴일 다음 날에도 표시될 수 있음 — 무해).
- 화면(앱 `history/[id]` 의 WebView 페이지, 웹은 히스토리 없음)은 `gapFrom` 이 있으면 **날짜 옆**에 작은 글씨로 "이전 기록 M.D" — 그 사이 날짜가 빠졌다는 표시. 값(당일·월 손익)은 원본 리포트에 적힌 그대로라 손대지 않는다.
- core 변경이므로 `scripts/check-fund-core-sync.sh --write` 로 web_client 에도 복사(타입만 늘어남, 웹 화면 영향 없음).

## 8. 웹 (web_client)
- `NotificationToaster` 의 같은 EventSource 에 `fund_report_updated` 처리 추가: 로그인 + 펀드 있음이면 0~30초 무작위 지연 후 자동 갱신(force) + 토스트 "오늘 수익률 리포트가 올라왔어요". 이 type 은 기존 "새 알림이 도착했습니다" 토스트를 띄우지 않는다. `new_post` 처리는 그대로.

## 9. 오류 처리
| 상황 | 처리 |
|---|---|
| 권한 거부·시뮬레이터·projectId 없음 | 푸시만 꺼짐(자동 갱신·SSE 정상) |
| 토큰 등록·해제 실패 | 조용히, 다음 시점 재시도. 남은 토큰은 발송 시 DeviceNotRegistered 로 정리 |
| SSE 끊김 | 라이브러리 자동 재연결, 백그라운드에선 연결 안 함 |
| Expo 일부·전체 실패 | 이력에 실패 수 / `failed`. 자동 재시도 없음 |
| 같은 날 재발송 | 409 → 확인 모달 → force |
| 예약 취소와 발송 경쟁 | 조건부 UPDATE(`WHERE status='scheduled'`) — 진 쪽이 409/무시 |
| 워커 중단 중 예약 시각 지남 | 재기동 후 다음 beat 에서 발송(지연 발송) |
| `PUSH_BACKEND=mock` | 로그만(로컬 기본) |
| 백그라운드 태스크가 실행 안 됨(iOS 강제 종료·저전력, Android 제조사 절전) | 그날은 빈 날로 남고 다음 실행·복귀 때 그날 값만 기록. 히스토리에 "이전 기록 M.D" |
| 백그라운드 실행 시간 초과 | 25초에서 중단, 그때까지 기록한 펀드만 남김(다음 실행에서 나머지) |
| 백그라운드에서 새 기록 생김 | 백업 보류(`fund_backup_pending_v1`) → 다음 앱 복귀 때 `maybeAutoBackup` |
| 백그라운드 중 로그아웃 상태 | 아무것도 안 함(로그아웃 직전에 태스크 해제) |
| iOS 잠금 중 백그라운드 실행 | SecureStore(펀드 목록·로그인)를 잠금 해제 전엔 못 읽을 수 있어 기록 못 함 — 알려진 한계(iOS 실발송은 범위 밖) |

## 10. 테스트
- pytest(일회용 PG + Redis DB 5): 토큰 upsert·소유자 교체·본인만 삭제, ADMIN 아닌 사용자 403, 문구 검증, now 중복 409·force, test 대상=관리자 기기·SSE 없음·0대 400, scheduled 과거 거부, `dispatch_scheduled_pushes` SKIP LOCKED 로 두 번 안 집음, 취소 경쟁, `send_fund_notice` 집계·무효 토큰 삭제, `ExpoPushSender`(httpx 모킹: 100개 분할·Bearer·DeviceNotRegistered·네트워크 오류), `{date}` 치환, SSE 이벤트 형식.
- pytest 추가: `send_fund_notice` 가 기기마다 알림용·깨우기용 2개를 보냄, 깨우기용에 제목·본문 없음·`contentAvailable`, 이력 수치는 알림용 기준.
- 모바일 jest: `registration`(조건별 PUT/DELETE·토큰 같으면 생략), `handlers`(탭 → 이동+force), `fund-signal`(active 일 때만 연결·지연 후 갱신).
- 모바일 jest 추가: `backgroundRecord`(로그아웃이면 아무것도 안 함, push=force·periodic=force 없음, 25초 타임아웃), 백그라운드 중 새 기록 → 백업 대신 보류 플래그, 복귀 시 보류면 `maybeAutoBackup` 후 지움, push 태스크가 `fund_refresh` 외 type 무시, `syncBackgroundTasks` 조건별 등록·해제(푸시 거부여도 정기 작업 등록).
- core jest: `gapFrom`(연속 평일 null, 주말 건너뜀 null, 평일 빠짐이면 이전 날짜, 첫 행 null).
- admin_web·web_client: tsc·lint. 실제 푸시·SSE 는 Firebase 설정 후 dev build 수동 확인.
- 백그라운드 수동 확인(Android dev build): 앱을 스와이프로 종료 → admin_web 테스트 발송 → 앱을 열지 않고 adb 로그로 태스크 실행 확인 → 앱 열어 히스토리에 오늘 기록. 정기 작업은 `adb shell cmd jobscheduler run -f <패키지> <jobId>` 로 강제 실행(정확한 명령은 Expo 문서 기준으로 README 에 적는다).

## 11. 사용자 준비 작업
1. Firebase 프로젝트 → Android 앱 `com.stockapp.dev`·`com.stockapp` 추가 → `google-services.json`(커밋 금지, 경로를 `GOOGLE_SERVICES_JSON` 으로)
2. `eas init` 으로 projectId 연결(`EAS_PROJECT_ID`), FCM V1 서비스 계정 키를 `eas credentials` 로 업로드
3. 서버 `PUSH_BACKEND=expo`, (선택) `EXPO_ACCESS_TOKEN` — Expo 계정 설정에서 "Enhanced push security" 켤 때 필요
4. 새 dev build(`expo-notifications`·`expo-background-task`·`expo-task-manager` 포함). 백그라운드 확인 때는 기기 설정에서 이 앱의 배터리 최적화를 "제한 없음"으로 두면 결과가 안정적이다(사용자에게 강제하지 않음).
비용: Expo Push·FCM·EAS 연결 무료(로컬 빌드 무료). iOS 실발송만 Apple Developer 가입 필요.
README 에 같은 절차와 환경변수를 적는다.

## 12. 구현 순서
계획: 1~8·11(README) = `plans/2026-10-21-fund-report-notice.md`(9개 작업) → 9~10(빈 날 표시·백그라운드 기록·서버 깨우기용 메시지) = `plans/2026-10-21-fund-background-record.md`(보충, 기존 계획 작업 3·8 이후 실행).
1. 마이그레이션 + 모델 + `push_devices` API
2. `ExpoPushSender` + `send_batch`
3. 관리자 API(preview·발송·이력·취소·템플릿) + `send_fund_notice` + SSE 발행
4. 예약 beat 태스크
5. admin_web 화면
6. 웹 SSE 처리
7. 모바일 SSE(`fund-signal`) — 푸시 설정 없이도 동작
8. 모바일 푸시(권한·등록·핸들러·채널·config) — 시작 전에 무음 push 수신 조건(Android 데이터 전용·iOS content-available·앱 종료 상태)을 Expo 문서로 확인
9. 빈 날 표시(core `gapFrom` + 히스토리 화면) — 푸시 설정 없이도 동작
10. 백그라운드 기록: 정기 작업 + 백업 보류(푸시 없이도 동작) → push 태스크 + 서버 깨우기용 메시지
11. README · ROADMAP(실 FCM 항목 갱신, 백그라운드 수동 확인 절차)
