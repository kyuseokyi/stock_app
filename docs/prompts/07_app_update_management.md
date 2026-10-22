[명령어: 이 작업은 `docs/app_update_management_spec.md` 명세를 기반으로 백엔드, 관리자 웹, 모바일 앱에 걸친 완전한 앱 버전 및 업데이트 관리 시스템을 구현하는 지시서입니다. 00_master_prompt.md 및 CLAUDE.md 규칙을 준수하세요.]

당신의 임무는 **1) 백엔드 DB/API**, **2) 관리자 웹 UI(스토어 강제/권장 및 OTA 무음/선택/필수 제어)**, **3) 모바일 클라이언트(Expo Updates 및 통합 모달)**를 단계별(Micro-step)로 구현하는 것입니다.

---

## 📌 [핵심 규칙 및 주의사항]
1. **Regression 방지**: 
   - 백엔드의 기존 API 계약과 데이터베이스 테이블 구조를 훼손하지 마세요.
   - 관리자 웹(`admin_web`)의 기존 레이아웃(`Layout.tsx`, `Sidebar.tsx`) 디자인을 해치지 않고 새 메뉴를 자연스럽게 결합하세요.
   - 모바일(`mobile`)의 스플래시 화면 흐름과 에러 격리를 철저히 보장하세요 (버전 체크 실패 시에도 앱이 크래시되지 않고 기본 기동).
2. **에러 핸들링**:
   - 관리자 웹에서 잘못된 버전 문자열(SemVer 형식이 아닌 경우) 입력을 프론트/백 양쪽에서 검증하세요.
   - OTA 업데이트 다운로드 실패 시 조용히 넘어가고 기존 번들로 실행되도록 `try-catch` 처리하세요.
3. **환경 분리 유지**:
   - 모바일 개발 환경(`__DEV__`)에서는 실제 OTA 검사를 건너뛰도록 처리하세요.

---

## 🛠️ [실행 단계 - Step by Step]

### Step 1. Backend: DB 모델, 마이그레이션 및 API 구현
1. **모델 추가 (`backend/shared/models.py`)**:
   - `AppVersionConfig` 모델 생성:
     - `platform` (String(20), unique, index) - 'android', 'ios'
     - `latest_version` (String(20))
     - `min_supported_version` (String(20))
     - `force_update_enabled` (Boolean, default=False)
     - `store_url` (String(255))
     - `store_title` (String(100))
     - `store_message` (Text)
     - `ota_policy` (String(20), default='SILENT') - 'SILENT', 'OPTIONAL', 'MANDATORY'
     - `ota_title` (String(100), nullable)
     - `ota_message` (Text, nullable)
     - `is_maintenance` (Boolean, default=False)
     - `maintenance_message` (Text, nullable)
     - `updated_at`, `updated_by`
2. **마이그레이션 및 초기 데이터 시딩**:
   - Alembic 마이그레이션 파일 생성 (`uv run alembic revision --autogenerate -m "create_app_version_configs"`).
   - 기본 레코드 2건(android, ios) 자동 시드 코드 작성.
3. **API 엔드포인트 구현**:
   - 클라이언트용: `GET /api/v1/app/version-check`
     - 파라미터: `platform`, `current_version`
     - 판별 로직(점검 체크 ➔ 강제 업데이트 플래그/최소 버전 검사 ➔ 최신 버전 검사 ➔ OTA 정책 반환) 적용.
   - 관리자용:
     - `GET /api/v1/admin/app-versions` (Android/iOS 설정 조회, 관리자 권한 확인)
     - `PUT /api/v1/admin/app-versions/{platform}` (설정 수정)

---

### Step 2. Admin Web: 업데이트 관리 UI 구현
1. **API 클라이언트 (`admin_web/src/api/appVersions.ts`)**:
   - `getAppVersions()`, `updateAppVersion(platform, data)` 함수 작성.
2. **사이드바 메뉴 등록 (`admin_web/src/components/Sidebar.tsx`)**:
   - `NAV_GROUPS`에 `앱 관리` 그룹 및 `{ to: '/app/versions', label: '앱 버전 & 업데이트', icon: '📱' }` 추가.
3. **페이지 라우트 추가 (`admin_web/src/App.tsx`)**:
   - `<Route path="app/versions" element={<AppVersionsPage />} />` 등록.
