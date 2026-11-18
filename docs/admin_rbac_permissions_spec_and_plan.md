# 관리자 등급별 권한 제어 (RBAC — 스크리너 · 데이터 업데이트 · 앱 관리) 기술 명세 및 구현 플랜

> **목적**: 모든 관리자(`role = ADMIN`)가 동일한 전체 권한을 갖던 기존 구조를 확장하여, **관리자 등급(`admin_tier`) 및 기능별 세부 권한(`permissions`)**에 따라 **스크리너 열람/설정, 시장 데이터 수동 수집·재계산, 앱 버전/강제 업데이트, 광고 설정, 블로그/게임 운영** 등의 주요 기능 접근을 세밀하게 지정·통제할 수 있는 RBAC(Role-Based Access Control) 시스템 명세서 및 Claude Code 구현 로드맵입니다.

---

## 0. 핵심 설계 원칙 (Regression Prevention & 유연한 권한 제어)

1. **기존 관리자 계정 100% 하위 호환 (Lockout 방지)**
   - 기존 시드 관리자(`admin@stock.app`) 및 마이그레이션 시점에 이미 `role = 'ADMIN'`인 계정은 자동으로 최고 등급인 **`SUPER_ADMIN` (모든 권한 허용)**으로 설정됩니다.
   - 따라서 본 기능 배포 직후 기존 관리자의 로그인이나 기능 사용이 막히는 부작용(Regression)이 절대 발생하지 않습니다.
2. **등급(Tier) 기본 권한 + 등급별 권한 커스터마이징 지원**
   - 관리자를 매번 개별 권한 수십 개로 설정하는 번거로움을 줄이기 위해 **4단계 관리자 등급(`SUPER_ADMIN`, `OPERATOR`, `ANALYST`, `EDITOR`)**을 제공합니다.
   - 동시에 최고 관리자(`SUPER_ADMIN`)가 관리자 웹(`admin_web`)에서 **각 등급별로 허용할 기능(스크리너, 데이터 업데이트, 앱 버전 관리 등)을 스위치/체크박스로 직접 켜고 끌 수 있으며**, 특정 관리자에게 개별 권한 오버라이드도 지정할 수 있습니다.
3. **프론트엔드 UI 숨김 + 백엔드 API 403 이중 방어**
   - 관리자 웹(`admin_web`) 사이드바와 라우터에서 권한이 없는 메뉴/버튼을 숨기거나 비활성화할 뿐 아니라, 백엔드 FastAPI 라우터에서도 `require_admin_permission(...)` 가드로 검증하여 우회 호출을 원천 차단합니다.

---

## 1. 관리자 등급(Tier) 및 기능별 권한(Permission Scope) 정의

### 1-1. 관리자 등급 (`AdminTier`) 기본 구성

| 등급 코드 (`admin_tier`) | 표기 이름 | 기본 역할 설명 | 기본 부여 권한 (최고 관리자가 UI에서 변경 가능) |
| :--- | :--- | :--- | :--- |
| **`SUPER_ADMIN`** | 👑 최고 관리자 | 시스템 전체 통제 및 다른 관리자 등급·권한 부여 (수정 불가 고정 전권) | **전체 권한 (`*`)** |
| **`OPERATOR`** | 🛠️ 운영 관리자 | 앱 데이터 업데이트·스크리너·블로그·게임 등 실무 전반 운영 | `SCREENER_VIEW`, `SCREENER_SETTINGS`, `DATA_PIPELINE`, `APP_UPDATE_MANAGE`, `AD_MANAGE`, `CONTENT_MANAGE`, `GAME_MANAGE` |
| **`ANALYST`** | 📊 분석/스크리너 관리자 | 장 마감 후 **스크리너(주도주·5·20 정배열·조건검색·패턴) 분석** 및 시황/블로그 작성 | `SCREENER_VIEW`, `CONTENT_MANAGE`, `GAME_MANAGE` *(데이터 강제 재수집·앱 버전/점검 제어 제외)* |
| **`EDITOR`** | ✍️ 콘텐츠 에디터 | 블로그 게시글 작성·댓글 신고 처리·데일리 코치/퀴즈 편집만 담당 | `CONTENT_MANAGE`, `GAME_MANAGE` *(스크리너·데이터 업데이트·앱 버전·광고 설정 제외)* |

