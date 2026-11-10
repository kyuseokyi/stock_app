# 9. 모바일 앱 — Expo / React Native

> 목표: 앱 폴더 구조와 화면 이동 방식을 알고, 개발 앱을 띄워 보고, "앱을 새로 빌드해야 하나 / OTA 로 충분한가" 를 판단할 수 있다.

## 9-1. 기술 한 줄 요약

| 기술 | 역할 |
|---|---|
| **React Native** | React 문법으로 iOS·Android 네이티브 앱을 만든다 (웹의 `<div>` 대신 `<View>`, `<Text>`) |
| **Expo (SDK 57)** | React Native 개발·빌드·업데이트 도구 모음 |
| **expo-router** | **파일 경로 = 화면 주소**. `src/app/blog/[id].tsx` → `/blog/12` |
| **Unistyles v3** | 테마(색·간격) 스타일링. 네이티브 코드라 **Expo Go 앱에서는 안 돈다** → 개발 빌드 필요 |
| **zustand** | 전역 상태 (로그인 등) |
| **graphql-request** + fetch | API 호출 (`src/lib/api/`) |
| **expo-secure-store** | 로그인 토큰을 기기에 안전하게 저장 |
| **expo-notifications** | 푸시 알림 |
| **expo-updates (EAS Update)** | 스토어 심사 없이 JS 코드만 업데이트(OTA) |

## 9-2. 폴더 구조

```
mobile/
├── app.config.js      앱 이름·번들ID·스킴·푸시·OTA 설정 (APP_ENV 에 따라 dev/prod 분리)
├── eas.json           빌드 프로필 (development / development-sim / preview / production)
├── .env.example       → .env.development / .env.production 으로 복사해서 사용 (Git 제외)
├── scripts/           OTA 발행(publish-ota.sh)·활성화, 개발 APK 빌드 스크립트
└── src/
    ├── app/           ★ 화면(라우트). 파일 하나 = 화면 하나
    │   ├── _layout.tsx            앱 전체 틀 (테마·로그인 복원·업데이트 안내·푸시·펀드 백그라운드 작업)
    │   ├── (tabs)/                하단 탭: index(홈) · market · screener · community · game · profile
    │   ├── blog/[id].tsx          글 상세
    │   ├── stock/[ticker].tsx     종목 상세
    │   ├── market/[kind]/[id].tsx 테마·업종 상세
    │   └── fund/…                 펀드 수익·히스토리·백업
    ├── features/      ★ 기능별 로직 (api 호출 + 훅 + 기능 전용 컴포넌트)
    │   ├── auth/  blog/  boards/  market/  screener/  leaders/  patterns/
    │   ├── game/  fund/  push/  app-update/  home/  finder/
    ├── lib/
    │   ├── env.ts     API 주소 등 환경값의 단일 접근점
    │   └── api/       공통 통신: http.ts(REST) · graphql.ts · 토큰 자동 첨부 · 401 처리 · 재시도
    └── ui/            공통 부품 (button, card, chip, bottom-sheet, toast …)
```

**규칙**: `app/` 의 화면 파일은 얇게, 실제 로직은 `features/<기능>/` 의 훅(`use-xxx.ts`)과 api 파일에 둔다.

## 9-3. 코드로 따라가기 — 앱에서 댓글 달기

```
src/app/blog/[id].tsx                 화면: 글 본문(WebView) + 댓글 목록 + 입력창
  └─ features/blog/use-comments.ts    훅: 목록 불러오기, 작성, 401/403 메시지 구분
       └─ features/blog/comments-api.ts
            fetchComments(blogId)  →  blogApi.get(`/api/v1/blogs/${blogId}/comments`)
            createComment(id, txt) →  blogApi.post(`/api/v1/blogs/${id}/comments`, { content })
                 └─ lib/api/index.ts  blogApi = createHttpClient(ENV.blogApiUrl)   ← Bearer 토큰 자동 부착
```

`comments-api.ts` 는 서버의 `snake_case` 응답(`post_id`)을 앱에서 쓰는 `camelCase`(`postId`)로 바꾼다. **서버 스키마(`apps/blog/schemas.py CommentOut`)를 바꾸면 여기의 `RawComment` 타입도 같이 바꿔야 한다.**

## 9-4. 서버 주소 설정

`mobile/.env.development` (로컬 개발):
```
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_STOCK_GRAPHQL_URL=http://localhost:8002/graphql
EXPO_PUBLIC_BLOG_API_URL=http://localhost:8000
EXPO_PUBLIC_AUTH_API_URL=http://localhost:8001
EXPO_PUBLIC_GAME_API_URL=http://localhost:8003
```
- `EXPO_PUBLIC_` 값은 **앱 번들에 그대로 들어간다** → 비밀번호·비밀 키를 절대 넣지 않는다.
- 실제 폰에서는 `localhost` 가 폰 자신을 뜻한다. 개발 PC 의 LAN IP 로 바꾸거나, 안드로이드 에뮬레이터는 `adb reverse tcp:8000 tcp:8000` (8001·8002·8003 도) 을 쓴다.
- 운영 값(`.env.production`): `https://api.haezean.com/graphql`, `https://blog.haezean.com`, `https://auth.haezean.com`, `https://game.haezean.com`.

