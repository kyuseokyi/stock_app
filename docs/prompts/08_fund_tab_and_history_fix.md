# 펀드 수익률 메인 탭(관리자 ON/OFF) 승격 및 히스토리 저장 결함 개선 지시서

[명령어: 이 작업은 펀드 수익률 화면을 모바일 메인 탭에 추가(관리자 임시 ON/OFF 제어 가능)하고, 기존 기능을 온전히 보존하며, 히스토리 저장 오류를 해결하기 위한 풀스택 구현 지시서입니다. CLAUDE.md 및 저장소 규칙을 엄격히 준수하세요.]

---

## 📌 [핵심 규칙 및 주의사항]

1. **기존 기능 100% 보존 (Regression Prevention)**:
   - `mobile/src/app/(tabs)/profile.tsx` (내정보) 화면 내의 "내 펀드 수익" 행(`router.push('/fund')`)을 절대 삭제하거나 변경하지 마세요.
   - 기존의 모든 펀드 경로(`/fund`, `/fund/[id]`, `/fund/history/[id]`, `/fund/backup`) 및 데이터 저장/캐싱 흐름은 완벽히 유지되어야 합니다.
2. **관리자 스위치 기본값**:
   - 새로 추가되는 `FUND_TAB` 스위치는 DB에 행이 없거나 조회 실패 시 기본값 **`false` (꺼짐, 탭 숨김)** 이어야 합니다 (안전 모드).
3. **Core 동기화 필수**:
   - `mobile/src/features/fund/core/` 내의 파일을 수정하면 반드시 `bash scripts/check-fund-core-sync.sh --write`를 실행하여 `web_client/src/lib/fundCore/`와 100% 동일하게 동기화해야 합니다.
4. **언어 규칙**:
   - 사용자에게 보이는 모든 UI 텍스트, 주석, 에러 메시지, 커밋 메시지는 반드시 **한국어**로 작성하세요.

---

## 🛠️ [실행 단계 - Step by Step]

---

### Step 1. Core 파싱 및 히스토리 모델 개선 (`mobile/src/features/fund/core/`)

기존 히스토리 저장이 정상 동작하지 않던 주원인(날짜 포맷 엄격성, 금액 단위 처리, 누적수익률 누락)을 해결합니다.

#### 1-1. `view.ts` 금액 및 퍼센트 파싱 강화
- **파일**: `mobile/src/features/fund/core/view.ts`
- **작업 내용**:
  - `parseAmount(raw: string)`:
    - 원본 문자열에서 `원`, `₩`, 공백을 제거한 후 정수 또는 소수점 숫자를 추출하도록 개선합니다.
    - 정규식: `/^-?[\d,]+(?:\.\d+)?$/`
  - `parsePercent(raw: string)` 신규 추가:
    - `%`, 공백을 제거하고 부동소수점 숫자로 변환합니다 (예: `"53.3334%"` ➔ `53.3334`, `"-1.5%"` ➔ `-1.5`).
    - 형태가 올바르지 않으면 `null` 반환.
- **테스트**: `mobile/src/features/fund/core/view.test.ts`에 `parseAmount`의 `원` 단위 및 `parsePercent` 테스트 추가.

#### 1-2. `history.ts` 날짜 파싱 유연화 및 `rate` 필드 추가
- **파일**: `mobile/src/features/fund/core/history.ts`
- **작업 내용**:
  - `HistoryPoint` 타입에 `rate?: number | null;` (누적수익율 %) 추가.
  - `toIsoDate(raw: string)`:
    - `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY. MM. DD`, `YYYY/MM/DD`, `YYYY년 M월 D일` 및 뒤에 붙은 요일 표기(`(월)`, `(화)`)를 모두 인식하여 `YYYY-MM-DD` ISO 문자열로 안전하게 변환하도록 정규식 확장.
  - `snapshotOf(report, recordedAt)`:
    - 평가금 키: `현재평가금`, `수익측정가치`, `평가금액`, `평가금`을 순차적으로 탐색(`pick`).
    - 손익 키: `당일손익금`, `당일손익`, `금일손익` 및 `월손익금`, `월손익`, `월간손익` 탐색.
    - 수익률 키: `누적수익율`, `누적수익률`, `수익율`, `수익률`을 `pickPercent`로 추출하여 `p.rate`에 할당.
  - `isHistoryPoint`: `(o.rate === undefined || numOrNull(o.rate))` 검사 추가 (기존 파일과의 하위 호환성 유지).
