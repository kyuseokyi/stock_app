# 푸시 알림 설정 가이드 (모바일 · Expo Push · FCM)

모바일 앱에 실제 푸시 알림을 보내기 위해 **계정·키를 준비하고 연결하는 순서**를 정리한다.
설계(무엇을 언제 보내는지)는 [`superpowers/specs/2026-10-19-fund-report-notice-design.md`](superpowers/specs/2026-10-19-fund-report-notice-design.md),
앱 빌드 방법은 [`local_build_guide.md`](local_build_guide.md) 를 본다.

---

## 0. 지금 상태 (2026-10-21 기준)

| 항목 | 상태 | 비고 |
|---|---|---|
| 서버 발송 구조 `backend/apps/collector/push/` | ✅ | `expo`(Expo Push) 발송기 추가 — `PUSH_BACKEND=expo` 로 실발송 |
| 서버 설정 `PUSH_BACKEND` | `mock` | `backend/.env.example` 기본값. 실제 발송 안 함 |
| 앱 패키지 `expo-notifications` | ✅ 설치 | 새 dev build 필요 |
| 앱 설정 `app.config.js` | ✅ 연결 | env `EAS_PROJECT_ID`·`GOOGLE_SERVICES_JSON` 으로 주입 |
| 키 파일 git 제외 규칙 | ✅ 있음 | 루트 `.gitignore`(`**/secrets/`, `google-services*.json` 등) — 2026-10-20 추가 |
| `google-services.json` | ✅ 준비됨 | `mobile/secrets/google-services.json` — **한 파일에 `com.stockapp.dev`·`com.stockapp` 두 앱 포함** |

👉 **이 문서의 1~4장(계정·키 준비)은 지금 바로 할 수 있다.** 구현은 끝났다(2026-10-21). 3장까지 마치면 5~7장으로 연결·확인한다.

---

## 1. 전체 구조 — 누가 누구에게 보내나

```
우리 서버(Celery 워커)
   │  POST https://exp.host/--/api/v2/push/send   (기기 토큰 = ExponentPushToken[...])
   ▼
Expo Push 서비스 (무료)
   ├─ Android → FCM(Firebase Cloud Messaging) → 휴대폰
   └─ iOS     → APNs(애플)                     → 아이폰   ※ iOS 출시 때
```

- 서버는 **FCM 을 직접 부르지 않는다.** Expo Push 에 보내면 Expo 가 플랫폼별로 전달한다 → 서버 코드 하나로 두 플랫폼.
- 그래서 **FCM 키는 서버가 아니라 EAS(Expo 계정)에 올린다**(3장). 처음에 가장 헷갈리는 부분.
- 앱은 실행 시 Expo 에서 **기기 토큰**(`ExponentPushToken[...]`)을 받아 우리 서버에 등록하고, 서버는 그 토큰으로 보낸다.

---

## 2. Firebase 준비 (Android 푸시용)

### 2-1. 프로젝트와 앱 등록
1. <https://console.firebase.google.com> → **프로젝트 추가** → 이름(예: `stockapp`) → Google 애널리틱스는 꺼도 된다.
2. 프로젝트 화면에서 **Android 앱 추가**(안드로이드 아이콘)를 **두 번** 한다 — 개발용·운영용 패키지가 다르기 때문:
   | 앱 | Android 패키지 이름 |
   |---|---|
   | 개발용 (StockApp Dev) | `com.stockapp.dev` |
   | 운영용 (StockApp) | `com.stockapp` |
   - 앱 닉네임은 자유, SHA-1 은 푸시에는 필요 없다(비워 둠).
3. 두 앱을 다 등록한 뒤 **프로젝트 설정 → 일반 → 내 앱**에서 `google-services.json` 을 내려받는다.
   - 두 앱을 모두 등록한 **뒤에** 받은 파일 하나에 두 패키지 정보가 함께 들어 있다(먼저 받았다면 다시 받기).
   - **이 파일 하나로 개발용·운영용 빌드를 모두 처리한다.** 안드로이드 빌드가 앱 패키지(`applicationId`)와 같은 항목을 골라 쓴다.
     해당 패키지가 파일에 없으면 빌드 중 `No matching client found for package name` 오류가 난다.
   - 받은 뒤 두 패키지가 다 들어 있는지 확인(키 값은 보지 않고 이름만):
     `grep -o '"package_name": *"[^"]*"' mobile/secrets/google-services.json | sort -u`
   - Downloads 에 같은 이름 파일이 여러 개 쌓이기 쉽다(`google-services (1).json`…). 다른 프로젝트 파일과 섞이지 않게 위 명령으로 패키지를 꼭 확인할 것.