## 9-5. 실행하기

```bash
cd mobile
npm install
cp .env.example .env.development

npm run web              # (가장 가벼움) 브라우저로 화면 구조만 확인
npm run android:dev      # 안드로이드 개발 빌드 + 실행 (Android SDK 필요)
npm run ios:dev          # iOS 개발 빌드 + 실행 (Xcode 필요, 맥 전용)
npm run start:dev        # 이미 개발 앱이 설치돼 있으면 Metro(JS 서버)만
```

| 폰에 설치된 앱 | 이름 / 번들ID | 붙는 서버 |
|---|---|---|
| 개발 앱 | `StockApp Dev` / `com.stockapp.dev` | `.env.development` |
| 상용 앱 | `StockApp` / `com.stockapp` | `.env.production` |

두 앱은 번들ID 가 달라서 **한 폰에 같이 설치**된다.

빌드 종류(개발용 / 단독 실행 APK / 스토어용) 상세: [`docs/local_build_guide.md`](../local_build_guide.md)

## 9-6. 새 빌드 vs OTA — 가장 중요한 판단

| 바꾼 것 | 필요한 것 |
|---|---|
| 화면 코드, 문구, 스타일, API 호출 로직 (JS/TS 만) | **OTA 로 충분** → `npm run ota:<dev\|preview\|prod> -- "변경 요약"` |
| 새 네이티브 라이브러리 추가, `app.config.js` 의 네이티브 설정, 권한, 플러그인 | **새 빌드 필요** (스토어 제출 / APK 재설치) |

- 앱은 `runtimeVersion: fingerprint` 를 쓴다. 네이티브 구성이 바뀌면 지문이 바뀌어서 **옛 앱은 새 OTA 를 아예 받지 않는다**(크래시 방지 장치).
- OTA 발행은 **반드시 `npm run ota:*` 스크립트로만** 한다. 직접 `eas update` 를 치면 개발 앱이 운영 서버에 붙거나, 업데이트가 조용히 전달되지 않는 함정이 있다(이유는 `scripts/publish-ota.sh` 주석과 README 참고).
- 미리 올려 두고 나중에 켜기: `OTA_STAGE=1 npm run ota:prod -- "메시지"` → 원할 때 `npm run ota:prod:activate`.
- 앱이 업데이트를 받는 정책(무음/선택/필수, 점검 모드, 스토어 강제)은 **관리자 웹 › 앱 버전** 에서 정한다. 앱은 켤 때 blog `GET /api/v1/app/version-check` 로 정책을 받는다. 명세: [`docs/app_update_management_spec.md`](../app_update_management_spec.md).

## 9-7. 푸시 알림

- 앱 로그인 + 알림 허용 → `PUT /api/v1/push-devices` 로 기기 토큰 등록 → 서버(Celery)가 Expo Push 로 발송.
- 서버 `PUSH_BACKEND=mock` 이면 실제 발송 없이 로그만 남는다(로컬 기본).
- 최초 설정(Firebase 키, EAS): [`docs/push_notification_setup.md`](../push_notification_setup.md)
- 코드: `src/features/push/`

## 9-8. 검사·테스트

```bash
npx tsc --noEmit          # 타입 검사 (화면 코드 검증의 기본)
npm test                  # jest 단위 테스트 (*.test.ts — 순수 로직)
npm run lint              # expo lint
npx expo-doctor           # Expo 설정 진단
```

## 9-9. 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| Expo Go 로 열었더니 바로 에러 | Unistyles 는 Expo Go 미지원 → 개발 빌드(`npm run android:dev`) |
| 폰에서 `Network request failed` | `localhost` 를 PC IP 로 바꾸거나 `adb reverse` |
| 카카오 로그인 후 앱으로 안 돌아옴 | 개발 앱 스킴은 `stockapp-dev://`, 상용은 `stockapp://`. 스킴이 바뀐 뒤 옛 개발 빌드면 `npm run prebuild:dev` 후 재빌드 |
| OTA 를 올렸는데 앱이 안 받음 | 네이티브가 바뀌어 지문이 다름 → 새 빌드 필요. 또는 채널이 다름(dev 앱엔 `ota:dev`) |
| 개발 APK 를 다른 폰에 깔았더니 서버 연결 안 됨 | `mobile/.env.development.local` 에 개발 서버 주소(https) 를 넣고 다시 빌드 |

## 직접 해보기

1. `npm run web` 으로 띄우고, `src/app/(tabs)/` 의 파일 이름과 하단 탭이 어떻게 대응하는지 확인한다.
2. `src/app/blog/[id].tsx` → `features/blog/use-comments.ts` → `comments-api.ts` → `lib/api/index.ts` 를 차례로 열어 9-3 의 화살표를 직접 확인한다.
3. 방금 고친 것이 OTA 로 나갈 수 있는지 9-6 표로 판단하는 연습을 한다(예: "버튼 문구 변경", "카메라 라이브러리 추가").

이전: [8. 웹](./08-web.md) · 다음: [10. 배포·운영](./10-deploy-ops.md)
