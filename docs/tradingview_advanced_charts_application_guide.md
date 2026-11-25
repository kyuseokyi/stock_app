# TradingView Advanced Charts (Charting Library) 라이선스 신청 가이드

> **작성일**: 2026-11-25  
> **목적**: FunNote(`funnotedaily.com`) 서비스에 TradingView의 설치형 고급 차트 라이브러리(**Advanced Charts**, 구 Charting Library) 무료 라이선스를 신청하고 승인받기 위한 사전 체크리스트 및 신청서 작성 가이드.

---

## 1. 신청 전 필수 준비 사항 체크리스트

TradingView 심사팀은 신청서를 사람이 직접 검토하여 비공개 GitHub 저장소(`tradingview/charting_library`) 접근 권한을 부여합니다. 반려(Reject)를 피하려면 아래 4가지가 반드시 준비되어 있어야 합니다.

- [x] **1. 고유 도메인 비즈니스 이메일**:
  * `@gmail.com`, `@naver.com` 등 무료 포털 이메일은 즉시 거절됩니다.
  * 반드시 **`support@funnotedaily.com`** (Cloudflare 이메일 라우팅 설정 완료된 도메인 메일)을 사용하세요.
  * **주의**: 신청 후 이 메일로 **DocuSign 전자계약서 링크**가 오며, 메일 답장을 보내야 할 수도 있습니다.(Cloudflare 이메일 라우팅은 수신 전용이므로, 회신이 필요할 경우를 대비해 Gmail의 '다른 주소에서 메일 보내기(Send mail as)' 설정이나 임시 발신 설정을 해두면 좋습니다.)
- [x] **2. 공개 접속 가능한 실제 웹사이트 (`https://app.funnotedaily.com`)**:
  * 심사 담당자가 신청서에 적힌 URL에 직접 접속해 실제 운영 중인 금융/투자 관련 웹사이트인지 확인합니다.
  * 신청 기간 동안 **`https://app.funnotedaily.com`** 과 **`https://funnotedaily.com`**(301 리다이렉트)이 정상적으로 열려 있어야 하며, 비로그인 상태에서도 서비스(홈·시황·교육용 종가 게임 등)를 둘러볼 수 있어야 합니다.
- [ ] **3. GitHub 계정 준비**:
  * 라이선스 계약이 승인되면 TradingView가 신청서에 적은 **GitHub Username**을 비공개 저장소에 초대합니다. 본인 GitHub 아이디(예: `kyuseok` 등)를 정확히 확인해 두세요.
- [ ] **4. 라이선스 핵심 의무 숙지**:
  * 무료 라이선스 조건상 차트 내 **TradingView 로고 및 링크(Attribution)를 숨기거나 제거하면 안 됩니다.**
  * 차트가 들어가는 화면은 일반 대중(Public)이 접근할 수 있는 서비스여야 합니다 (사내/관리자 전용 내부 툴 용도로만 적으면 무료 라이선스가 거절됩니다).

---

## 2. 단계별 신청 절차 및 항목별 입력 템플릿