- **테스트**: `mobile/src/features/fund/core/history.test.ts` 갱신 (확장된 `toIsoDate` 테스트 및 `snapshotOf`의 `rate` 검증).

#### 1-3. `history-view.ts` 뷰 모델 갱신
- **파일**: `mobile/src/features/fund/core/history-view.ts`
- **작업 내용**:
  - `HistoryRowView`에 `rate?: ViewCell;` 추가.
  - `toHistoryView` row 매핑 시 `p.rate !== null && p.rate !== undefined`이면 `formatValue('누적수익율', `${p.rate}%`)`를 매핑.

#### 1-4. 코어 동기화 스크립트 실행
```bash
bash scripts/check-fund-core-sync.sh --write
```
- 동기화 검사: `bash scripts/check-fund-core-sync.sh` 결과가 `fund core: in sync`여야 함.
- 단위 테스트 실행:
  ```bash
  cd mobile && npx jest src/features/fund/core/history.test.ts src/features/fund/core/view.test.ts src/features/fund/core/history-view.test.ts --no-watchman
  ```

---

### Step 2. 백엔드: 앱 기능 스위치 API (`backend/`)

관리자가 모바일 앱의 펀드 탭 노출을 원격으로 제어할 수 있는 API를 구현합니다.

#### 2-1. DB 모델 추가 (`backend/shared/models.py`)
- `AppFeatureConfig` 모델 정의:
  ```python
  class AppFeatureConfig(Base):
      """앱 기능/탭 원격 스위치(FUND_TAB 등) — 관리자가 켜고 끈다."""
      __tablename__ = "app_feature_configs"

      feature_key: Mapped[str] = mapped_column(String(50), primary_key=True)
      enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
      updated_at: Mapped[datetime] = mapped_column(
          DateTime(timezone=True), server_default=func.now(), nullable=False
      )
      updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
  ```

#### 2-2. 라우터 구현 (`backend/apps/blog/routers/app_features.py`)
- **공개 엔드포인트**:
  - `GET /api/v1/app/features`:
    - 인증 불필요, `Response` 헤더에 `Cache-Control: no-store` 설정.
    - 반환 형식: `{"fund_tab": bool}` (DB 조회 실패 시 `{"fund_tab": False}`).
- **관리자 엔드포인트** (`require_admin` 의존성):
  - `GET /api/v1/admin/app/features`: 모든 등록된 기능 스위치 목록 반환.
  - `PUT /api/v1/admin/app/features/{feature_key}`: 특정 스위치의 `enabled` 값 업데이트 (`payload: {"enabled": bool}`).

#### 2-3. 라우터 등록 (`backend/apps/blog/main.py`)
- `app.include_router(app_features.public_router)`
- `app.include_router(app_features.admin_router)`

#### 2-4. 백엔드 테스트 작성 (`backend/tests/test_app_features.py`)
- 비로그인 사용자가 공개 조회 시 200 OK 및 기본값 확인.
- 일반 회원이 관리자 API 호출 시 403 Forbidden 확인.
- 관리자가 `FUND_TAB` 스위치를 켰을 때 공개 조회가 `True`로 변경되는지 검증.
- 실행:
  ```bash
  cd backend && uv run pytest tests/test_app_features.py
  ```

---

### Step 3. 관리자 웹: 탭 설정 UI (`admin_web/`)

#### 3-1. API 클라이언트 (`admin_web/src/api/appFeatures.ts`)
```ts
import client from './client'

export interface AppFeature {
  feature_key: string
  enabled: boolean
  updated_at: string | null
  updated_by: string | null
}

export const getAppFeatures = async (): Promise<AppFeature[]> => {
  const { data } = await client.get<AppFeature[]>('/admin/app/features')
  return data
}

export const updateAppFeature = async (key: string, enabled: boolean): Promise<AppFeature> => {
  const { data } = await client.put<AppFeature>(`/admin/app/features/${key}`, { enabled })
  return data
}
```

#### 3-2. `FundNoticesPage.tsx`에 탭 설정 패널 추가 (`admin_web/src/pages/FundNoticesPage.tsx`)
- 상단 탭 버튼에 `[앱 탭 설정]` 추가 (기존 `발송`, `문구 템플릿` 유지):
  ```tsx
  {(["send", "templates", "settings"] as const).map((t) => ( ... ))}
  ```
