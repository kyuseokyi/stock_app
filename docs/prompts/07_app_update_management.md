[명령어: 이 작업은 `docs/app_update_management_spec.md` 명세를 기반으로 백엔드 및 모바일 앱에 업데이트 관리 기능을 구현하는 지시서입니다. 00_master_prompt.md 및 CLAUDE.md 규칙을 준수하세요.]

당신의 임무는 React Native (Expo) 모바일 앱과 백엔드(FastAPI)에 **1) 서버 기반 강제/권장 업데이트 체계**와 **2) EAS Update (OTA) 관리 환경**을 단계별(Micro-step)로 구현하는 것입니다.

---

## 📌 [핵심 규칙 및 주의사항]
1. **Regression 방지**: 기존 API 응답 구조, 모바일의 기존 스플래시 화면 흐름(`expo-splash-screen`), 라우팅(`expo-router`), 디자인 시스템(`react-native-unistyles`)을 그대로 유지하면서 업데이트 레이어를 얹어야 합니다.
2. **에러 격리**: 버전 체크 API나 OTA 다운로드 과정에서 네트워크 오류가 발생하더라도 앱 기동이 먹통(White Screen/Crash)이 되지 않고, 경고 로그 후 정상 기동으로 폴백되어야 합니다.
3. **환경 분리 유지**: 개발(`APP_ENV=development`) 환경에서는 불필요한 OTA 검사를 방지(`__DEV__` 분기)하세요.

---

## 🛠️ [실행 단계 - Step by Step]

### Step 1. Backend: 버전 체크 API 구현
1. **스키마 정의 (`backend/shared/schemas/version.py` 또는 적절한 위치)**:
   - `UpdateType` Enum: `NONE`, `RECOMMENDED`, `FORCE`
   - `VersionCheckRequest`: `platform` (ios, android), `current_version` (SemVer 문자열), `build_number` (int, 선택)
   - `VersionCheckResponse`: `update_type`, `latest_version`, `min_supported_version`, `title`, `message`, `store_url`
2. **버전 비교 유틸**:
   - `packaging.version.parse` 또는 SemVer 비교 로직을 활용하여 `current_version < min_supported_version`이면 `FORCE`, `current_version < latest_version`이면 `RECOMMENDED`, 그 외는 `NONE`을 반환하는 로직 작성.
3. **API 엔드포인트 구현**:
   - `GET /api/v1/app/version-check` 라우터 작성.
   - 기본 설정값(최소 버전, 최신 버전, 스토어 링크)은 환경변수(`.env`)에서 읽어오도록 구성.
4. **검증**: `pytest` 단위 테스트 작성 및 엔드포인트 호출 검증.

---

### Step 2. Mobile: 패키지 설치 및 Expo 설정
1. **패키지 설치**:
   - `mobile/` 디렉토리에서 `npx expo install expo-updates expo-application` 실행.
2. **`mobile/app.config.js` 수정**:
   - `updates` 필드 추가:
     - `url`: `https://u.expo.dev/${EAS_PROJECT_ID}`
     - `checkAutomatically`: `'ON_LOAD_AND_BATTERY_CHARGING'`
     - `fallbackToCacheTimeout`: `0`
   - `runtimeVersion` 정책 추가:
     - `{ policy: 'fingerprint' }`
3. **`mobile/eas.json` 수정**:
   - `build` 하위 프로필(`development`, `development-sim`, `preview`, `production`)에 각각 일치하는 `channel` 필드 명시.

---

### Step 3. Mobile: 업데이트 체크 서비스 및 Hook 구현
1. **버전 체크 API 클라이언트 (`mobile/src/services/versionService.ts`)**:
   - 현재 플랫폼(`Platform.OS`) 및 앱 버전(`Application.nativeApplicationVersion`)을 파라미터로 하여 백엔드 `/api/v1/app/version-check` 호출 함수 작성.
2. **EAS Update 서비스 (`mobile/src/services/otaService.ts`)**:
   - `Updates.checkForUpdateAsync()`, `Updates.fetchUpdateAsync()`, `Updates.reloadAsync()`를 안전하게 래핑한 함수 작성 (`__DEV__`일 경우 즉시 스킵).
3. **통합 커스텀 훅 (`mobile/src/hooks/useAppUpdate.ts`)**:
   - 앱 시작 시 1) 서버 스토어 버전 검증 ➔ 2) 결과에 따라 모달 상태 세팅 ➔ 3) `NONE`일 때 백그라운드 OTA 수행을 관리하는 훅 작성.

---

### Step 4. Mobile: 강제/권장 업데이트 모달 UI 구현
1. **컴포넌트 작성 (`mobile/src/components/common/UpdateModal.tsx`)**:
   - `react-native-unistyles` 스타일 시스템을 적용하여 앱의 디자인 톤앤매너(`mobile_design_language.md`) 준수.
   - `FORCE` 모달: 백드롭 터치 및 뒤로가기(Android BackHandler) 차단, '스토어에서 업데이트' 단일 버튼만 노출, 클릭 시 `Linking.openURL(storeUrl)` 실행.
   - `RECOMMENDED` 모달: '나중에 하기'(닫기) 버튼과 '지금 업데이트' 버튼 함께 제공.

---

### Step 5. Mobile: 진입점 통합 (`app/_layout.tsx`)
1. **스플래시 화면과 연동**:
   - 앱 초기화 및 폰트 로드 단계에서 `useAppUpdate`를 실행.
   - 버전 체크가 완료되면 `SplashScreen.hideAsync()` 호출.
   - `FORCE` 대상인 경우 전체화면 모달을 띄워 사용자 인터랙션 대기.

---

### Step 6. 최종 검증
1. `npm run lint` 및 `npm run typecheck` 실행하여 문법/타입 에러 0건 확인.
2. 백엔드 버전 모킹(예: 클라이언트 버전 0.9.0으로 전송)을 통해 강제 업데이트 모달이 정상 렌더링되고 스토어 링크로 이동하는지 테스트.
