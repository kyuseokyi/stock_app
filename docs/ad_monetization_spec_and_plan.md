# 웹(AdSense) · 모바일(AdMob) 광고 수익화 기술 명세 및 구현 플랜

> **목적**: 사용자의 주식 차트 분석·실시간 트레이딩 게임·시황 열람 경험(UX)을 절대 해치지 않으면서, 웹(`web_client`)에는 **Google AdSense**를, 모바일(`mobile`, React Native Expo)에는 **Google AdMob**을 자연스럽게 통합하기 위한 전체 설계 명세서 및 Claude Code 작업 로드맵입니다.
>
> **사용자 사전 준비 가이드**: 계정 가입, 앱/도메인 등록, `ads.txt`·`app-ads.txt` 설정 및 환경변수 발급 절차는 [`docs/ad_monetization_setup_guide.md`](ad_monetization_setup_guide.md)를 참고하세요.

---

## 0. 핵심 원칙 (Non-Intrusive Ad UX & Regression Prevention)

1. **절대 침범 금지 구역 (Zero-Ad Zones)**
   - **실시간 차트 및 드로잉 영역**: 종목 상세(`/stock/:ticker`), 스크리너 차트 스플릿뷰, 트레이딩 게임(`/game`)의 캔들 차트·호가·주문 버튼 주변에는 **어떠한 배너나 전면 광고도 배치하지 않는다.**
   - **화면 전환 전면 광고(Interstitial) 전면 금지**: 종목 검색이나 탭 이동 시 화면을 덮는 전면 광고는 금융 앱 신뢰도와 즉시성을 훼손하므로 사용하지 않는다.
   - **앱 오프닝(App Open) 광고 금지**: 시세 확인을 위해 앱을 켤 때 딜레이를 유발하는 오프닝 광고를 배제한다.

2. **레이아웃 밀림 방지 (CLS = 0, Cumulative Layout Shift Zero)**
   - 광고가 늦게 로드되거나 로드에 실패(No-fill)하더라도 화면이 덜컥거리며 밀리지 않도록 **반드시 고정 높이(`min-height` / 고정 카드 규격) 컨테이너와 스켈레톤(Skeleton) 또는 자체 하우스 광고(House Ad) 폴백**을 적용한다.

3. **디자인 일체감 (Design System Integration)**
   - 웹([`DESIGN.md`](../DESIGN.md))과 모바일([`mobile/unistyles.ts`](../mobile/unistyles.ts))의 **파스텔 라벤더 테마(라이트/다크 모드)** 토큰(`surface`, `border`, `text`, `textSecondary`, `radius.card = 20px`)을 그대로 사용하여 광고가 이질적인 배너가 아닌 **하나의 정보 카드**처럼 보이게 한다.
   - 법적·플랫폼 정책 준수를 위해 카드 우측 상단에 작고 명확한 `광고` 또는 `AD` 배지(`chip` 스타일)를 표시한다.

4. **개발/상용 환경 완벽 분리 (Dev vs Prod Safety)**
   - **개발 환경(`development`)에서 실수로 실제 광고를 클릭해 계정이 정지(Invalid Traffic)되는 사고를 원천 차단**한다.
   - `APP_ENV !== 'production'`이거나 테스트 플래그가 켜진 경우, 모바일은 무조건 **Google 공식 Test Ad Unit ID**를 강제 사용하고, 웹은 `data-adtest="on"` 또는 **로컬 Mock 광고 카드**를 렌더링한다.

5. **네이티브 의존성 격리 (웹/모바일 번들 충돌 방지)**
   - 웹(`web_client`)에는 HTML `<script>` 기반 AdSense만 로드하고, 모바일(`mobile`)에는 네이티브 SDK(`react-native-google-mobile-ads`)만 사용한다.
   - 모바일 앱 내부의 WebView(`chart-web` 등) 안에는 절대 AdSense 스크립트를 넣지 않는다(Google 정책 위반 방지).

---

## 1. 플랫폼별 광고 배치 설계 (Placement Architecture)