- `SettingsPanel` 컴포넌트:
  - `FUND_TAB` 스위치 카드 제공.
  - 타이틀: **모바일 하단 '펀드' 탭 표시**
  - 설명: "스위치를 켜면 모바일 앱 하단 탭에 '펀드' 탭이 노출됩니다. 끄면 탭에서 숨겨지며, 사용자는 기존 내정보 메뉴를 통해서만 접근할 수 있습니다."
  - 스위치 토글 시 `updateAppFeature('FUND_TAB', next)` 호출 및 Toast 피드백(`"펀드 탭 보이기"` / `"펀드 탭 숨기기"`).

---

### Step 4. 모바일 앱: 탭 연동 및 전용 화면 구현 (`mobile/`)

#### 4-1. 앱 기능 상태 훅 (`mobile/src/features/fund/use-app-features.ts`)
- `blogApi.get<{ fund_tab: boolean }>('/api/v1/app/features')` 호출.
- `useFocusEffect`로 화면 복귀 시 갱신, 기본값 `false`.
- `export function useFundTabVisible(): boolean` 제공.

#### 4-2. 탭 레이아웃 등록 (`mobile/src/app/(tabs)/_layout.tsx`)
- `const showFundTab = useFundTabVisible();`
- 탭 항목에 `fund` 추가:
  ```tsx
  <Tabs.Screen
    name="fund"
    options={{
      title: "펀드",
      ...(showFundTab ? {} : { href: null }),
      tabBarIcon: ({ color, size }) => (
        <Ionicons name="pie-chart-outline" color={color} size={size} />
      ),
    }}
  />
  ```
- 탭 순서: `index(홈)` ➔ `market(마켓)` ➔ `screener(스크리너)` ➔ `fund(펀드)` ➔ `community(커뮤니티)` ➔ `game(게임)` ➔ `profile(내정보)`.

#### 4-3. 신설 펀드 메인 탭 화면 (`mobile/src/app/(tabs)/fund.tsx`)
- **로그인/펀드 상태별 UI**:
  1. **비로그인**: 로그인 유도 카드 표시.
  2. **펀드 미등록 (`funds.length === 0`)**:
     - 펀드 현황 주소 등록 입력 폼 (이름, URL 추가).
     - Google Drive 백업 복원 버튼.
  3. **펀드 1개 이상 등록**:
     - **다수 등록 시**: 상단에 펀드 선택 칩(`Chip`) 제공.
     - **핵심 요약 카드 (`SummaryCard`)**:
       - 펀드명, 최종평가일 표기.
       - 현재평가금 (크고 굵은 텍스트).
       - 누적수익율 (% 소수점 2자리 + tone up/down 색상).
       - 당일 손익금 및 월 손익금 요약.
     - **최근 히스토리 섹션**:
       - 최근 5~10영업일 히스토리 리스트 간략 뷰.
       - "전체 히스토리 그래프 보기 →" 클릭 시 `/fund/history/[id]`로 이동.
     - **빠른 액션 버튼 모음**:
       - `리포트 상세` ➔ `router.push("/fund/" + fund.id)`
       - `기록 백업` ➔ `router.push("/fund/backup")`
       - `펀드 관리/추가` ➔ `router.push("/fund")`
  4. **당겨서 새로고침 (`usePullRefresh`)**:
     - `fundRefresher.run({ force: true })` 호출하여 즉시 최신 데이터 수집 및 히스토리 기록 동기화.

---

### Step 5. 최종 검증 및 테스트 확인

1. **테스트 통과 확인**:
   ```bash
   # 모바일 단위 테스트 및 타입 검사
   cd mobile && npx jest --no-watchman
   cd mobile && npm run typecheck

   # 백엔드 테스트
   cd backend && uv run pytest tests/test_app_features.py
   ```
2. **동작 검증**:
   - 관리자 웹에서 스위치를 껐을 때 폰 하단 탭 바에서 펀드 탭이 사라지는지 확인 (`href: null`).
   - 스위치를 켰을 때 하단 탭 바에 `펀드` 탭이 즉시 나타나는지 확인.
   - `내정보` ➔ `내 펀드 수익` 클릭 시 기존 화면이 정상 유지되는지 확인.
   - 펀드 조회 시 다양한 형태의 날짜 및 누적수익률이 히스토리 파일(`fund-history-<id>.json`)에 정상 누적되는지 확인.