4. **관리 화면 구현 (`admin_web/src/pages/AppVersionsPage.tsx`)**:
   - **탭**: Android / iOS 전환 탭
   - **스토어 업데이트 섹션**:
     - 최신 버전, 최소 지원 버전 인풋
     - **스토어 강제 업데이트 토글 스위치**
     - 스토어 URL, 안내 문구 인풋
   - **OTA 업데이트 정책 섹션**:
     - 3단계 라디오 버튼:
       - 🟢 무음 적용 (`SILENT`)
       - 🟡 권장 재시작 - 거부/연기 가능 (`OPTIONAL`)
       - 🔴 강제 즉시 재시작 - 필수 (`MANDATORY`)
     - OTA 안내 문구 인풋
   - **긴급 점검 섹션**: 점검 모드 On/Off 토글 및 점검 메시지 인풋
   - **저장 버튼**: 변경 사항 저장 및 토스터 피드백

---

### Step 3. Mobile: 패키지 설치 및 Expo 설정
1. **패키지 설치**:
   - `cd mobile && npx expo install expo-updates expo-application`
2. **`mobile/app.config.js` 설정**:
   - `updates` (`url`, `checkAutomatically: 'ON_LOAD_AND_BATTERY_CHARGING'`, `fallbackToCacheTimeout: 0`)
   - `runtimeVersion: { policy: 'fingerprint' }`
3. **`mobile/eas.json` 설정**:
   - 각 빌드 프로필(`development`, `preview`, `production`)에 맞는 `channel` 바인딩.

---

### Step 4. Mobile: 서비스 및 통합 업데이트 훅 구현
1. **API 통신 서비스 (`mobile/src/services/versionService.ts`)**:
   - `checkAppVersion(currentVersion)` 호출 함수 작성.
2. **OTA 서비스 (`mobile/src/services/otaService.ts`)**:
   - `Updates.checkForUpdateAsync()` 및 `Updates.fetchUpdateAsync()`를 안전하게 호출하는 함수.
3. **업데이트 훅 (`mobile/src/hooks/useAppUpdate.ts`)**:
   - 기동 시 1) `checkAppVersion` 호출
   - 점검 모드 또는 스토어 강제 업데이트(`FORCE`) 감지 시 ➔ 해당 모달 상태 활성화
   - 그 외의 경우 ➔ 백그라운드로 OTA 검사 진행
   - 새 OTA 다운로드 완료 시 `ota_policy`에 따라 분기:
     - `MANDATORY`: 강제 재시작 모달 노출 (닫기 불가)
     - `OPTIONAL`: 선택 재시작 모달 노출 ([나중에 하기] 누르면 닫힘)
     - `SILENT`: 팝업 없이 패스 (다음 기동 시 자동 적용)

---

### Step 5. Mobile: 통합 모달 컴포넌트 UI (`UpdateModal.tsx`)
1. **모달 컴포넌트 구현 (`mobile/src/components/common/UpdateModal.tsx`)**:
   - 모드별 렌더링:
     - `MAINTENANCE`: 점검 안내, 확인 클릭 시 앱 종료
     - `STORE_FORCE`: 스토어 강제 업데이트, 뒤로가기 차단, `[스토어에서 업데이트]` 버튼만 노출
     - `STORE_RECOMMENDED`: 스토어 권장 업데이트, `[나중에 하기]` / `[업데이트]` 버튼
     - `OTA_MANDATORY`: OTA 필수 재시작, 뒤로가기 차단, `[지금 재시작]` 버튼만 노출 (`Updates.reloadAsync()`)
     - `OTA_OPTIONAL`: OTA 선택 재시작, `[나중에 하기]` / `[지금 재시작]` 버튼
2. **진입점 결합 (`app/_layout.tsx`)**:
   - 최상위 레이아웃에 `<UpdateModal />` 배치 및 스플래시 화면 해제와 안전하게 결합.

---

### Step 6. 테스트 및 검증
1. `admin_web`에서 버전 설정 및 OTA 정책(무음/선택/필수) 변경이 정상 저장되는지 확인.
2. 모바일 앱에서 서버 응답을 모킹하여 5가지 모달(점검, 스토어강제, 스토어권장, OTA강제, OTA선택)이 기획 스펙대로 노출 및 동작(거부/강제)하는지 확인.
3. 린트 및 타입 검사 (`npm run lint`, `npm run typecheck`).