### 1-1. 웹 클라이언트 (`web_client` — Google AdSense)

| 슬롯 식별자 (`slotKey`) | 노출 화면 및 파일 경로 | 위치 및 노출 조건 | 광고 포맷 | 고정 크기 / CLS 방지 |
| :--- | :--- | :--- | :--- | :--- |
| `WEB_HOME_SIDEBAR` | 홈 [`HomePage.tsx`](../web_client/src/pages/HomePage.tsx) | `<aside>` 추천 글 목록 하단 (`lg` 1024px 이상은 우측 칸, 좁은 화면은 페이지 맨 끝 — 2026-11-10 좁은 화면도 노출) | 디스플레이 / 멀티플렉스 카드 | `w-full min-h-[250px] rounded-card` |
| `WEB_POST_LIST_INFEED` | 커뮤니티 목록 [`PostListPage.tsx`](../web_client/src/pages/PostListPage.tsx) | 게시글 목록(`PAGE_SIZE = 10`) 중 **5번째 게시글 아래에 1회** 삽입 (게시글이 4개 이하일 때는 미노출) | 인피드(In-feed) 네이티브형 | 게시글 카드와 동일 (`min-h-[124px] rounded-card`) |
| `WEB_POST_DETAIL_BOTTOM` | 게시글 상세 [`PostDetailPage.tsx`](../web_client/src/pages/PostDetailPage.tsx) | 본문(`content`)이 끝나고 댓글 영역(`Comments`)으로 넘어가기 전 하단 여백 | 본문 내(In-article) / 가로형 배너 | `w-full min-h-[100px] rounded-card` |
| `WEB_SCREENER_FOOTER` | 스크리너 [`ScreenerPage.tsx`](../web_client/src/pages/ScreenerPage.tsx) | 시장/테마/업종 탭의 **전체 리스트 최하단** (차트 스플릿뷰 내부 제외) | 가로형 반응형 배너 | `w-full min-h-[90px] rounded-card` |

> **프리퀀시 캡(Frequency Rule)**: 웹 어느 화면에서든 한 뷰포트(Viewport) 안에 동시에 2개 이상의 광고가 보이지 않도록 배치한다.

---

### 1-2. 모바일 앱 (`mobile` — Google AdMob)

| 슬롯 식별자 (`slotKey`) | 노출 화면 및 파일 경로 | 위치 및 노출 조건 | 광고 포맷 | 디자인 / UX 처리 |
| :--- | :--- | :--- | :--- | :--- |
| `MOB_HOME_FEED_NATIVE` | 홈 탭 [`index.tsx`](../mobile/src/app/(tabs)/index.tsx) | 추천 글 `FlatList`의 4번째 아이템 뒤 또는 `ListFooterComponent` (추천 글 3개 이상일 때만 1개 노출) | **네이티브 어드밴스드** (`NativeAdView`) | [`BlogCard`](../mobile/src/features/blog/blog-card.tsx)와 동일한 패딩·폰트·다크모드 색상 적용 |
| `MOB_COMMUNITY_INFEED` | 커뮤니티 탭 [`community.tsx`](../mobile/src/app/(tabs)/community.tsx) | 게시글 `FlatList`에서 **7번째 아이템마다 1개** 삽입 (`index > 0 && (index + 1) % 7 === 0`) | **네이티브 어드밴스드** 또는 적응형 배너 | 스크롤 버벅임 방지를 위해 높이 고정(`minHeight: 116`) 및 메모이제이션(`React.memo`) 필수 |
| `MOB_POST_DETAIL_BOTTOM` | 글 상세 [`blog/[id].tsx`](../mobile/src/app/blog) | 본문 하단, 댓글 목록 위 | 적응형 인라인 배너 (`BannerAdSize.INLINE_ADAPTIVE_BANNER`) | 카드 컨테이너 내부에 배치, 로딩 실패 시 높이 0으로 부드럽게 축소 또는 하우스 배너 대체 |
| `MOB_GAME_REWARDED` *(선택·Phase 3b)* | 트레이딩 게임 [`game.tsx`](../mobile/src/app/(tabs)/game.tsx) · 야간 퀴즈 | **사용자 자발적 클릭 전용**: 야간 차트 퀴즈 오답 시 *"광고 보고 힌트/해설 먼저 보기"* 또는 시즌 파산 시 *"보너스 시드 리필"* 버튼 | **보상형 광고** (`RewardedAd`) | 강제 노출 절대 없음. 사용자가 버튼을 누른 경우에만 로드·재생 후 서버/클라이언트 보상 지급 |