### 2-2. FCM V1 서비스 계정 키 (Expo 가 FCM 으로 보낼 때 쓰는 키)
1. **프로젝트 설정 → 서비스 계정** 탭 → **새 비공개 키 생성** → JSON 파일이 내려받아진다.
2. 이 파일은 **비밀 키**다. 채팅·메일·저장소에 올리지 말 것. 3장에서 EAS 에 올린 뒤에는 안전한 곳에 보관만 한다.
3. **Cloud Messaging** 탭에서 "Firebase Cloud Messaging API(V1)" 가 **사용 설정됨**인지 확인한다(옛 "서버 키" 방식은 쓰지 않는다).

---

## 3. EAS(Expo) 연결

```bash
npm install -g eas-cli        # 또는 매번 npx eas-cli
eas login                     # Expo 계정(없으면 https://expo.dev 에서 무료 가입)
cd mobile
eas init                      # 이 앱을 Expo 프로젝트에 연결 → projectId(UUID) 가 출력·생성된다
```
- 나온 **projectId** 를 기록해 둔다 → 앱 설정의 `EAS_PROJECT_ID`(5장). 기기 토큰을 받을 때 꼭 필요하다.
- `eas init` 이 `app.json`/`app.config.js` 를 고치겠다고 물으면, 이 프로젝트는 `app.config.js` 가 env 로 값을 읽는 구조이므로
  **직접 고치지 말고** 값만 기록한 뒤 5장 방식(env)으로 넣는다.

### FCM 키 업로드
```bash
cd mobile
eas credentials
```
메뉴(버전에 따라 문구가 조금 다를 수 있음):
1. 플랫폼 **Android** → 빌드 프로필 선택(`development` 로 시작, 운영용은 `production` 에서 한 번 더)
2. **Google Service Account** →
   **Manage your Google Service Account Key for Push Notifications (FCM V1)** →
   **Set up / Upload a new service account key**
3. 2-2 에서 받은 JSON 파일 경로를 입력 → 완료.
- 패키지(`com.stockapp.dev` / `com.stockapp`)마다 자격 증명이 따로라서 **두 패키지 모두** 올려야 개발용·운영용 앱 둘 다 받는다.

---

## 4. 키 파일 보관 규칙 (git 에 절대 올리지 않기)

루트 `.gitignore` 에 아래 규칙이 들어 있다(2026-10-20 추가). 새 키 파일 형식이 생기면 여기에 보탠다:
```gitignore
# 푸시 알림 키(Firebase·FCM 서비스 계정)
**/secrets/
google-services*.json
GoogleService-Info*.plist
*service-account*.json
*firebase-adminsdk*.json
```
확인: `git check-ignore -v mobile/secrets/google-services.json` → `.gitignore:…:**/secrets/` 가 나오면 제외되고 있는 것.
보관 위치(권장):
| 파일 | 어디에 | 비고 |
|---|---|---|
| `google-services.json` | 맥 `mobile/secrets/google-services.json` | 앱 빌드 때만 필요. 경로를 env `GOOGLE_SERVICES_JSON` 으로 넘김 |
| FCM 서비스 계정 JSON | EAS 에 업로드 후 맥의 안전한 폴더(저장소 밖) | 서버에는 **필요 없음**(Expo 방식) |
| `EXPO_ACCESS_TOKEN`(선택) | 서버 `/opt/stock_app/env/.env.production` | 6장 |

확인: `git status` 에 키 파일이 보이면 안 된다. 실수로 커밋했다면 즉시 Firebase 에서 **키를 폐기·재발급**한다(이력에서 지우는 것만으로는 부족).

---

## 5. 앱 설정 연결

`mobile/.env.development`·`mobile/.env.production`(직접 편집) 또는 빌드 셸 env 에:
```bash
EAS_PROJECT_ID=<3장의 projectId>
GOOGLE_SERVICES_JSON=./secrets/google-services.json
```
`app.config.js` 가 `extra.eas.projectId`(← `EAS_PROJECT_ID`), `android.googleServicesFile`(← `GOOGLE_SERVICES_JSON`, 없으면 생략), `expo-notifications` 플러그인을 이미 반영한다(구현됨).
`projectId` 가 없으면 푸시만 꺼지고 나머지 기능은 정상(`isPushConfigured()`).

**네이티브가 바뀌므로 앱을 다시 빌드해야 한다** — [`local_build_guide.md` 2-1](local_build_guide.md):
```bash
cd mobile
APP_ENV=development npx expo run:android --port 8082
```

---

## 6. 서버 설정

서버 `/opt/stock_app/env/.env.production`(워크플로가 `backend/.env.production` 으로 복사):
```bash
PUSH_BACKEND=expo            # mock(기본, 로그만) → expo(실발송)
# EXPO_ACCESS_TOKEN=...      # 선택 — Expo 계정에서 "Enhanced push security" 를 켰을 때만 필요
```
- `EXPO_ACCESS_TOKEN`: <https://expo.dev> → 계정 설정 → **Access tokens** 에서 발급. 켜 두면 토큰 없는 발송 요청을 Expo 가 거절한다(남이 우리 앱 토큰으로 보내는 것 차단).
- 바꾼 뒤 백엔드 재배포(또는 `celery_worker` 재시작)가 있어야 반영된다.
- 로컬 개발은 `PUSH_BACKEND=mock` 그대로 둔다(실제 기기로 안 나감).

