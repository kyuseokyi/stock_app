# 로컬 빌드 가이드 (모바일 앱 · 웹)

맥에서 직접 빌드해 기기에 설치하거나 배포 이미지를 확인하는 방법을 종류별로 정리한다.
서버 배포(GitHub Actions)는 [`run_and_deploy.md`](run_and_deploy.md), 로컬 개발 서버 실행은 루트 `README.md`,
푸시 알림 키·연결은 [`push_notification_setup.md`](push_notification_setup.md) 를 본다.

> 검증 상태(2026-10-20): **개발용 앱** 절차는 실기기(SM-A536N)에서 확인했다. **단독 실행(release)·배포용(EAS)** 절차는
> `package.json` 스크립트·`eas.json` 기준으로 정리했고 이번에 직접 돌려 보지는 않았다 — 처음 할 때 결과를 이 문서에 보태 줄 것.

---

## 1. 모바일 앱 — 한눈에 보기

| 종류 | 언제 | 패키지(앱 이름) | API 주소 | 맥 연결 필요 | 명령 |
|---|---|---|---|---|---|
| **개발용** (debug) | 코드 고치며 바로 확인 | `com.stockapp.dev` (StockApp Dev) | `.env.development` (+ `.env.development.local`) | **필요** — 화면 코드를 Metro(8082)에서 받음 | `APP_ENV=development npx expo run:android --port 8082` |
| **단독 실행** (release APK) | 맥 없이 폰에서 써 보기·지인 배포 | `com.stockapp` (StockApp) | `.env.production` (haezean) | 불필요 | `npm run android:prod` |
| **배포용** (스토어 AAB) | Play 스토어 업로드 | `com.stockapp` | `.env.production` | 불필요 | `npm run build:android:prod` (EAS 로컬 빌드) |

- 패키지가 달라 **개발용과 단독 실행/배포용은 한 기기에 같이 설치**된다(로그인·저장 데이터도 따로).
- 패키지·앱 이름·딥링크 스킴은 `mobile/app.config.js` 가 `APP_ENV` 로 고른다(`development` → `.dev`).

### 준비물
- Node(프로젝트 `package.json` 기준), JDK 17, Android SDK(`adb` 가 PATH 에 있어야 함)
- 휴대폰: 개발자 옵션 → **USB 디버깅** 켜기 → USB 연결 → `adb devices` 에 `device` 로 보이는지 확인
- Metro 포트는 **8082** (8081 은 다른 프로젝트가 씀)

### 환경 파일(`mobile/`)
| 파일 | 쓰이는 때 | 내용 |
|---|---|---|
| `.env.development` | 개발용(debug) | `localhost:8000~8003` — 맥에서 띄운 백엔드 |
| `.env.production` | 단독 실행·배포용(release) | `https://*.haezean.com` |
| `.env.development.local` | 개발용인데 **haezean 서버**에 붙이고 싶을 때(임시) | `.env.production` 의 URL 3줄 + `EXPO_PUBLIC_GAME_API_URL=https://game.haezean.com`. gitignore 대상 |

> ⚠️ **게임 주소(`EXPO_PUBLIC_GAME_API_URL`)를 빠뜨리지 말 것** — 없으면 개발 빌드는 `localhost:8003` 으로, release 빌드는 게임 탭 "준비 중"으로 처리된다
> (2026-10-20 기기에서 게임이 안 되던 원인). 현재 `.env.development`·`.env.production` 에 이 줄이 없다.
>
> ⚠️ `.env.development.local` 은 `.env.development` 보다 우선한다. 확인이 끝나면 **Metro 를 먼저 끄고 파일을 지운다** —
> 남겨 두면 다음 개발 실행이 조용히 haezean 서버에 붙는다.

---

## 2. 개발용 앱 (debug)

### 2-1. 처음 설치하거나 네이티브가 바뀌었을 때 — 빌드 + 설치 + Metro
```bash
cd mobile
APP_ENV=development npx expo run:android --port 8082
```
- `android/` 를 빌드해 `app-debug.apk` 를 연결된 기기에 설치하고, 8082 에서 Metro 를 띄운 뒤 앱을 연다.
- **네이티브가 바뀐 경우** = 네이티브 모듈이 있는 패키지를 추가·업데이트했을 때(예: Google 로그인), `app.config.js` 플러그인 변경.
  이때 재빌드하지 않으면 앱이 켜지자마자 빨간 화면이 뜬다:
  `TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found` ← 설치된 앱이 옛 네이티브 빌드라는 뜻.
- 기기가 한 대면 `--device` 는 생략. `--device` 는 **시리얼이 아니라 기기 이름**을 받는다(`R5CT31XMW5K` ✗).
- `--port` 와 `--no-bundler` 는 함께 쓸 수 없다. Metro 가 이미 떠 있으면 먼저 끄고 위 명령을 쓴다.

### 2-2. JS 만 바뀌었을 때 — Metro 만
```bash
cd mobile
npx expo start --port 8082
adb reverse tcp:8082 tcp:8082                     # USB 연결 기기가 맥의 8082 를 보게
adb shell monkey -p com.stockapp.dev -c android.intent.category.LAUNCHER 1   # 앱 실행(또는 폰에서 직접)
```

### 2-3. 어떤 백엔드에 붙을지
- **맥에서 띄운 백엔드**(기본): 기기도 `localhost` 를 보도록 포트를 넘긴다.
  ```bash
  for p in 8000 8001 8002 8003 8082; do adb reverse tcp:$p tcp:$p; done
  ```
