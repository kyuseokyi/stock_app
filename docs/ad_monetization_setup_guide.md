# 광고 수익화 사전 준비 가이드 (Google AdSense · AdMob 설정 체크리스트)

> 이 문서는 코드 구현([`docs/ad_monetization_spec_and_plan.md`](ad_monetization_spec_and_plan.md))과 별개로, **프로젝트 소유자(사용자)가 직접 Google 콘솔 및 스토어에서 준비해야 하는 계정·키·정책 설정 절차**를 단계별로 정리한 가이드입니다.
>
> 💡 **중요**: 아래 Google 계정 승인이 완료되기 전이라도, **코드 구현(Phase 1~3)은 Google 공식 테스트 ID와 자체 하우스 배너(House Ad)로 먼저 100% 개발·배포**할 수 있습니다. 승인 완료 후 환경변수(`.env.production`)에 실제 ID만 넣고 관리자 웹(`admin_web`)에서 스위치를 켜면 즉시 실광고가 송출됩니다.

---

## 0. 내가 준비해야 할 항목 한눈에 보기 (요약 체크리스트)

| 순서 | 구분 | 준비 항목 | 발급 결과물 (코드/환경변수에 넣을 값) | 필수 시점 |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **웹 (AdSense)** | Google AdSense 가입 및 웹 도메인 연결 | 게시자 ID (`ca-pub-XXXXXXXXXXXXXXXX`) | 웹 실광고 송출 전 |
| **2** | **웹 (AdSense)** | `ads.txt` 파일 웹 루트 배포 확인 | `https://<도메인>/ads.txt` 접속 가능 여부 | AdSense 심사 시 |
| **3** | **웹 (AdSense)** | 광고 단위(Ad Unit) 3~4개 생성 | 슬롯 ID (`1111111111` 등 숫자 10자리) | 웹 실광고 송출 전 |
| **4** | **모바일 (AdMob)** | Google AdMob 가입 및 Android/iOS 앱 등록 | 앱 ID (`ca-app-pub-XXXX~YYYY` 형태 2개) | 상용 앱 빌드 전 |
| **5** | **모바일 (AdMob)** | AdMob 광고 단위(네이티브·배너·보상형) 생성 | 광고 단위 ID (`ca-app-pub-XXXX/ZZZZ` 형태) | 상용 앱 빌드 전 |
| **6** | **모바일 (AdMob)** | `app-ads.txt` 파일 웹 도메인 루트에 배치 | `https://<개발자웹사이트>/app-ads.txt` | 스토어 출시 후 |
| **7** | **스토어 정책** | Google Play 데이터 보안 & iOS 개인정보 보호 명시 | 광고 ID(ADID/IDFA) 수집 여부 체크 | 스토어 심사 제출 시 |

---

## 1. 웹 광고 준비: Google AdSense (애드센스)

### 1-1. AdSense 계정 가입 및 사이트 등록
1. <https://adsense.google.com> 에 접속해 Google 계정으로 가입합니다.
2. **사이트(Sites) → 새 사이트 추가**에서 실제 운영할 웹 도메인(예: `stockapp.kr` 또는 현재 운영 도메인)을 입력합니다.
3. **계정 → 설정 → 계정 정보**에서 **게시자 ID**(`pub-XXXXXXXXXXXXXXXX`)를 확인해 메모합니다.

### 1-2. `ads.txt` 설정 (도메인 소유권 확인)
1. AdSense 콘솔에서 제공하는 `ads.txt` 한 줄 스니펫을 복사합니다:
   ```text
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```
2. 이 내용을 `web_client/public/ads.txt` 파일에 붙여넣고 배포하면, `https://<도메인>/ads.txt` 경로로 크롤러가 자동 확인합니다.

### 1-3. 주식 웹앱 AdSense 승인 꿀팁 ("가치 있는 인벤토리" 심사 통과)
- 구글 애드센스 크롤러는 **로그인 없이 접근 가능한 텍스트 콘텐츠**의 양과 품질을 봅니다.
- 차트 숫자만 있는 화면만 열려 있으면 *"콘텐츠 부족"*으로 거절될 수 있으므로, 심사 요청 전에 **커뮤니티/블로그 게시판에 시황 분석 글이나 투자 가이드 게시글을 최소 15~20개 이상 공개 상태로 작성**해 두는 것이 빠른 승인의 핵심입니다.
- 심사 기간 중에는 **자동 광고(Auto Ads)**를 잠시 켜두었다가, 승인 완료 후 **자동 광고는 끄고(UX 보호)** 아래 1-4의 수동 광고 단위만 사용하는 것을 강력히 권장합니다.

