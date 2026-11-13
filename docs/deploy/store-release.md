# 스토어 출시 체크리스트 — Google Play · Apple App Store

> 2026-11-13 기준. 두 스토어의 정책 원문을 확인하고 우리 코드와 대조한 결과다(출처는 맨 아래).
> 스토어 정책은 자주 바뀌므로 콘솔에서 설문을 작성할 때 원문을 다시 확인한다. "(추측)"은 원문 근거 없이 판단한 것이다.
> 서버 쪽 상용 준비는 [`prod-release.md`](prod-release.md), 환경별 값은 [`environments.md`](environments.md).

## 0. 먼저 알아 둘 것

| 항목 | 내용 |
|---|---|
| ⏱️ **가장 오래 걸리는 일** | Google Play **개인 계정은 테스터 12명 이상이 14일 연속** 비공개 테스트에 참여해야 프로덕션 출시를 신청할 수 있다. 중간에 빠지면 다시 센다. 내부 테스트 트랙은 인정되지 않는다. 15~20명을 모아 **최대한 빨리 시작**한다 |
| 👤 **실명 공개** | 두 스토어 모두 개인 계정이면 판매자(개발자) 이름으로 **실명이 공개**된다. 'FunNote'로 보이려면 사업자(법인) + D-U-N-S 번호가 필요하다 |
| 🚫 **iOS 확정 반려** | 카카오·네이버 로그인만 있으면 Apple 가이드라인 **4.8**에 따라 **애플 로그인**을 같은 위치·크기로 함께 제공해야 한다 |
| 🔑 **공통 반려 위험** | 심사자가 로그인할 수 없다. 해외 심사자는 카카오·네이버 인증(휴대폰·새 기기 확인)을 통과하기 어렵다(추측) → **심사 전용 로그인 경로** 필요 |
| 📂 **카테고리** | 두 스토어 모두 **금융**. Games·Entertainment를 고르지 않는다(한국 게임물 등급분류 대상에서 빠지고, Play 뉴스 선언 요구도 피한다) |

## 1. 앱 개발 작업

### 🔴 출시를 막는 것

| # | 작업 | 대상 | 고칠 곳 | 크기 | 근거 |
|---|---|---|---|---|---|
| D1 | **심사 전용 로그인**: 서버가 허용한 심사 계정만 ID/비밀번호로 들어가는 숨은 진입점(예: 버전 표시 여러 번 누르기). 상용 게스트 로그인은 계속 꺼 둔다. 심사 뒤 비밀번호 변경·비활성화 | 공통 | auth 서버, 앱 | 중 | Play 앱 액세스(재사용 가능·위치 무관·OTP 우회·영어 안내), Apple 2.1(만료되지 않는 데모 계정) |
| D2 | **애플 로그인**: 앱 버튼 + auth 서버 공급자. 탈퇴할 때 Apple REST API로 토큰 철회 | iOS | auth 서버, 앱 | 대 | Apple 4.8, 5.1.1(v) |
| D3 | **이용약관** 공개 페이지(`/terms`: 금지 행위·신고와 조치·투자 권유 아님·모의투자는 가상 자금·책임 범위) + **첫 로그인 때 동의** 기록 | 공통 | 웹, 앱, auth 서버 | 중 | Play UGC(콘텐츠 작성 전 약관 동의) |
| D4 | **고객지원 페이지** `/support`: 문의 메일(`support@funnotedaily.com`), 자주 묻는 질문, 정책 링크 | 공통 | 웹 | 소 | Apple 지원 URL 필수(실제 연락처로 이어져야 함) |
| D5 | **`funnotedaily.com` 루트가 응답 없음** → `app.funnotedaily.com`으로 리다이렉트 | 공통 | Cloudflare | 소 | 깨진 링크는 Apple 2.1 반려 사유 |
| D6 | **권한 정리**: `android.blockedPermissions`에 `SYSTEM_ALERT_WINDOW`(Expo 템플릿이 넣지만 쓰지 않음), 쓰지 않는 `READ/WRITE_EXTERNAL_STORAGE` | Android | `mobile/app.config.js` | 소 | Play 민감 권한 정책 |
| D7 | **iOS 설정**: `ios.privacyManifests`(Required Reason API — UserDefaults·FileTimestamp·SystemBootTime·DiskSpace), 암호화 선언(`ITSAppUsesNonExemptEncryption=false`), `supportsTablet` 결정, Google 로그인 `iosUrlScheme` 실제 값(지금 `com.googleusercontent.apps.unset`이라 iOS Drive 백업이 동작하지 않음) | iOS | `mobile/app.config.js` | 소 | Apple Privacy Manifest(2024-05~), 수출 규정, 2.1 |
| D8 | **댓글 신고·차단 + 어드민 신고 처리 + 댓글 기본값 끄기**(`boards.comments_enabled` 기본 `true` → `false`, 기존 값은 유지). 댓글은 **이 기능을 배포한 뒤에만** 켠다 | 공통 | blog 서버, 앱, 웹, 어드민 | 대 | Play UGC, Apple 1.2(필터·신고·차단·연락처) |

