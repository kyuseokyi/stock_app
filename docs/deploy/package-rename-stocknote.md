# 상용 패키지명 변경: `com.stockapp` → `com.stocknote` (2026-11-18)

> **진행 상태 (2026-11-19)**: B(K1~K7) **코드·문서 반영 완료**(브랜치 `feature/package-stocknote`, 권장안 D1~D5 기준). 남은 것은 **사용자 A 단계**(A1 Play 앱 생성, A2 Firebase·`google-services.json`·EAS FCM 키, A3~A5) — 특히 A2-1~3 전에는 `npm run build:android:preview` 가 새 검사에 걸려 멈춘다. 상용 DB 는 배포 때 마이그레이션 `e6f8a0b2c4d7` 이 android `store_url` 을 바꾼다(K6).

## 왜 바꾸나
Google Play 에서 `com.stockapp` 은 **이미 다른 개발자가 쓰는 패키지명**이라 앱을 만들 수 없다. `com.stocknote` 는 사용 가능으로 확인(사용자, 2026-11-18).
패키지명은 사용자 화면에 보이지 않는 **스토어 식별자**다. 앱 이름(FunNote)·아이콘·도메인은 그대로다.

> ⚠️ Play Console 에서 앱을 만들고 **첫 번째 빌드를 올린 뒤에는 패키지명을 영원히 바꿀 수 없다.** 아래 "결정할 것"을 먼저 정하고 앱을 만든다.

## 결정할 것 (권장안)
| # | 항목 | 권장 | 이유 |
|---|---|---|---|
| D1 | 상용 Android 패키지 | **`com.stocknote`** | Play 에서 사용 가능 확인 |
| D2 | 상용 iOS Bundle ID | **`com.stocknote`** (Android 와 같게) | 아직 Apple 에 등록 전 — 지금 맞추면 관리가 단순. Apple 도 전 세계 유일 ID 라 등록할 때 사용 가능 여부 다시 확인 |
| D3 | 개발 앱 패키지 `com.stockapp.dev` | **그대로 둔다** | 스토어에 올리지 않는 앱. 바꾸면 기기의 개발 앱을 지우고 다시 깔아야 하고(기기에 저장된 펀드 기록 삭제), Firebase·EAS·Google OAuth 개발 설정을 모두 다시 해야 함 |
| D4 | 딥링크 스킴 `stockapp://`·`stockapp-dev://` | **그대로 둔다** | 스토어에 등록하는 값이 아니고, 소셜 로그인 복귀 주소(`stockapp://auth`)가 백엔드·로그인 설정에 이미 들어가 있음 |
| D5 | EAS `slug: 'stockapp'`·EAS 프로젝트 | **그대로 둔다** | 패키지명과 무관한 Expo 프로젝트 식별자. 바꾸면 OTA·푸시 프로젝트가 새로 생김 |

아래는 **D1·D2 만 바꾸고 D3~D5 는 유지**하는 기준이다.

---

## A. 사용자가 직접 할 일 (체크리스트)

### A1. Google Play — 이름 확보 (지금)
- [ ] Play Console → **앱 만들기** → 앱 이름 `FunNote`, 패키지는 첫 번째 빌드(AAB) 업로드 때 `com.stocknote` 로 확정된다. 앱을 만들어 두는 것만으로 이름은 내 계정에 묶인다.

### A2. 푸시 알림 (FCM · EAS) — 코드 반영 전
1. [ ] **Firebase 콘솔** → 기존 프로젝트(개발·상용 앱이 들어 있는 곳) → 프로젝트 설정 → **앱 추가 → Android**
   - Android 패키지 이름: **`com.stocknote`**
   - 앱 닉네임: `FunNote`
   - SHA-1: 비워 둬도 된다(푸시만 쓰므로)