---

## 2. 폴백(Fallback) 및 자체 하우스 광고(House Ad) 설계

AdSense/AdMob 심사 대기 중이거나, 광고 차단기(AdBlock) 사용, 혹은 광고 재고 부족(No-fill) 시 빈 공간이나 깨진 위젯이 보이지 않도록 **자체 하우스 배너(`HouseAdCard`)**를 기본 폴백으로 렌더링합니다.

### 하우스 배너 활용 예시 (앱 내 기능 자연스러운 홍보)
1. **트레이딩 게임 유도**: *"📈 실시간 차트 게임 시즌 진행 중 — 가상 1,000만 원으로 내 투자 MBTI를 확인해 보세요!"* (클릭 시 `/game` 이동)
2. **주도주 스크리너 유도**: *"🔍 오늘 시장에서 가장 강한 주도주 Top 10은? 스크리너에서 바로 확인하기"* (클릭 시 `/screener` 이동)
3. **알림 설정 유도**: *"🔔 중요 시황과 새 추천 글을 놓치지 마세요 — 알림 켜기"*

---

## 3. 백엔드 및 관리자 웹(`admin_web`) 원격 제어 명세 (Kill Switch)

스토어 재심사나 프론트엔드 재배포 없이 **관리자가 즉시 전체 광고 또는 특정 슬롯을 켜고 끌 수 있도록** 기존 [`ScreenerSettings.tsx`](../admin_web/src/pages/ScreenerSettings.tsx) 패턴과 동일한 경량 설정 구조를 추가합니다.

### 3-1. DB 모델 (`ad_configs` 테이블 — PostgreSQL)
- 파일 위치: `backend/shared/models.py` (및 Alembic 마이그레이션)

| 컬럼명 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `slot_key` | `String(50)` PK | - | `GLOBAL_WEB`, `GLOBAL_MOBILE`, `WEB_HOME_SIDEBAR`, `WEB_POST_LIST_INFEED`, `MOB_HOME_FEED_NATIVE`, `MOB_COMMUNITY_INFEED` 등 |
| `enabled` | `Boolean` | `False` | 활성화 여부 (초기값은 안전하게 `False` — 애드센스/애드몹 승인 후 관리자가 활성화) |
| `provider` | `String(20)` | `'HOUSE'` | `'GOOGLE'` (AdSense/AdMob 실광고) \| `'HOUSE'` (자체 하우스 배너만 표시) |
| `infeed_interval` | `Integer` | `7` | 인피드 슬롯일 때 몇 번째 글마다 노출할지 간격 (최소 4 이상 제약) |
| `house_title` | `String(120)` | Nullable | 하우스 배너 제목 |
| `house_description` | `String(255)` | Nullable | 하우스 배너 설명 문구 |
| `house_target_path` | `String(255)` | Nullable | 클릭 시 이동할 내부 경로 (예: `/game`, `/screener`) |
| `updated_at` | `DateTime` | `now()` | 마지막 변경 시각 |

### 3-2. API 엔드포인트 (`blog` 서비스 또는 공통 설정 라우터)
1. **공개 조회 API**: `GET /api/v1/ads/config`
   - 웹·모바일 클라이언트가 앱 시작 시(또는 5분 캐시) 조회.
   - 응답 예시:
     ```json
     {
       "web_enabled": true,
       "mobile_enabled": true,
       "slots": {
         "WEB_POST_LIST_INFEED": {
           "enabled": true,
           "provider": "GOOGLE",
           "infeed_interval": 5,
           "house": {
             "title": "실시간 차트 트레이딩 게임",
             "description": "가상 1,000만 원으로 실전 감각을 키워보세요.",
             "target_path": "/game"
           }
         }
       }
     }
     ```
