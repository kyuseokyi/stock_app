[명령어: 이 작업은 `mobile/` 디렉토리를 생성한 뒤 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 React Native (Expo) 모바일 앱의 뼈대와 핵심 UI(차트, 스크리너)를 구현하는 것입니다.

## [실행 단계 - Step by Step]
1. **초기화**: `stock_app/` 루트에서 `npx create-expo-app mobile` 명령어로 앱을 생성하고, 패키지들을 설치하세요.
2. **라이브러리 셋업**: `NativeWind` (TailwindCSS), `zustand`, `react-native-echarts`, `@expo/vector-icons`를 설치 및 설정하세요.
3. **[핵심] 빌드 및 환경 분리**: `eas.json`을 생성하여 `development`와 `production` 빌드 프로필을 구성하세요. (클라우드 빌드와 `--local` 로컬 빌드 양쪽 모두 완벽하게 동작하도록 구성해야 합니다.) 그리고 `app.json`을 `app.config.js`로 변경한 뒤, 환경변수(`process.env.APP_ENV`)에 따라 앱 이름(예: 'StockApp Dev', 'StockApp')과 `bundleIdentifier`(`com.stockapp.dev`, `com.stockapp`)가 동적으로 변경되어 기기에 동시 설치될 수 있도록 세팅하세요.
4. **네비게이션**: `expo-router`를 활용해 하단 탭(홈, 스크리너, 블로그, 관심종목, 내정보) 구조의 레이아웃을 작성하세요.
5. **스크리너 필터 UI**: '스크리너 탭'에서 Zustand 스토어를 생성해 필터 조건(예: RSI 범위 슬라이더) 상태를 관리하도록 하세요.
6. **ECharts 연동 및 드로잉**: '종목 상세 화면'에 `react-native-echarts` 캔들스틱 차트를 렌더링하세요.
   - **[필수] 차트 드로잉 도구 지원**: 모바일 환경에서도 사용자가 차트 위에 선을 긋거나 분석할 수 있도록 다음 도구를 툴바 형태로 제공하세요.
     1) **수평선 (Horizontal Line)**: 터치 시 해당 위치의 가격 표시.
     2) **이중 추세선 (Parallel Channel)**: 캔들 상/하단 연결 및 중심선 표시.
     3) **텍스트 박스**: 텍스트 메모 추가.
     4) **사각형 박스**: 밀집 구역 강조.
7. **API 호출**: `.env.development`의 API 주소를 호출하여 모의 데이터를 받아 차트 위에 이동평균선(MA)과 볼린저 밴드를 Overlay 하세요.
8. **검증**: `npx expo start` 후 터미널 로그와 렌더링 상태를 확인하며 디버깅하세요.