### Step 1: 공식 신청 페이지 접속
1. 브라우저에서 **[https://www.tradingview.com/advanced-charts/](https://www.tradingview.com/advanced-charts/)** 에 접속합니다.
2. 화면 중앙 또는 우측 상단의 **[Get the library]** (또는 **[Request access]**) 버튼을 클릭합니다.

---

### Step 2: 신청 폼(Application Form) 입력 가이드
신청 폼의 각 항목에 아래와 같이 영문으로 입력하시면 승인 확률이 가장 높습니다.

| 항목 (영문 필드명) | 입력할 값 (복사해서 사용) | 설명 및 주의사항 |
| :--- | :--- | :--- |
| **Company Name** | `FunNote` (사업자 등록이 있다면 공식 영문 상호명) | 서비스/조직 이름 |
| **Company Website** | `https://app.funnotedaily.com` | 반드시 지금 바로 접속되는 공개 웹 주소를 입력 |
| **Target URLs / Domains** | `funnotedaily.com, app.funnotedaily.com` | 차트가 실제로 렌더링될 도메인 |
| **Work / Business Email** | `support@funnotedaily.com` | 도메인 이메일 필수 (`gmail/naver` 절대 금지) |
| **First Name / Last Name** | 본인 영문 이름 / 영문 성 (여권/신분증과 동일) | 전자서명(DocuSign) 계약서에 들어갈 실명 |
| **Job Title / Role** | `Founder & Lead Developer` (또는 `CEO`) | 계약 서명 권한이 있는 직책 |
| **Country / Address** | `South Korea` 및 실제 주소(영문) | 계약서 상의 소재지 |
| **GitHub Username** | `<본인의 GitHub ID>` (예: `@` 없이 아이디만) | `charting_library` 저장소 초대장을 받을 계정 |
| **Platform** | `Web` & `Mobile (WebView)` 체크 | 웹(`web_client`) 및 모바일 앱(`mobile`) 모두 활용 |
| **Do you have your own data?** | **`Yes`** | **가장 중요!** Advanced Charts는 시세를 주지 않으므로 "자체 데이터(합성 시세/자체 DB)가 있다"에 반드시 `Yes`를 선택해야 합니다. |

---

### Step 3: 프로젝트/활용 목적 설명란 (How will you use the library?) 영문 템플릿

신청서에 **"서비스 설명 또는 라이브러리 활용 목적(Project Description / Use Case)"**을 적는 칸이 나오면 아래 영문 문구를 그대로 복사해서 넣으세요:

```text
FunNote (https://app.funnotedaily.com) is a public financial education, market briefing, and simulated stock trading platform for retail investors in South Korea.
We currently use TradingView Lightweight Charts and want to upgrade to TradingView Advanced Charts to provide richer technical analysis tools (moving averages, Bollinger Bands, volume profile, and drawing tools) for our daily chart trading simulation game and market analysis pages.
We supply our own OHLCV market and synthetic educational data from our backend via a custom Datafeed API, and the charts will be publicly accessible to our users with full TradingView attribution.
```

*(한국어 의미: FunNote는 한국 개인 투자자를 위한 공개 금융 교육, 시황 브리핑 및 모의 트레이딩 플랫폼입니다. 현재 TradingView Lightweight Charts를 사용 중이며, 일일 차트 트레이딩 시뮬레이션 게임과 시황 분석 화면에서 더 풍부한 기술적 분석 도구와 드로잉 툴을 제공하기 위해 Advanced Charts로 업그레이드하고자 합니다. 당사 백엔드의 자체 OHLCV 및 교육용 합성 데이터를 자체 Datafeed API로 연결하며, TradingView 출처 표기를 준수하여 공개 사용자에게 제공합니다.)*

---

## 3. 제출 후 승인 및 다운로드 프로세스

1. **이메일 확인 & 전자계약서(DocuSign) 서명 (제출 후 1~3영업일)**:
   * `support@funnotedaily.com`으로 TradingView에서 라이선스 계약서(**DocuSign**) 이메일이 도착합니다.
   * 메일 내 링크를 열어 이름·서명을 클릭해 완료합니다.
2. **GitHub 비공개 저장소 초대 수락 (서명 후 1~2영업일)**:
   * 신청서에 적은 GitHub 계정(및 GitHub에 등록된 이메일)으로 `tradingview/charting_library` 저장소 초대장이 옵니다.
   * **[Accept Invitation]**을 누르면 `https://github.com/tradingview/charting_library` 에 접속하여 `charting_library` 번들 파일(`charting_library.standalone.js` 및 `bundles/` 폴더)을 다운로드할 수 있습니다.
3. **우리 프로젝트에 연동하는 방법 (승인 완료 후)**:
   * 다운로드한 `charting_library/` 정적 파일들을 `web_client/public/charting_library/` (및 `admin_web/public/charting_library/`)에 넣습니다.
   * 주의: 라이선스 약관상 `charting_library` 원본 파일 자체는 공개(Public) GitHub 저장소에 올리면 안 되므로, 우리 저장소가 Private인지 확인하거나 빌드 아티팩트로 관리합니다.
   * 파일이 준비되면 클로드 코드(Claude Code)에게 **"다운로드한 Advanced Charts(`charting_library`)를 우리 백엔드 캔들 API(Datafeed)와 연결해줘"**라고 지시하면 즉시 연동할 수 있습니다.