### 🟡 반려 위험을 줄이는 것

| # | 작업 | 이유 |
|---|---|---|
| R1 | 앱 안에 **"정보 제공 전용 · 매매·투자 자문 아님 · 모의투자는 가상 자금"** 고지(내정보 또는 첫 실행) | Apple 3.2.1(viii)·5.1.1(ix): 투자·자산 관리 앱은 금융기관·법인이 제출해야 한다는 조항이 개인에게 걸릴 수 있음 |
| R2 | **닉네임 금칙어 필터** 또는 관리자가 닉네임을 바꿀 수 있는 수단 | 랭킹에 공개되는 닉네임도 사용자 콘텐츠로 볼 여지(추측) |
| R3 | AI 시황 요약에 **원 기사 출처** 표시 | Play가 "AI 뉴스 모음 앱"으로 보고 뉴스 선언을 요구할 경우 대비 |
| R4 | 쓰지 않으면 iOS **무음 푸시 백그라운드 모드**(`enableBackgroundRemoteNotifications`) 제거, 광고성 푸시는 별도 동의 | Apple 2.5.4, 4.5.4 |

### 🟢 나중에

- 개발 APK(`com.stockapp.dev`) 사이드로드: Android 개발자 인증이 2027년 한국에 적용되기 전에 Play Console에 "Play 외부 배포 앱"으로 등록(추측).
- AdMob을 붙일 때: 상용에서 테스트 ID로 넘어가지 않게(fail-closed), AD_ID 권한, 데이터 보안 광고 ID 항목, `app-ads.txt`.

### 이미 충족

- 개인정보처리방침 `/privacy`, 계정 삭제 안내 `/account-deletion`, 앱·웹 내정보 링크(2026-11-12) — **상용 웹 배포 후** 로그아웃 상태에서 본문이 실제로 뜨는지 확인
- 앱 안 회원 탈퇴(서버 즉시 삭제 + 기기 펀드 데이터 정리)
- targetSdk 36(Play 2026-08-31부터 필수), AAB(`eas.json` production), 알림 권한을 사용자 동작으로 요청
- 광고 SDK·추적 없음(ATT 불필요, AD_ID 없음), AI 프롬프트에 개인정보 없음
- 로컬 Xcode 26.3(Apple: Xcode 26·iOS 26 SDK 이상), 앱 아이콘 1024(알파 없음)
- 소셜 로그인이 ASWebAuthenticationSession(인앱 인증 세션) 방식 — Apple 5.1.1(vii) 문제 없음(추측)

## 2. 사용자 작업 (계정·콘솔)