2. [ ] 등록 후 **`google-services.json` 다운로드** — 한 파일에 `com.stockapp.dev`·`com.stockapp`·`com.stocknote` 가 모두 들어 있다.
3. [ ] 내 PC 의 `mobile/secrets/google-services.json` 을 **새 파일로 교체**(git 에 안 올라가는 파일 — 나에게 보내지 말 것). EAS 빌드에 이 파일을 secret/env 로 등록해 두었다면(`GOOGLE_SERVICES_JSON`) EAS 쪽도 새 파일로 교체.
4. [ ] **EAS 에 FCM 키 업로드**(패키지마다 따로 필요)
   ```bash
   cd mobile
   npx eas credentials -p android
   # → production 프로필 선택 → 패키지 com.stocknote 확인
   # → Google Service Account → "Manage your Google Service Account Key for Push Notifications (FCM V1)"
   # → 기존에 com.stockapp 에 올린 것과 같은 서비스 계정 JSON 파일을 업로드
   ```
   - 서비스 계정 키 JSON 은 Firebase → 프로젝트 설정 → 서비스 계정 → 새 비공개 키(이미 받아 둔 파일이 있으면 그것을 재사용).
5. [ ] (코드 반영 뒤) 상용 테스트 APK 를 다시 빌드·설치해서 **로그인 → 알림 수신** 확인 — Claude 가 빌드·설치를 도울 수 있다.

### A3. 로그인 — 콘솔 확인
- [ ] **카카오 디벨로퍼스**(상용 앱) → 앱 설정 → **플랫폼 → Android**: `com.stockapp` 이 등록돼 있으면 `com.stocknote` 로 바꾼다. 등록돼 있지 않으면 할 일 없음.
  - 우리 앱은 카카오 SDK 가 아니라 **웹 리다이렉트** 방식(브라우저 로그인 → `stockapp://auth` 복귀)이라, Redirect URI(`https://auth.funnotedaily.com/.../kakao/callback`)는 **바꿀 필요 없다.**
- [ ] **네이버 개발자센터**(상용 앱) → API 설정 → 로그인 오픈 API 서비스 환경 → **Android**: 패키지 이름이 `com.stockapp` 이면 `com.stocknote` 로. 없으면 할 일 없음. Callback URL 은 그대로.
  - 네이버 **검수 신청 전**에 맞춰 두면 된다(검수 때 앱 정보가 함께 보임).
- [ ] **Google OAuth(Drive 백업, 상용)** — 아직 만들지 않았다면 처음부터 새 이름으로:
  - Google Cloud → API 및 서비스 → 사용자 인증 정보 → **OAuth 클라이언트 ID → Android**, 패키지 **`com.stocknote`**
  - SHA-1 은 **두 개**: ① EAS 업로드 키(`npx eas credentials -p android` 에서 확인) ② Play Console → 앱 무결성 → **앱 서명 키 SHA-1**(첫 업로드 뒤 생김) → 클라이언트 두 개 만들기
  - 이미 `com.stockapp` 으로 만들어 두었다면 그 클라이언트는 지우거나 남겨 두고, 새 클라이언트를 추가한다(웹 클라이언트 ID 는 그대로).
- [ ] **Apple(iOS 진행 때)**: App ID·App Store Connect 앱 `com.stocknote`, Sign in with Apple Services ID `com.stocknote.auth.service` 형태.

### A4. 서명 키 (첫 정식 빌드 때)
- [ ] 첫 `eas build --profile production` 때 `com.stocknote` 용 Android 키가 **새로 생성**된다 → Expo 대시보드 Credentials 에서 **키스토어 백업**(잃어버리면 앱 업데이트 불가). `com.stockapp` 용 옛 키는 Play 에 올린 적이 없으니 버려도 된다.

### A5. 나중에
- [ ] **AdMob**: 상용 앱을 `com.stocknote` 로 등록(광고 Phase 3 때)
- [ ] 기기에 깔린 옛 상용 테스트 앱(`com.stockapp`)은 별개 앱으로 남는다 → 지워도 된다(그 앱에 저장한 펀드가 있으면 먼저 Drive 백업).