---

## 7. 동작 확인

1. **기기 토큰 확인**: 새로 빌드한 앱에서 로그인·알림 허용 → 앱이 서버에 토큰을 등록한다
   (구현 후 관리자 화면 또는 DB `push_devices` 에서 `ExponentPushToken[...]` 확인).
2. **Expo 도구로 단독 발송**(서버 없이 키·앱만 확인): <https://expo.dev/notifications> 에 토큰·제목·내용을 넣고 보내기.
   또는:
   ```bash
   curl -H "Content-Type: application/json" -X POST https://exp.host/--/api/v2/push/send \
     -d '{"to":"ExponentPushToken[...]","title":"테스트","body":"푸시 설정 확인"}'
   ```
   응답 `"status":"ok"` + 휴대폰에 알림이 오면 Firebase·EAS 설정은 끝.
3. **서버 발송 확인**: 관리자 화면의 **테스트 발송**(관리자 기기에만) → 이력에 성공 수 확인.

---

## 8. 비용·iOS

- Expo Push, FCM, EAS 자격 증명 연결, 로컬 빌드: **무료**.
- iOS 실발송은 **Apple Developer Program(연 $99)** 가입 후 APNs 키를 `eas credentials` → iOS → Push Key 로 올린다 — 애플 로그인과 함께 iOS 출시 시점에 진행.

---

## 8-1. 앱을 열지 않은 날의 기록(백그라운드) — 현재 상태

- 서버는 알림 메시지 뒤에 제목·본문 없는 깨우기용 무음 메시지(`data.type = fund_refresh`, Android `priority: high`, iOS `contentAvailable`)를 한 번 더 보낸다. 이 메시지는 발송 이력 수치(성공·실패 수)에 넣지 않고, 만료 토큰 정리에만 반영한다. 서버 쪽은 구현됨.
- 앱 쪽은 순수 로직(payload 해석·25초 한도·정기 작업 판단·백업 보류)까지만 구현돼 있다. **백그라운드 태스크 정의와 6시간 안팎 정기 작업 등록은 아직 구현 전**이며(`expo-background-task`·`expo-task-manager` 설치와 `app.config.js` 플러그인 설정 필요), 패키지 설치·재빌드 이후에야 동작한다. 실기기에서 확인한 결과는 아직 없다.
- 그 전까지 앱이 꺼져 있으면 깨우기용 메시지는 무시되고, 앱을 열 때(실행·복귀) 일반 자동 갱신이 기록한다.

---

## 9. 자주 겪는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| 앱이 토큰을 못 받음(`projectId` 오류) | `EAS_PROJECT_ID` 미설정 | 3장 `eas init` 값 → 5장 env → 재빌드 |
| Expo 응답 `InvalidCredentials` | 해당 패키지에 FCM V1 키 미업로드 | 3장, `com.stockapp.dev`·`com.stockapp` 각각 |
| 응답 `DeviceNotRegistered` | 앱 삭제·재설치로 토큰 만료 | 정상 — 서버가 그 토큰을 지운다. 앱 재실행 시 새 토큰 등록 |
| 알림이 안 뜸(응답은 ok) | 휴대폰에서 알림 권한 꺼짐 / 배터리 최적화 | 설정 → 앱 → 알림 허용 |
| 앱이 켜지자마자 빨간 화면 `... could not be found` | 알림 모듈 추가 후 재빌드 안 함 | 5장 재빌드 |
| 서버가 보내도 아무 일 없음 | `PUSH_BACKEND=mock` | 6장 `expo` 로 바꾸고 재배포 |

---

## 10. 체크리스트

- [x] 루트 `.gitignore` 에 키 파일 규칙 추가(4장) — 2026-10-20
- [x] Firebase 프로젝트 생성, Android 앱 `com.stockapp.dev`·`com.stockapp` 등록(2-1)
- [x] `google-services.json`(두 앱 포함) → `mobile/secrets/google-services.json` 보관(2-1, 4장) — 2026-10-20
- [ ] FCM V1 서비스 계정 키 발급(2-2)
- [ ] `eas login` → `eas init` → projectId 기록(3장)
- [ ] `eas credentials` 로 두 패키지에 FCM V1 키 업로드(3장)
- [ ] 앱 env `EAS_PROJECT_ID`·`GOOGLE_SERVICES_JSON` → 재빌드(5장)
- [ ] 서버 `PUSH_BACKEND=expo` → 재배포(6장)
- [ ] Expo 도구로 단독 발송 확인 → 관리자 테스트 발송 확인(7장)