*(일반 회원(`user.role != 'ADMIN'`)은 `admin_tier = NULL`이며 관리자 웹 접근 자체가 차단됩니다.)*

---

### 1-2. 제어 대상 주요 기능 권한 키 (`AdminPermissionKey`)

| 권한 키 (`permission_key`) | 권한명 | 제어 대상 화면 (`admin_web`) | 제어 대상 백엔드 API |
| :--- | :--- | :--- | :--- |
| **`SCREENER_VIEW`** | **스크리너 열람 및 데이터 검증** | • `주도주` (`/market/leaders`)<br>• `5·20 정배열 스크리너` (`/market/ma-screener`)<br>• `조건검색` (`/market/finder`)<br>• `차트 패턴` (`/market/patterns`)<br>• `데이터 검증` (`/market/verify`) | `GET /api/v1/admin/market/verify/*` 및 관리자 전용 스크리너 조회 |
| **`SCREENER_SETTINGS`** | **사용자 스크리너 노출 스위치 제어** | • `스크리너 탭 설정` (`/market/screener`) | `PUT /api/v1/admin/screener/features/*` |
| **`DATA_PIPELINE`** | **앱 데이터 업데이트 (수집·재계산·테마보정)** | • `데이터 현황` (`/market/status`)의 **[수집/재계산 실행] 버튼**<br>• `테마 보정` (`/market/themes`) | `POST /api/v1/admin/market/jobs/*`<br>`POST/PUT/DELETE /api/v1/admin/themes/*` |
| **`APP_UPDATE_MANAGE`** | **앱 버전 · 강제 업데이트 · 점검 모드 제어** | • `앱 버전 & 업데이트` (`/app/versions`) | `PUT /api/v1/admin/app-versions/*` |
| **`AD_MANAGE`** | **광고 수익화 설정 제어** | • `광고 설정` (`/app/ads`) | `PUT /api/v1/admin/ads/*` |
| **`CONTENT_MANAGE`** | **블로그 · 게시판 · 신고 · 펀드알림 관리** | • `게시판 관리` (`/boards`), `게시글 관리` (`/blogs`)<br>• `신고 관리` (`/reports`), `펀드 리포트 알림` (`/fund-notices`) | `apps/blog` 내 관리자 생성·수정·삭제·발송 API |
| **`GAME_MANAGE`** | **트레이딩 게임 · 코치 · 퀴즈 관리** | • `데일리 코치` (`/game/coach`), `아카데미` (`/game/academy`)<br>• `퀴즈 관리` (`/game/quizzes`), `게임 설정` (`/game/settings`) | `apps/trading_game` 내 관리자 API |
| **`ADMIN_ROLE_MANAGE`** | **관리자 등급 및 권한 정책 관리** | • `회원 관리` (`/members`) 내 등급 변경<br>• `관리자 권한 설정` (`/admin/roles`) | `PUT /api/v1/auth/admin/users/{id}/role`<br>`PUT /api/v1/auth/admin/role-policies/{tier}` (`SUPER_ADMIN` 전용) |

---

## 2. 데이터베이스 및 백엔드 (`backend`) 명세

### 2-1. DB 스키마 변경 (`backend/shared/models.py` + Alembic 마이그레이션)

1. **`users` 테이블 컬럼 추가**:
   - `admin_tier`: `String(30)`, Nullable (기본값: `None`, `role == 'ADMIN'`인 기존 행은 마이그레이션에서 `'SUPER_ADMIN'`으로 백필)
   - `custom_permissions`: `Text` (JSON 배열 문자열, Nullable — 등급 기본 권한 외에 개별 추가/제외할 권한 목록, 기본 `None`)

2. **`admin_tier_policies` 테이블 신설 (등급별 권한 매핑 원장)**:
   | 컬럼명 | 타입 | 제약 | 설명 |
   | :--- | :--- | :--- | :--- |
   | `tier` | `String(30)` | PK | `'SUPER_ADMIN'`, `'OPERATOR'`, `'ANALYST'`, `'EDITOR'` |
   | `label` | `String(50)` | Not Null | 등급 표시 이름 (예: `'분석/스크리너 관리자'`) |
   | `permissions_json` | `Text` | Not Null | 허용된 `permission_key` JSON 배열 (예: `["SCREENER_VIEW", "CONTENT_MANAGE"]`) |
   | `updated_at` | `DateTime(timezone=True)` | Not Null | 마지막 수정 시각 |

