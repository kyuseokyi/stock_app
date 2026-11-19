# 운영자(사용자)가 직접 할 일

> 2026-11-14 기준. 코드로 할 수 없는 일 — 계정·콘솔·키·서버 명령·실기기 확인 — 만 모았다. 끝내면 `[x]` 로 바꾼다.
> 자세한 근거: 스토어 [`store-release.md`](store-release.md)(U1~U13), 서버 [`prod-release.md`](prod-release.md)·[`environments.md`](environments.md), 장중·화면 확인 [`../pending_checks.md`](../pending_checks.md).
> 비밀값(키·비밀번호)은 서버 `/opt/stock_app/env/` 파일에만 넣고 채팅·문서에 적지 않는다. 값 확인은 `awk` 로 이름과 채움 여부만 본다.

## 1. 지금 바로 (출시 일정을 정하는 일)

- [ ] **Google Play 개발자 계정**(U1) — US$25, 실명 결제 프로필, 신분증 확인, 이메일·전화 OTP, Play Console 모바일 앱으로 기기 인증. 개발자 이메일은 `support@funnotedaily.com`
- [ ] **시세 데이터 이용 계약(출시 조건)** — 증권사 개인 API 시세를 사용자에게 표시하는 것은 재배포라 계약 필요 가능성 높음. KRX·코스콤·FnGuide 문의 → 견적 비교: [`market-data-licensing.md`](market-data-licensing.md)
- [ ] **`com.stocknote` 앱 생성**(U2) — `com.stockapp` 은 Play 에서 이미 사용 중(2026-11-18) → 상용 패키지를 `com.stocknote` 로 변경. 사용자 할 일(푸시·로그인 포함)·코드 변경 전체: [`package-rename-stocknote.md`](package-rename-stocknote.md)
- [ ] **테스터 15~20명 모집**(U3) — Google 계정 이메일. 비공개 테스트 **12명·14일 연속**이 지나야 프로덕션 신청 가능

## 2. 상용 데이터·자동 배포

- [ ] **KIS 상용 키** 발급 → 서버 `.env.production` 의 `KIS_APP_KEY`·`KIS_APP_SECRET`·`KIS_ACCOUNT_NO`(`KIS_MODE=prod`) → 반영(아래 "서버 반영" 순서). 개발 서버와 **다른 키**
- [ ] 상용 어드민 → 데이터 현황 → **'초기 데이터 준비'** 실행(16:00~21:30 제외). 끝나면 시세·급등락·AI 브리핑이 생기고 참고 기사도 붙는다
- [ ] **상용 게시판·글 만들기** — 상용 DB는 새로 만든 것이라 게시판·글이 0개다(게시글 주소가 404 인 이유). 어드민 → 게시판 → 게시판 추가 → 글 작성. 댓글은 기본 꺼짐 — 켤 때는 신고 관리를 볼 수 있을 때만
- [ ] **자동 배포 켜기** — 저장소 변수 `PROD_DEPLOY_ENABLED=true` → 이후 상용 배포는 `release/vX.Y.Z` 태그 + 승인 한 번(요청하면 태그는 Claude 가 만든다)
- [ ] (선택) OCI 예산 알림(월 $1)

**서버 반영 순서**(자동 배포를 켜기 전, `~/stock_app`): `git pull origin main` → env 복사(`.env.production`→`backend/`, `compose.env`→`.env`, `chown ubuntu:docker`) → `docker compose -f docker-compose.prod.yml build …` → `… run --rm stock_api alembic upgrade head` → `… up -d …` → `ps`. 빌드 → 마이그레이션 → 교체 순서를 지킨다.

## 3. 상용 앱 빌드와 Google 설정

- [ ] **상용 정식 빌드**(EAS production, AAB) — `cd mobile && npm run build:android:prod`(첫 실행 때 EAS 가 상용 서명 키를 만든다) → **Expo 대시보드 Credentials 에서 키스토어 백업**
- [x] **푸시**: EAS 에 `com.stockapp` FCM 자격 증명 업로드 — 2026-10-21 업로드, 11-17 상용 테스트 APK(`npm run build:android:preview`)로 대상 기기 등록·알림 수신 확인. 상용 서버 `PUSH_BACKEND=expo` 동작 — ⚠️ 옛 패키지 기준. 새 상용 패키지 `com.stocknote` 는 다시 업로드 필요(위 U2·[`package-rename-stocknote.md`](package-rename-stocknote.md) A2)
- [ ] **Drive 백업(개발용)**: Google Cloud → Drive API 켜기 → OAuth 동의 화면(테스트, 본인 테스트 사용자) → Android 클라이언트 `com.stockapp.dev` + SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` → 웹 클라이언트 ID 를 `mobile/.env.development` 의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` 에
- [ ] **Drive 백업(상용)**(U8): 상용 프로젝트(권장) → Android 클라이언트 `com.stocknote` 를 **두 개**(EAS 업로드 키 SHA-1, Play Console 앱 서명 키 SHA-1) → 웹 클라이언트 ID 를 `mobile/.env.production` 에 → OAuth 동의 화면 **프로덕션 게시**(홈페이지·처리방침 `https://app.funnotedaily.com/privacy`·승인 도메인 `funnotedaily.com`)