- **haezean 서버**: `.env.production` 의 URL 을 `.env.development.local` 로 복사 → Metro 재시작.
  번들에 들어간 실제 값 확인:
  `curl -s "localhost:8082/src/lib/env.ts.bundle?platform=android&dev=true&modulesOnly=true&runModule=false" | grep -o "https\?://[^\"']*"`

---

## 3. 단독 실행 앱 (release APK — 맥 없이 실행)

```bash
cd mobile
npm run android:prod
# = APP_ENV=production expo prebuild --platform android --clean
#   → APP_ENV=production expo run:android --variant release --device
```
- `prebuild --clean` 이 **`android/` 폴더를 운영 설정(`com.stockapp`)으로 다시 만든다.** `android/` 는 커밋하지 않는 생성물이라
  손으로 고친 내용이 있으면 사라진다.
- 결과 APK: `android/app/build/outputs/apk/release/app-release.apk` — 다른 폰에는 `adb install -r <apk>` 로 설치.
- 서명: 지금 `android/app/build.gradle` 의 release 는 **debug 키로 서명**된다 → 내부 테스트용. 스토어에는 올릴 수 없다(4장).
- 다시 개발용으로 돌아갈 때는 `android/` 를 개발 설정으로 되돌린다:
  ```bash
  npm run prebuild:dev:android      # android/ 를 com.stockapp.dev 로 재생성
  APP_ENV=development npx expo run:android --port 8082
  ```

---

## 4. 배포용 (스토어 업로드)

```bash
cd mobile
npm run build:android:prod        # eas build --platform android --profile production --local  → .aab
npm run build:android:dev         # (참고) 개발용 APK 를 EAS 로컬 빌드로
```
- `eas.json` 프로필: `development`(dev client APK) · `preview`(운영 설정 APK, 내부 배포) · `production`(AAB, 버전 자동 증가 — 원격 버전 기준).
- `--local` 이라 빌드는 맥에서 하지만 **EAS 로그인(`eas login`)과 프로젝트 연결이 필요**하다. 업로드 키(서명)는 EAS 자격 증명으로 관리.
- 운영 패키지명 `com.stockapp` 은 스토어에 한 번 올리면 바꿀 수 없다 — 첫 업로드 전에 확정.
- iOS: `npm run build:ios:prod`(실기기), `npm run build:ios:sim`(시뮬레이터) — 애플 로그인 도입 시점에 정리.

---

## 5. 웹 (web_client · admin_web)

| 종류 | 명령 | 비고 |
|---|---|---|
| 개발 서버 | `cd web_client && npm run dev` (3000) · `cd admin_web && npm run dev` (5173) | API 는 `.env.development` → 맥의 백엔드(`localhost:8000~8003`). 백엔드가 안 떠 있으면 화면이 오류 |
| 정적 빌드 확인 | `npm run build` | 배포 빌드는 `VITE_API_BASE_URL`·`VITE_AUTH_BASE_URL` 이 없으면 **일부러 실패**(fail-fast) |
| 배포 이미지(web_client) | 아래 | 같은 도메인 프록시(`/_api/…`) 포함 — 운영과 같은 구성 |

web_client 배포 이미지를 맥에서 띄워 haezean 백엔드로 확인:
```bash
cd web_client
docker build -t web-local \
  --build-arg VITE_API_BASE_URL=/_api/blog/api/v1 --build-arg VITE_AUTH_BASE_URL=/_api/auth/api/v1 \
  --build-arg VITE_GAME_API_URL=/_api/game --build-arg VITE_STOCK_API_URL=/_api/stock/graphql \
  --build-arg VITE_ENABLE_GUEST_LOGIN=true .
docker run --rm -p 4010:3000 -e PROXY_CHANGE_ORIGIN=1 \
  -e BLOG_UPSTREAM=https://blog.haezean.com -e AUTH_UPSTREAM=https://auth.haezean.com \
  -e STOCK_UPSTREAM=https://api.haezean.com -e GAME_UPSTREAM=https://game.haezean.com web-local
# → http://localhost:4010
```

---

## 6. 자주 겪는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| 앱이 켜지자마자 빨간 화면 `... could not be found ... native binary` | 설치된 개발용 앱이 옛 네이티브 빌드 | 2-1 로 재빌드 |
| 앱이 흰 화면/`Could not connect to development server` | Metro 가 안 떠 있거나 8082 를 기기가 못 봄 | `npx expo start --port 8082`, `adb reverse tcp:8082 tcp:8082` |
| 게임 탭만 안 됨 | 게임 주소(`EXPO_PUBLIC_GAME_API_URL`) 누락 → `localhost:8003` | env 에 `https://game.haezean.com` 추가 후 Metro 재시작 |
| 앱 화면은 뜨는데 데이터 오류 | 개발용은 `localhost` 백엔드를 봄 | 백엔드 띄우고 포트 넘기기, 또는 `.env.development.local`(2-3) |
| `CommandError: Could not find device with name` | `--device` 에 시리얼을 넣음 | 한 대면 `--device` 생략 |
| `--port and --no-bundler are mutually exclusive` | 두 옵션 동시 사용 | Metro 끄고 `--port 8082` 만 |
| 단독 실행 빌드 후 개발용이 이상함 | `android/` 가 운영 설정으로 바뀌어 있음 | `npm run prebuild:dev:android` 후 2-1 |
| `localhost:5173`·`3000` "연결을 거부" | 웹 개발 서버가 안 떠 있음 | 5장 개발 서버 실행(백엔드도 필요) |