2. **관리자 제어 API**:
   - `GET /api/v1/admin/ads/config` (관리자 JWT 필수)
   - `PUT /api/v1/admin/ads/config/{slot_key}` (슬롯 on/off, `GOOGLE`/`HOUSE` 모드 전환, 하우스 배너 문구 수정)

---

## 4. 클라이언트 상세 기술 스펙

### 4-1. 웹 클라이언트 (`web_client`)
1. **환경 변수 (`web_client/.env.development`, `.env.production`)**
   ```env
   VITE_ADSENSE_CLIENT_ID=ca-pub-XXXXXXXXXXXXXXXX
   VITE_ADSENSE_SLOT_HOME_SIDEBAR=1111111111
   VITE_ADSENSE_SLOT_POST_INFEED=2222222222
   VITE_ADSENSE_SLOT_POST_BOTTOM=3333333333
   VITE_ADSENSE_SLOT_SCREENER_FOOTER=4444444444
   ```
2. **스크립트 지연 로더 (`web_client/src/lib/adsense.ts`)**
   - `index.html`에 무조건 넣지 않고, 광고가 실제로 활성화된 경우에만 `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=..." crossorigin="anonymous">`를 동적 주입하여 초기 페이지 로딩 속도(LCP) 저하를 방지한다.
3. **공통 컴포넌트 (`web_client/src/components/ads/AdSlot.tsx`)**
   - Props: `slotKey`, `format` (`'auto' | 'fluid' | 'rectangle'`), `layoutKey` (인피드용), `className`
   - 동작 순서:
     1. 서버 설정(`useAdConfigStore`)에서 해당 `slotKey`가 `enabled: false`이면 `null` 반환(공간도 차지하지 않음).
     2. `provider === 'HOUSE'`이거나 개발 환경(`import.meta.env.DEV`), 또는 AdSense 스크립트가 차단(AdBlock)된 경우 `<HouseAdCard />`를 렌더링.
     3. `provider === 'GOOGLE'`이면 고정 `min-h` 컨테이너 내부에 `<ins className="adsbygoogle" ... />`를 렌더링하고 `useEffect`에서 `(window.adsbygoogle = window.adsbygoogle || []).push({})`를 안전하게 1회 호출(React 18 StrictMode 중복 push 방지 가드 포함).

### 4-2. 모바일 앱 (`mobile` — React Native Expo)
1. **패키지 및 네이티브 설정**
   - 설치 패키지: `react-native-google-mobile-ads` + `expo-tracking-transparency` (iOS 14.5+ ATT 권한 요청용)
   - ⚠️ **주의 (Fingerprint 변경)**: 네이티브 모듈이 추가되므로 `runtimeVersion` 지문이 변경된다. 따라서 최초 1회는 OTA(`eas update`)가 아닌 **네이티브 재빌드(`npm run prebuild:dev`, `build:android:devapk`, 스토어 빌드)**가 필수이다.
2. **`mobile/app.config.js` 플러그인 구성**
   - 환경변수(`EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`, `EXPO_PUBLIC_ADMOB_IOS_APP_ID`)가 없으면 **Google 공식 샘플 App ID**를 기본값으로 넣어 로컬 개발 빌드 시 크래시가 절대 나지 않도록 방어한다:
     - Android 테스트 App ID: `ca-app-pub-3940256099942544~3347511713`
     - iOS 테스트 App ID: `ca-app-pub-3940256099942544~1458002511`
   - 플러그인 설정 예시:
     ```javascript
     [
       'react-native-google-mobile-ads',
       {
         androidAppId: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? 'ca-app-pub-3940256099942544~3347511713',
         iosAppId: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ?? 'ca-app-pub-3940256099942544~1458002511',
         delayAppMeasurementInit: true,
         userTrackingUsageDescription: '맞춤형 금융 정보 및 관련성 높은 광고를 제공하기 위해 권한을 요청합니다.',
       },
     ]
     ```