## 4. Play Console 등록 (비공개 테스트 전)

- [ ] 앱 콘텐츠 선언(U6) — 초안은 [`store-release.md`](store-release.md) 3절. 카테고리 **금융**, 타겟층 **18세 이상**, 광고 ID 사용 안 함, 금융 기능·건강·정부 앱 해당 없음, 데이터 보안(삭제 URL `https://app.funnotedaily.com/account-deletion`)
- [ ] **앱 액세스(심사 계정)** — 서버 `.env.production` 에 `REVIEW_LOGIN_EMAILS=<심사 이메일>` → 반영 → `docker compose -f docker-compose.prod.yml exec -e REVIEW_EMAIL=… -e REVIEW_PASSWORD=…(12자 이상) auth_api python -m apps.auth.seed_reviewer` → 콘솔에 이메일·비밀번호와 진입 방법(영어 안내는 Claude 에게 요청). 심사가 끝나면 목록에서 빼거나 비밀번호 변경
- [ ] 스토어 자산(U11) — 아이콘 512, 그래픽 1024×500, 세로 스크린샷 4~8장, 짧은 설명 80자·설명 4000자(문구 초안은 Claude 에게 요청). "1위·최고" 같은 순위 주장·이모지 금지
- [ ] 비공개 테스트 트랙 업로드 → 테스터 초대 → 14일 → 프로덕션 액세스 신청

## 5. iOS (Android 다음)

- [ ] **Apple Developer Program**(U4, 연 US$99, 실명 공개) → App Store Connect 앱 생성 → EU DSA 상태 신고(배포 지역 한국만이면 비거래자)
- [ ] 애플 로그인용 Services ID·키, APNs 키(EAS), Google iOS OAuth 클라이언트(U9) — 받으면 Claude 가 D2(애플 로그인)·D7(iOS 설정) 진행
- [ ] 개인정보 라벨·연령 등급·수출 규정(U7), 심사 메모(U12, 영어)

## 6. 출시 직전

- [ ] **네이버 로그인 검수**(U13) — API 설정에서 **회원이름 체크 해제**, 적용 형태 "신규 회원가입", 추가 서류 "없음", 캡처는 외부 사이트 연결 해제 후 동의 화면부터
- [ ] 광고 Phase 2·3 — AdSense(상용 웹), AdMob(앱) — [`../ad_monetization_setup_guide.md`](../ad_monetization_setup_guide.md)

## 7. 실기기·화면 확인

- [ ] 새 개발 APK(`~/Downloads/funnote-apk/stockapp-dev-dev-20261113-1143.apk`) 설치 후: 약관 동의 시트(뒤로가기로 안 닫힘, [동의하지 않음]=로그아웃), 내정보 아래 고지·정책 링크 4개·버전, 버전 7번 탭 → 심사 폼("지금은 사용할 수 없어요" 정상)
- [ ] 댓글 켠 테스트 게시판에서 ⋯ 메뉴(삭제·신고·차단), 신고 "기타" 입력 시 키보드, 차단한 사용자 화면
- [ ] 참고 기사 링크(브리핑·급등락) 터치 영역, iOS 주도주 분석 시트 안 링크
- [ ] 개발 어드민·상용 어드민: 신고 관리, 회원(닉네임 변경·댓글 금지), 게시판 댓글 켤 때 확인 창
- [ ] 상용 웹·앱에 본인 계정 로그인 → 약관 동의 창
- [ ] 장중·기능 확인 목록은 [`../pending_checks.md`](../pending_checks.md)

## 8. 그 밖의 대기 항목

- [ ] 시즌 1기 정산 결과 확인, 장중 지수 실측(Task 4), 새 글 알림 기기 확인
- [ ] (선택) 단일 노드 Swarm 무중단 전환 — [`single-node-swarm.md`](single-node-swarm.md)
- [ ] 결정: 회원 전용 게시판 계획 여부
- [ ] 정리: `web_client/touch-test.html`·`src/__touchTest.tsx`·`public/__touch-bars.json`(임시 파일) 삭제 여부, `docs/deploy/prod-release.md` 미커밋 수정분(다른 세션) 커밋 여부