### 1-4. AdSense 수동 광고 단위 생성
AdSense 콘솔 **광고 → 광고 단위 기준(By ad unit)** 메뉴에서 아래 3가지를 생성하고 각각의 **`data-ad-slot` 번호(숫자 10자리)**를 기록합니다:
1. **디스플레이 광고** (`WEB_HOME_SIDEBAR`용): 사각형/반응형 선택
2. **인피드(In-feed) 광고** (`WEB_POST_LIST_INFEED`용): 목록 디자인과 어울리는 가로 카드 스타일 생성 (`data-ad-layout-key`도 함께 기록)
3. **콘텐츠 내 자동 삽입(In-article) 광고** (`WEB_POST_DETAIL_BOTTOM`용): 본문 하단용

---

## 2. 모바일 앱 광고 준비: Google AdMob (애드몹)

### 2-1. AdMob 가입 및 앱 등록
1. <https://admob.google.com> 에 접속해 AdSense와 **동일한 Google 계정**으로 가입합니다 (정산 계좌가 하나로 통합됩니다).
2. **앱(Apps) → 앱 추가**를 클릭합니다.
   - 아직 Play 스토어 / App Store에 출시 전이라도 **"아니요(스토어에 등록되지 않음)"**를 선택해 먼저 앱 ID를 발급받을 수 있습니다(출시 후 스토어 링크 연결 가능).
   - ⚠️ **주의**: 개발용 패키지(`com.stockapp.dev`)는 AdMob에 등록하지 않습니다! 개발용 앱은 코드에서 자동으로 **Google 공식 테스트 ID**를 사용합니다. AdMob에는 상용 앱(`com.stockapp`) 기준 **Android 1개, iOS 1개**만 등록합니다.
3. 등록 후 발급된 **앱 ID (`~` 물결표가 들어간 ID)** 2개를 메모합니다:
   - Android 앱 ID 예시: `ca-app-pub-1234567890123456~1111111111`
   - iOS 앱 ID 예시: `ca-app-pub-1234567890123456~2222222222`

### 2-2. AdMob 광고 단위(Ad Unit) 생성
각 앱(Android, iOS 각각)의 **광고 단위 → 광고 단위 추가**에서 아래 단위를 생성하고 **`/` 슬래시가 들어간 광고 단위 ID**를 메모합니다:
1. **네이티브 어드밴스드 (Native Advanced)**: 홈 탭 & 커뮤니티 인피드 카드용 (`MOB_HOME_FEED_NATIVE`, `MOB_COMMUNITY_INFEED`)
2. **배너 (Banner)**: 게시글 상세 하단 적응형 배너용 (`MOB_POST_DETAIL_BOTTOM`)
3. **보상형 (Rewarded)** *(선택)*: 차트 퀴즈 힌트/해설 열람 등 보상형 버튼용 (`MOB_GAME_REWARDED`)

### 2-3. 테스트 기기 등록 (내 휴대폰에서 실광고 테스트 시 필수)
- 상용 빌드(`com.stockapp`)를 내 휴대폰에 설치했을 때 본인 광고를 실수로라도 누르면 **무효 트래픽(Invalid Activity)으로 계정이 정지**될 수 있습니다.
- **AdMob 콘솔 → 설정 → 테스트 기기 → 테스트 기기 추가**에서 본인 안드로이드(ADID) 및 아이폰(IDFA) 광고 ID를 등록해 두면, 상용 빌드에서도 내 폰에서는 안전하게 `"Test Ad"` 라벨이 붙은 광고만 나옵니다.

### 2-4. `app-ads.txt` 설정 (모바일 광고 수익 보호)
- Google Play 및 App Store의 **개발자 웹사이트 URL**로 등록한 도메인 루트에 `app-ads.txt` 파일을 둡니다(`web_client/public/app-ads.txt`).
- 내용은 AdSense의 `ads.txt`와 동일한 포맷 한 줄이면 됩니다:
  ```text
  google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
  ```

---

## 3. 앱 스토어 심사 및 개인정보처리방침 준비 사항