3. **안전한 광고 유닛 ID 헬퍼 (`mobile/src/features/ads/ad-unit-ids.ts`)**
   - `__DEV__` 또는 `APP_ENV === 'development'`일 때는 무조건 `TestIds.BANNER`, `TestIds.NATIVE`, `TestIds.REWARDED`를 반환하도록 하드코딩 가드를 둔다.
4. **초기화 훅 (`mobile/src/features/ads/use-init-ads.ts`)**
   - 앱 첫 화면 렌더링 완료 후(`InteractionManager.runAfterInteractions`), iOS인 경우 `requestTrackingPermissionsAsync()`를 확인하고 `mobileAds().initialize()`를 비동기 호출하여 스플래시 화면 지연을 0ms로 유지한다.
5. **공통 컴포넌트 (`mobile/src/features/ads/`)**
   - `HouseAdCard.tsx`: Unistyles 테마(`theme.colors.surface`, `theme.colors.border`, `theme.radius.card`)를 사용하는 자체 배너 카드.
   - `InFeedAdCard.tsx`: [`BlogCard`](../mobile/src/features/blog/blog-card.tsx)와 동일한 레이아웃을 갖는 인피드 광고 컴포넌트. 광고 로드 실패(`onAdFailedToLoad`) 시 `<HouseAdCard />`로 즉시 전환.

---

## 5. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code(`CLAUDE.md`의 **Micro-Step Development** 규칙 준수)에서 아래 순서대로 한 단계씩 작업하고 검증 및 커밋을 진행합니다.

### 📍 Phase 1: 백엔드 & 관리자 광고 제어(Kill Switch) 및 하우스 광고 기반 구축
> Google 계정 승인 전에도 바로 배포·테스트할 수 있는 원격 제어 및 하우스 배너 시스템 구축

- [x] **Step 1-1 (Backend DB & API)** (2026-11-05, 슬롯은 §1 배치에 맞춰 전체 스위치 2 + 웹 4 + 앱 3 = 9행. 선택 항목인 `MOB_GAME_REWARDED` 제외):
  - `backend/shared/models.py`에 `AdConfig` 모델 추가 및 Alembic 마이그레이션 생성.
  - 기본 슬롯 6종(`GLOBAL_WEB`, `GLOBAL_MOBILE`, `WEB_HOME_SIDEBAR`, `WEB_POST_LIST_INFEED`, `WEB_POST_DETAIL_BOTTOM`, `MOB_HOME_FEED_NATIVE`, `MOB_COMMUNITY_INFEED`) 멱등 시드 추가 (기본 `enabled=False`, `provider='HOUSE'`).
  - `backend/apps/blog`에 공개 조회 `GET /api/v1/ads/config` 및 관리자 수정 `GET/PUT /api/v1/admin/ads/config` 라우터·서비스 구현 및 `pytest` 단위 테스트 작성.
- [x] **Step 1-2 (Admin Web UI)** (2026-11-05, `/app/ads`):
  - `admin_web/src/pages/AdSettingsPage.tsx` 생성 ([`ScreenerSettings.tsx`](../admin_web/src/pages/ScreenerSettings.tsx) UI 패턴 재사용).
  - 전체 웹/모바일 광고 마스터 스위치, 슬롯별 ON/OFF, `GOOGLE` vs `HOUSE` 모드 전환, 하우스 배너 문구/링크 편집 UI 구현 및 `tsc --noEmit` 통과 확인.

### 📍 Phase 2: 웹 클라이언트 (`web_client`) AdSense & 하우스 배너 연동
- [ ] **Step 2-1 (Web Ad 컴포넌트 & 로더)** — 하우스 배너 부분 완료(2026-11-09): `api/ads.ts`, 전역 스토어 대신 `hooks/useAdConfig.ts`(화면 진입마다 조회), `lib/ads.ts`(판정), `components/ads/AdSlot.tsx`(`HouseAdCard` 포함). 남은 것: `adsense.ts` 로더, GOOGLE 렌더링, `ads.txt`(상용 도메인 필요):
  - `web_client/src/api/ads.ts`, `web_client/src/store/adConfig.ts` 작성.
  - `web_client/src/lib/adsense.ts` (동적 스크립트 로더) 및 `HouseAdCard.tsx`, `AdSlot.tsx` 구현.
  - `web_client/public/ads.txt` 플레이스홀더 생성 (환경변수/운영 도메인 안내 주석 포함).