| 순서 | 할 일 | 비고 |
|---|---|---|
| U1 | **Google Play 개발자 계정**: US$25(선불카드 불가), 실명 결제 프로필, 신분증 확인, 이메일·전화 OTP, Play Console 모바일 앱으로 기기 인증 | 개발자 이메일은 `support@funnotedaily.com` |
| U2 | 계정을 만들면 **바로 앱 생성 → `com.stockapp` 확보** | 이미 쓰이는 이름이면 바꿔야 하고, OAuth·FCM·EAS 설정을 모두 다시 맞춰야 함 |
| U3 | **테스터 15~20명 모집**(Google 계정) → 비공개 테스트 트랙에 올리고 14일 연속 유지 → 대시보드에서 프로덕션 액세스 신청(테스트 내용 질문에 답함) | 테스트 피드백을 기록해 둔다 |
| U4 | **Apple Developer Program**(연 US$99, 2단계 인증, 실명) → App Store Connect에서 `com.stockapp` 앱 생성, 무료 앱 약관 | |
| U5 | **EU DSA 거래자 상태 신고**(필수). 배포 지역을 **한국만**으로 하면 비거래자로 신고해 주소 공개를 피할 수 있음(추측) | |
| U6 | 콘텐츠 선언(Play): 개인정보처리방침, 앱 액세스(심사 계정·영어 안내), 광고(하우스 배너 — 앱 안 기능 안내뿐이면 No 여지, 확신 없으면 Yes), 콘텐츠 등급(IARC), 타겟층 **18세 이상**, 데이터 보안(삭제 URL 포함), 금융 기능(정보 제공뿐이면 "없음" 또는 포트폴리오 관리 — 확인 필요), 건강·정부 앱 아님, 광고 ID 사용 안 함 | 초안은 아래 3절 |
| U7 | Apple: 개인정보 영양 라벨(추적 없음), 연령 등급(광고·UGC 있음, 모의 도박 없음 → 4+ 예상), 수출 규정, 카테고리 금융 | |
| U8 | 상용 앱 정식 빌드(EAS production) → Expo Credentials에서 **서명 키 백업** → Play 업로드 후 **앱 서명 키 SHA-1**을 Google OAuth Android 클라이언트(Drive 백업)에 등록 → OAuth 동의 화면 **프로덕션 게시** | 빠지면 스토어판에서만 Drive 백업 로그인 실패 |
| U9 | Apple 키: 애플 로그인용 Services ID·키(D2), APNs 키(EAS 자격 증명), Google iOS OAuth 클라이언트(D7) | |
| U10 | 상용 푸시: EAS에 `com.stockapp` FCM 자격 증명 업로드 | |
| U11 | 스토어 자산: 아이콘 512(Play), 그래픽 1024×500(Play), 스크린샷(Play 세로 1080×1920 4~8장, iPhone 6.3인치 1179×2556 이상, iPad를 지원하면 13인치), 앱 이름 30자·짧은 설명 80자·설명 4000자, 키워드 100바이트(Apple), 지원 URL `/support`, 저작권, 심사 연락처(+82) | "1위·최고" 같은 순위 주장, 이모지 금지 |
| U12 | 심사 메모(영어): 정보 제공 전용 고지, 비로그인 이용 범위, 댓글 기능 존재·현재 꺼짐, 백그라운드 작업 목적, 심사 계정 | Apple 2.5.19·2.3.1: 숨은 기능 금지 — 댓글을 켤 때는 OTA가 아니라 새 버전 심사로 |
| U13 | 네이버 로그인 검수(마지막) — API 설정에서 **회원이름 체크 해제**, 적용 형태 "신규 회원가입" | [prod-release.md](prod-release.md) |

## 3. 데이터 보안·개인정보 라벨 초안

