# 펀드 리포트 알림 설계 — 관리자 발송 · 푸시 · SSE (2026-10-19)

선행: [펀드 리포트 자동 갱신](2026-10-19-fund-auto-refresh-design.md)(`runAutoRefresh({ force: true })` 사용).
범위: backend(blog 8000 + collector Celery) · admin_web · mobile · web_client.

## 1. 목표
- 관리자가 admin_web 에서 "오늘 수익률 리포트 업데이트"를 **명시적으로** 알린다.
- **푸시**(모바일): 사용자에게 **알리기** 위한 것. 데이터는 싣지 않는다(탭하면 앱이 열리고 자동 갱신이 가져옴).
- **SSE**(웹·앱이 열려 있을 때): 데이터 **갱신 신호**. 받으면 각 기기가 자기 URL 을 다시 가져온다.
- 서버는 계속 펀드 URL 을 모른다. 아는 것은 "이 기기가 펀드 알림을 원한다"뿐.
- 관리자 기능: 문구 수정, 즉시·테스트·예약 발송, 발송 이력, 문구 템플릿 관리.

범위 밖: iOS 실발송 확인(APNs 키는 iOS 출시 때 — Apple Developer 연 $99), 펀드별 개별 알림, 웹 푸시(Web Push API), 새 글 알림의 `push_devices` 이전.

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
- 메시지: `{title, body, data: {type: 'fund_report', date}, channelId: 'fund-report', sound: 'default'}`.
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
  - `handlers.ts`: Android 채널 `fund-report`(이름 "펀드 리포트"). 포그라운드 수신은 배너 표시 안 함(`shouldShowBanner:false`). 탭 → `data.type==='fund_report'` 이면 `router.push('/fund')` + `runAutoRefresh({force:true})`. 콜드 스타트는 `getLastNotificationResponseAsync`.
  - 권한 거부 상태면 펀드 목록 상단에 "알림이 꺼져 있어요 · 설정 열기"(닫기 가능, 닫음 기억).
- `features/fund/fund-signal.ts` SSE: 로그인 + 펀드 있음 + `AppState=active` 일 때만 `EXPO_PUBLIC_BLOG_API_URL/api/v1/notifications/stream` 연결, 백그라운드면 닫음. `fund_report_updated` → 0~30초 무작위 지연 후 `runAutoRefresh({force:true})`.

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

## 10. 테스트
- pytest(일회용 PG + Redis DB 5): 토큰 upsert·소유자 교체·본인만 삭제, ADMIN 아닌 사용자 403, 문구 검증, now 중복 409·force, test 대상=관리자 기기·SSE 없음·0대 400, scheduled 과거 거부, `dispatch_scheduled_pushes` SKIP LOCKED 로 두 번 안 집음, 취소 경쟁, `send_fund_notice` 집계·무효 토큰 삭제, `ExpoPushSender`(httpx 모킹: 100개 분할·Bearer·DeviceNotRegistered·네트워크 오류), `{date}` 치환, SSE 이벤트 형식.
- 모바일 jest: `registration`(조건별 PUT/DELETE·토큰 같으면 생략), `handlers`(탭 → 이동+force), `fund-signal`(active 일 때만 연결·지연 후 갱신).
- admin_web·web_client: tsc·lint. 실제 푸시·SSE 는 Firebase 설정 후 dev build 수동 확인.

## 11. 사용자 준비 작업
1. Firebase 프로젝트 → Android 앱 `com.stockapp.dev`·`com.stockapp` 추가 → `google-services.json`(커밋 금지, 경로를 `GOOGLE_SERVICES_JSON` 으로)
2. `eas init` 으로 projectId 연결(`EAS_PROJECT_ID`), FCM V1 서비스 계정 키를 `eas credentials` 로 업로드
3. 서버 `PUSH_BACKEND=expo`, (선택) `EXPO_ACCESS_TOKEN` — Expo 계정 설정에서 "Enhanced push security" 켤 때 필요
4. 새 dev build
비용: Expo Push·FCM·EAS 연결 무료(로컬 빌드 무료). iOS 실발송만 Apple Developer 가입 필요.
README 에 같은 절차와 환경변수를 적는다.

## 12. 구현 순서
1. 마이그레이션 + 모델 + `push_devices` API
2. `ExpoPushSender` + `send_batch`
3. 관리자 API(preview·발송·이력·취소·템플릿) + `send_fund_notice` + SSE 발행
4. 예약 beat 태스크
5. admin_web 화면
6. 웹 SSE 처리
7. 모바일 SSE(`fund-signal`) — 푸시 설정 없이도 동작
8. 모바일 푸시(권한·등록·핸들러·채널·config)
9. README · ROADMAP(실 FCM 항목 갱신)