### 2-2. 권한 해석 및 FastAPI 의존성 가드 (`backend/shared/auth.py`)

1. **유효 권한 계산 함수 `resolve_admin_permissions(user: User, tier_policies: dict) -> set[str]`**:
   - `user.role != UserRole.ADMIN`이면 빈 집합 `set()` 반환.
   - `user.admin_tier`가 없거나 `'SUPER_ADMIN'`이면 **전체 권한 키 집합(`ALL_ADMIN_PERMISSIONS`)** 반환 (하위 호환 보장).
   - 그 외 등급(`OPERATOR`, `ANALYST`, `EDITOR`)은 `admin_tier_policies` 테이블의 권한 목록 + `user.custom_permissions`(있을 경우)를 합산해 반환.
2. **권한 검증 의존성 팩토리 `require_permission(perm: str)`**:
   ```python
   def require_permission(perm: str):
       async def _guard(
           user: User = Depends(require_admin),
           db: AsyncSession = Depends(get_db),
       ) -> User:
           perms = await get_user_permissions(db, user)
           if perm not in perms:
               raise HTTPException(
                   status.HTTP_403_FORBIDDEN,
                   {"code": "INSUFFICIENT_ADMIN_PERMISSION", "required": perm, "message": "해당 기능에 대한 관리자 권한이 없습니다."},
               )
           return user
       return _guard
   ```
3. **`UserOut` / `AdminUserOut` 응답 확장 (`backend/apps/auth/schemas.py`)**:
   - `/api/v1/auth/me` 및 관리자 회원 목록 응답에 아래 필드를 추가합니다:
     - `admin_tier: str | None`
     - `permissions: list[str]` (현재 사용자가 보유한 최종 권한 키 배열)

### 2-3. 관리자 등급·권한 관리 API (`backend/apps/auth/routers/admin_roles.py`)
- `GET /api/v1/auth/admin/role-policies`: 등급별 권한 매트릭스 및 전체 권한 키 메타데이터 조회 (`require_admin`)
- `PUT /api/v1/auth/admin/role-policies/{tier}`: 특정 등급(`OPERATOR`, `ANALYST`, `EDITOR`)의 허용 권한 목록 수정 (`require_permission("ADMIN_ROLE_MANAGE")`)
- `PATCH /api/v1/auth/admin/users/{user_id}/admin-role`: 특정 회원의 `role`(`FREE` ↔ `ADMIN`) 및 `admin_tier`(`SUPER_ADMIN` / `OPERATOR` / `ANALYST` / `EDITOR`), `custom_permissions` 지정 (`require_permission("ADMIN_ROLE_MANAGE")`, 자기 자신의 `SUPER_ADMIN` 박탈 금지 안전장치 포함)
- `POST /api/v1/auth/admin/users`: 최고 관리자가 이메일·비밀번호·닉네임·관리자 등급(`OPERATOR` / `ANALYST` / `EDITOR` / `SUPER_ADMIN`)을 입력해 새 관리자 계정을 직접 생성하는 API (`require_permission("ADMIN_ROLE_MANAGE")`)

### 2-4. 첫 번째 최고 관리자(`SUPER_ADMIN`) 생성 및 부트스트랩 방법

1. **자동 마이그레이션 승격 (이미 운영/개발 중인 DB)**:
   - Alembic 마이그레이션(`alembic upgrade head`) 실행 시 아래 SQL이 자동 실행되어, **기존에 이미 생성되어 있던 `role = 'ADMIN'` 계정(예: `admin@stock.app`)은 별도 명령어 없이 즉시 `admin_tier = 'SUPER_ADMIN'`(최고 관리자)으로 자동 지정**됩니다:
     ```sql
     UPDATE users SET admin_tier = 'SUPER_ADMIN' WHERE role = 'ADMIN' AND admin_tier IS NULL;
     ```
2. **시드 스크립트 실행 (최초 구축 또는 비밀번호/등급 초기화 시 — [`backend/apps/auth/seed_admin.py`](../backend/apps/auth/seed_admin.py))**:
   - [`seed_admin.py`](../backend/apps/auth/seed_admin.py)가 실행될 때 `role = UserRole.ADMIN`과 함께 **`user.admin_tier = "SUPER_ADMIN"`**을 명시적으로 설정하고, 4개 등급 기본 권한 정책(`admin_tier_policies`)도 함께 멱등(Idempotent) 시드하도록 확장합니다:
     ```bash
     cd backend
     # 기본값: admin@stock.app / admin1234 (환경변수 ADMIN_EMAIL, ADMIN_PASSWORD 로 변경 가능)
     uv run python -m apps.auth.seed_admin
     ```