- [x] **Step 2-2 (Web 화면 3곳 자연스러운 배치)** (2026-11-09, 하우스 배너로. `WEB_SCREENER_FOOTER` 는 시장·테마·업종 목록이 마켓으로 옮겨졌고 지금 스크리너는 차트 스플릿뷰라 연결하지 않음):
  - [`HomePage.tsx`](../web_client/src/pages/HomePage.tsx): 우측 `<aside>` 추천 글 아래에 `WEB_HOME_SIDEBAR` 배치.
  - [`PostListPage.tsx`](../web_client/src/pages/PostListPage.tsx): 게시글 목록 5번째 아이템 뒤에 `WEB_POST_LIST_INFEED` 배치.
  - [`PostDetailPage.tsx`](../web_client/src/pages/PostDetailPage.tsx): 본문 하단·댓글 위에 `WEB_POST_DETAIL_BOTTOM` 배치.
  - Vitest 렌더링 테스트 및 `npm run build`(`tsc --noEmit`) 검증.

### 📍 Phase 3: 모바일 앱 (`mobile`) AdMob 네이티브 연동
- [ ] **Step 3-1 (Expo 플러그인 & SDK 초기화)**:
  - `mobile/package.json`에 `react-native-google-mobile-ads`, `expo-tracking-transparency` 설치.
  - `mobile/app.config.js`에 AdMob 플러그인 및 iOS ATT 권한 문구, 테스트 App ID 폴백 추가.
  - `mobile/.env.example`, `.env.development`, `.env.production`에 `EXPO_PUBLIC_ADMOB_*` 환경변수 정의.
- [ ] **Step 3-2 (Mobile 광고 컴포넌트 & 화면 연동)** — 하우스 배너 부분 완료(2026-11-09): `features/ads/{api,ad-config,use-ad-config,house-ad-card}`, 홈·커뮤니티·글 상세 연결(OTA 로 반영). 남은 것: `ad-unit-ids.ts`, `in-feed-ad-card.tsx`(AdMob, 네이티브 재빌드 필요):
  - `mobile/src/features/ads/` 하위에 `ad-unit-ids.ts`, `use-ad-config.ts`, `house-ad-card.tsx`, `in-feed-ad-card.tsx` 구현 (Unistyles 라이트/다크 테마 완벽 대응).
  - 홈 탭([`index.tsx`](../mobile/src/app/(tabs)/index.tsx)), 커뮤니티 탭([`community.tsx`](../mobile/src/app/(tabs)/community.tsx)), 블로그 상세([`blog/[id].tsx`](../mobile/src/app/blog))에 슬롯 연결.
  - `npm run typecheck`, `npm test` 통과 및 `npm run prebuild:dev:android`로 네이티브 빌드 설정 검증.
- [ ] **Step 3-3 (선택 — 게임 보상형 광고)**:
  - `mobile/src/features/ads/use-rewarded-ad.ts` 훅 구현 및 야간 차트 퀴즈 힌트/해설 열람 옵션에 자발적 보상형 광고 연동.

---

## 6. Claude Code 실행용 프롬프트 템플릿

Claude Code에서 작업을 시작할 때 아래 명령어를 그대로 복사해 입력하면 단계별로 안전하게 구현됩니다:

```text
docs/ad_monetization_spec_and_plan.md 문서를 읽고, Phase 1(Step 1-1, Step 1-2)부터 순서대로 Micro-Step 단위로 구현해줘.
기존 기능(Regression Prevention)에 영향이 없도록 하고, 각 Step 완료 시 테스트(pytest / tsc --noEmit) 실행 후 한국어로 요약 보고해줘.
```