---

## B. Claude 가 할 일 (코드·문서 — 커밋) — ✅ 2026-11-19 반영
| # | 파일 | 바꿀 것 |
|---|---|---|
| K1 | `mobile/app.config.js` | 상용 `android.package`·`ios.bundleIdentifier` → `com.stocknote` (개발 `com.stockapp.dev` 유지), 주석 |
| K2 | `mobile/src/lib/env-guard.ts` | `PROD_PACKAGE_ID = 'com.stocknote'` + 주석, `env-guard.test.ts` 기대값 |
| K3 | `mobile/scripts/build-preview-apk.sh` | `google-services.json`·prebuild 결과·APK 설정 검사 3곳의 `"com.stockapp"` → `"com.stocknote"`, 주석 |
| K4 | `mobile/src/features/app-update/*.test.ts` | 테스트 속 스토어 주소·패키지 문자열 |
| K5 | `backend/apps/blog/services/app_version.py` | 기본 `store_url` → `https://play.google.com/store/apps/details?id=com.stocknote`, `backend/tests/test_app_version.py` 기대값 |
| K6 | 상용 DB `app_version_configs` | 옛 마이그레이션(`f4a5b6c7d8e9`)이 넣은 android `store_url`(`com.stockapp`)을 **새 alembic 데이터 마이그레이션**으로 교체(옛 파일은 고치지 않음) → `e6f8a0b2c4d7`(주소가 옛 기본값과 정확히 같을 때만 교체, downgrade 역방향). 관리자 '앱 업데이트 관리' 화면에서 손으로 바꿔도 된다 |
| K7 | 문서 | `CLAUDE.md`, `README.md`, `PRODUCT.md`, `docs/deploy/{store-release,owner-todo,prod-release,environments}.md`, `docs/push_notification_setup.md`, `docs/social_login_guide.md`, `docs/ad_monetization_setup_guide.md`, `docs/local_build_guide.md`, `docs/handover/*` 의 상용 패키지 표기. 옛 설계·계획 문서(`docs/superpowers/*`)는 기록이라 그대로 |

⚠️ K1 이 들어간 뒤 `build:android:preview` 는 **새 `google-services.json`(A2-3)이 있어야** 성공한다(K3 검사). 그래서 A2-1~3 을 먼저 하고 K 를 반영하는 순서가 안전하다.

## C. 바뀌지 않는 것
- 개발 앱 `com.stockapp.dev`, 개발 OTA·개발 APK·개발 Firebase/EAS/OAuth 설정
- 딥링크 스킴, 소셜 로그인 복귀 주소(`stockapp://auth`), 카카오·네이버 Redirect/Callback URL, 백엔드 `APP_RETURN_URL`
- 서버·도메인·DB·OTA 채널 이름(`production`·`preview`), 앱 이름 FunNote·아이콘

## D. 순서
1. D1~D5 결정 확인(권장안 그대로면 진행)
2. **A1** Play Console 앱 생성 — 이름 확보
3. **A2-1~3** Firebase 에 `com.stocknote` 추가 → 새 `google-services.json` 교체
4. **B(K1~K7)** 코드·문서 변경(Claude) → 테스트 → dev 머지 — 코드·문서·테스트 ✅(2026-11-19), dev 머지 대기
5. **A2-4** EAS 에 `com.stocknote` FCM 키 업로드
6. 상용 테스트 APK 다시 빌드 → 설치 → 로그인·푸시 수신 확인(A2-5)
7. **K6** 상용 DB store_url 반영(상용 배포 때)
8. **A3** 카카오·네이버 콘솔 확인, 정식 빌드 때 **A4**·Google OAuth, iOS 때 Apple, 광고 때 AdMob

관련: [`store-release.md`](store-release.md) U2·U8·U10, [`owner-todo.md`](owner-todo.md), [`../push_notification_setup.md`](../push_notification_setup.md)