모바일 앱에 AdMob SDK가 들어가면 Google Play와 Apple App Store 제출 시 아래 항목을 체크해야 심사가 거절되지 않습니다.

### 3-1. Google Play Console (Android)
1. **앱 콘텐츠 → 광고**: *"예, 앱에 광고가 포함되어 있습니다"* 선택.
2. **앱 콘텐츠 → 데이터 보안(Data Safety)**:
   - 데이터 수집 여부: **예**
   - 수집하는 데이터 유형: **기기 또는 기타 ID(Device or other IDs)** 체크 (목적: 광고 또는 마케팅, 애널리틱스 / 제3자 공유 체크).
3. **앱 콘텐츠 → 금융 기능(Financial Features)**:
   - 본 앱은 실제 주식 매매 중개나 대출을 하지 않고 **시세 정보 제공·모의 투자 게임·커뮤니티**만 제공하므로 금융 선언서에서 해당 항목(실제 자금 거래 없음)으로 체크합니다.

### 3-2. Apple App Store Connect (iOS)
1. **앱이 추적을 사용함 (App Tracking Transparency, ATT)**:
   - iOS에서는 앱 실행 후 광고 초기화 직전에 *"맞춤형 금융 정보 및 광고 제공을 위해 활동 추적을 허용하시겠습니까?"* 시스템 팝업(`expo-tracking-transparency`)이 뜨도록 코드에 반영됩니다(사용자가 '거부'를 눌러도 비맞춤형 광고는 정상 노출됨).
2. **앱 개인정보 보호(App Privacy)**:
   - 수집 데이터에 **식별자(기기 ID)** 및 **사용 데이터(광고 데이터)**를 체크하고 *"타사 광고(Third-Party Advertising) 목적으로 사용됨"*에 체크합니다.

### 3-3. 개인정보처리방침(Privacy Policy) 문구 1줄 추가
서비스 개인정보처리방침 문서에 아래 안내 문구를 추가합니다:
> *"회사는 맞춤형 광고 제공 및 서비스 분석을 위해 Google AdSense(웹 쿠키) 및 Google AdMob(모바일 광고 식별자 ADID/IDFA)을 활용할 수 있으며, 이용자는 브라우저 설정 또는 모바일 기기 설정(광고 추적 제한)을 통해 언제든 이를 거부할 수 있습니다."*

---

## 4. 환경변수(`.env`) 세팅 요약

위 1~2번에서 발급받은 ID들을 아래 파일에 채워 넣으면 준비가 끝납니다.

### 4-1. 웹 (`web_client/.env.production`)
```env
# Google AdSense 게시자 ID 및 슬롯 ID
VITE_ADSENSE_CLIENT_ID=ca-pub-XXXXXXXXXXXXXXXX
VITE_ADSENSE_SLOT_HOME_SIDEBAR=1111111111
VITE_ADSENSE_SLOT_POST_INFEED=2222222222
VITE_ADSENSE_SLOT_POST_BOTTOM=3333333333
VITE_ADSENSE_SLOT_SCREENER_FOOTER=4444444444
```

### 4-2. 모바일 (`mobile/.env.production`)
> 💡 `mobile/.env.development`에는 아무것도 넣지 않거나 테스트 ID를 그대로 두면 됩니다(개발 환경은 코드가 자동으로 Google 테스트 광고만 요청함).

```env
# Google AdMob 앱 ID (app.config.js 네이티브 빌드 주입용, 물결표 ~ 포함)
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY
EXPO_PUBLIC_ADMOB_IOS_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~ZZZZZZZZZZ

# Google AdMob 광고 단위 ID (런타임 컴포넌트 호출용, 슬래시 / 포함)
EXPO_PUBLIC_ADMOB_ANDROID_NATIVE_ID=ca-app-pub-XXXXXXXXXXXXXXXX/1111111111
EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID=ca-app-pub-XXXXXXXXXXXXXXXX/2222222222
EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID=ca-app-pub-XXXXXXXXXXXXXXXX/3333333333

EXPO_PUBLIC_ADMOB_IOS_NATIVE_ID=ca-app-pub-XXXXXXXXXXXXXXXX/4444444444
EXPO_PUBLIC_ADMOB_IOS_BANNER_ID=ca-app-pub-XXXXXXXXXXXXXXXX/5555555555
EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID=ca-app-pub-XXXXXXXXXXXXXXXX/6666666666
```