| 데이터 | 수집(서버 저장) | 용도 | 비고 |
|---|---|---|---|
| 사용자 ID(간편 로그인 식별번호) | 예 | 계정 | 이메일·전화·실명은 받지 않음 |
| 이름(닉네임) | 예 | 계정, 앱 기능(랭킹) | 다른 사용자에게 공개 |
| 기기 ID(푸시 토큰) | 예(알림을 켠 경우) | 알림 | Expo·FCM으로 전송 |
| 앱 활동(게임 기록) | 예 | 앱 기능 | |
| 사용자 콘텐츠(댓글) | 예(댓글을 켠 경우) | 앱 기능 | |
| 펀드 기록 | **아니요** | — | 기기·브라우저와 사용자 본인 Google Drive에만 있음 — "수집 아님"으로 볼 여지(추측) |
| 추적·광고 ID | 아니요 | — | |

- 전송 중 암호화: 예(HTTPS) · 삭제 요청: 예(`https://app.funnotedaily.com/account-deletion`)
- 서버 위치 일본(도쿄) — 처리방침 5절에 국외 이전으로 적혀 있음

## 4. 순서

1. **지금(사용자)**: U1 → U2 → U3 테스터 모집. 14일을 빨리 시작하는 것이 전체 일정을 줄인다.
2. **코드 1차**: D6 → D4 → D5 → D3 → D1 → R1 — Android 비공개 테스트에 필요한 것부터. 그 뒤 상용 웹 배포.
3. **Android 비공개 테스트 시작**: U8(정식 빌드) → U6 → U11 → 비공개 트랙 업로드.
4. **코드 2차**: D8(신고·차단), R2·R3.
5. **iOS**: U4·U9 → D2 애플 로그인 → D7 → TestFlight 실기기 검증 → U7·U12.

**결정 대기**: iPad 지원 여부(끄기 추천 — 켜면 iPad 레이아웃 점검과 13인치 스크린샷 필수), 약관 동의 시점(첫 로그인 추천).

## 5. 미확인으로 남은 것

- 한국 게임산업법상 앱 안 모의투자가 '게임물'에 해당하는지(금융 카테고리로 회피 예정)
- 유사투자자문업 해당 여부(무료·정보 제공이라 아닐 가능성 — 법률 확인 권장)
- JS OTA(expo-updates)를 허용하는 Apple 라이선스 조항 — OTA는 버그 수정 범위로만 쓴다
- Play 포그라운드 서비스 유형 선언 요구 여부 — 첫 AAB 업로드 후 콘솔 확인
- 각 심사·신원 확인·OAuth 브랜드 인증의 소요 기간

## 출처

**Google Play**
- 개인 계정 테스트 요건: https://support.google.com/googleplay/android-developer/answer/14151465
- 개인 계정 신원·공개 정보: https://support.google.com/googleplay/android-developer/answer/13628312 , 등록비·기기 인증: answer/6112435
- 개발자 인증: https://developer.android.com/developer-verification
- 대상 API: answer/11926878 · 앱 액세스 자격 증명: answer/15748846 · 심사 준비·광고: answer/9859455
- 계정 삭제: answer/13327111 · 데이터 보안: answer/10787469 · UGC: answer/9876937
- 금융 기능 선언: answer/13849271 · 금융 서비스 정책: answer/9876821 · 뉴스: answer/10523915, answer/9935326
- 콘텐츠 등급: answer/9898843 · 타겟층: answer/9867159 · 스토어 자산: answer/9866151, answer/9859152, answer/9898842
- 앱 서명: answer/9842756 · 포그라운드 서비스: answer/13392821 · 민감 권한: answer/9888170 · 광고 ID: answer/6048248

**Apple**
- App Store Review Guidelines(2026-10-16판): https://developer.apple.com/app-store/review/guidelines/ — 1.2, 2.1, 2.3.1, 2.5.2, 2.5.4, 2.5.19, 3.2.1, 4.5.4, 4.8, 5.1.1, 5.1.2, 5.3
- 가입: https://developer.apple.com/programs/enroll/ · 최신 요건: https://developer.apple.com/news/upcoming-requirements/
- 계정 삭제: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- EU DSA: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements
- 연령 등급: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- 스크린샷: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- 수출 규정: https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance
- Expo Privacy Manifest: https://docs.expo.dev/guides/apple-privacy/