3. **두 번째 이후 관리자 추가 방법 (2가지 경로 모두 지원)**:
   - **경로 A (관리자 웹에서 직접 계정 생성)**: 최고 관리자로 로그인 후 `관리자 권한 설정(/admin/roles)` 또는 `회원 관리(/members)`의 **`[+ 새 관리자 계정 만들기]`** 버튼을 눌러 이메일·비밀번호·등급(`운영 관리자` / `분석 관리자` / `에디터`)을 지정해 즉시 생성.
   - **경로 B (기존 가입 회원 승격)**: 일반 웹/앱에서 소셜 로그인으로 가입한 회원을 `회원 관리(/members)`에서 검색해 등급 드롭다운으로 관리자 등급 부여.

---

## 3. 관리자 웹 (`admin_web`) UI 명세

### 3-1. 권한 기반 사이드바 필터링 및 라우트 가드
- **사이드바 ([`admin_web/src/components/Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx))**:
  - 각 `NavItem`에 선택적 필드 `requiredPermission?: AdminPermissionKey`를 부여합니다.
  - 예:
    - `주도주`, `5·20 정배열 스크리너`, `조건검색`, `차트 패턴`, `데이터 검증` → `requiredPermission: 'SCREENER_VIEW'`
    - `스크리너 탭` → `requiredPermission: 'SCREENER_SETTINGS'`
    - `테마 보정`, `데이터 현황` → `requiredPermission: 'DATA_PIPELINE'` (또는 `데이터 현황` 조회는 `SCREENER_VIEW`도 허용하되 **[수집/재계산 실행] 버튼**은 `DATA_PIPELINE` 권한이 있을 때만 활성화)
    - `앱 버전 & 업데이트` → `requiredPermission: 'APP_UPDATE_MANAGE'`
    - `광고 설정` → `requiredPermission: 'AD_MANAGE'`
    - `관리자 권한 설정` (`/admin/roles`) → `requiredPermission: 'ADMIN_ROLE_MANAGE'`
  - 현재 로그인한 관리자의 `user.permissions`에 해당 권한이 없으면 사이드바 메뉴에서 자동으로 숨깁니다.
- **상단 헤더 배지 ([`admin_web/src/components/Layout.tsx`](../admin_web/src/components/Layout.tsx))**:
  - 우측 상단 닉네임 옆에 단순 `ADMIN` 대신 등급 배지(`최고관리자`, `운영관리자`, `분석관리자`, `에디터`)를 표시합니다.

### 3-2. 신규 화면 1: `관리자 등급·권한 설정` (`/admin/roles` — `AdminRolesPage.tsx`)
- 사이드바 `'회원 관리'` 그룹 아래에 **`🔐 관리자 권한 설정` (`/admin/roles`)** 메뉴를 추가합니다.
- **상단 `[+ 새 관리자 계정 생성]` 모달/폼**: 이메일, 비밀번호, 닉네임, 부여할 등급(`OPERATOR` / `ANALYST` / `EDITOR` / `SUPER_ADMIN`)을 입력해 새 관리자를 바로 생성할 수 있습니다.
- **등급별 권한 매트릭스 표**:
  - 행(Row): 8대 주요 권한(`스크리너 열람`, `스크리너 탭 스위치`, `앱 데이터 수집·재계산`, `앱 버전·점검 관리`, `광고 설정`, `블로그·신고·알림 관리`, `트레이딩 게임 관리`, `관리자 권한 관리`)
  - 열(Column): `👑 최고 관리자(고정)` | `🛠️ 운영 관리자` | `📊 분석/스크리너 관리자` | `✍️ 콘텐츠 에디터`
  - 각 셀의 토글 스위치를 클릭해 등급별로 어떤 기능을 허용할지 즉시 변경하고 `[저장]`할 수 있습니다.

### 3-3. 기존 화면 확장: `회원 관리` (`/members` — [`MembersPage.tsx`](../admin_web/src/pages/MembersPage.tsx))
- 최고 관리자(`ADMIN_ROLE_MANAGE` 보유자)가 회원 목록에서 각 회원의 **등급 드롭다운(`일반 회원` / `에디터` / `분석·스크리너 관리자` / `운영 관리자` / `최고 관리자`)**을 선택해 즉시 권한을 부여·변경할 수 있게 합니다.

---

## 4. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 Micro-Step 순서대로 구현 및 테스트를 진행합니다.

### 📍 Step 1: 백엔드 DB 모델(`admin_tier`, `admin_tier_policies`), `seed_admin.py` 및 권한 가드(`require_permission`) 구현
- [ ] `backend/shared/models.py`에 `User.admin_tier`, `User.custom_permissions` 및 `AdminTierPolicy` 모델 추가 + Alembic 마이그레이션 작성(기존 `ADMIN` 유저는 `'SUPER_ADMIN'` 자동 백필 및 4개 등급 기본 정책 시드).
- [ ] [`backend/apps/auth/seed_admin.py`](../backend/apps/auth/seed_admin.py)가 실행될 때 첫 번째 관리자에게 `admin_tier = 'SUPER_ADMIN'`을 설정하도록 업데이트.
- [ ] `backend/shared/auth.py`에 `ALL_ADMIN_PERMISSIONS`, `get_user_permissions`, `require_permission(perm)` 구현.
- [ ] `backend/apps/auth`에 `/api/v1/auth/me` 권한 배열 반환, `GET/PUT /api/v1/auth/admin/role-policies`, `PATCH /api/v1/auth/admin/users/{id}/admin-role`, `POST /api/v1/auth/admin/users`(신규 관리자 생성) 구현 및 `pytest` 단위 테스트 검증.

### 📍 Step 2: 주요 서비스(`stock_api`, `blog`, `trading_game`) 관리자 API에 세부 권한 가드 연결
- [ ] `stock_api`의 데이터 수집/재계산(`market_admin.py` `POST /jobs/*`) 및 테마 수정(`themes_admin.py`)에 `require_permission("DATA_PIPELINE")` 적용.
- [ ] `stock_api`의 스크리너 탭 스위치(`screener_admin.py`)에 `require_permission("SCREENER_SETTINGS")` 적용.
- [ ] `blog`의 앱 버전 수정(`app_versions`)에 `require_permission("APP_UPDATE_MANAGE")`, 광고 설정 수정(`ads`)에 `require_permission("AD_MANAGE")` 적용.
- [ ] 백엔드 전체 `pytest` 통과 확인.

### 📍 Step 3: 관리자 웹(`admin_web`) 권한별 메뉴 제어 및 `AdminRolesPage` · `MembersPage` 등급 설정 UI 구현
- [ ] `admin_web/src/types/api.ts` 및 `admin_web/src/api/auth.ts`에 `admin_tier`, `permissions`, `hasPermission(perm)` 헬퍼 추가 (초기 로그인 시 및 새로고침 시 `/auth/me`로 최신 권한 동기화).
- [ ] `admin_web/src/pages/AdminRolesPage.tsx` (`/admin/roles` — 신규 관리자 계정 생성 폼 + 등급별 권한 매트릭스 편집 UI) 생성 및 [`MembersPage.tsx`](../admin_web/src/pages/MembersPage.tsx)에 회원별 관리자 등급 변경 드롭다운 추가.
- [ ] [`Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx)에서 권한별 메뉴 노출 제어 및 [`MarketStatus.tsx`](../admin_web/src/pages/MarketStatus.tsx)의 수동 수집/재계산 버튼에 `DATA_PIPELINE` 권한 체크 적용.
- [ ] `cd admin_web && npm run build && npm run lint` 통과 검증.

---

## 5. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 복사해 입력하면 Step 1부터 Step 3까지 안전하게 구현됩니다:

```text
docs/admin_rbac_permissions_spec_and_plan.md 문서를 읽고, Step 1부터 Step 3까지 순서대로 Micro-Step 단위로 구현해줘.
기존 관리자 계정(admin@stock.app 등)은 자동으로 SUPER_ADMIN(전 권한)이 되도록 하위 호환성을 보장하고, 관리자 등급별로 스크리너 열람, 앱 데이터 업데이트(수집/재계산), 앱 버전 관리 등의 권한을 지정·제어할 수 있도록 백엔드(pytest)와 admin_web(tsc --noEmit / build)을 구현 및 검증한 뒤 한국어로 보고해줘.
```
