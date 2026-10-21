# 새 글 알림 — Expo 푸시 이전 설계

- 작성: 2026-10-21 · 상태: 승인(사용자 "진행")
- 관련: 펀드 리포트 알림 설계 `2026-10-19-fund-report-notice-design.md`(push_devices·ExpoPushSender·등록 큐), 설정 가이드 `docs/push_notification_setup.md`

## 1. 배경과 목표

새 글 알림(`collector.send_new_post_notification`)은 `users.fcm_token` 으로 보내지만 앱·웹 어디서도 이 값을 저장하지 않아 **받는 사람이 0명**이다. 펀드 알림을 위해 만든 Expo 푸시 기반(`push_devices`·`ExpoPushSender`)으로 옮긴다.

**사용자 결정(2026-10-21)**
- 보낼 글: **관리자가 글 작성 때 "앱 알림 보내기"를 고른 글만**(글 작성은 관리자 전용 API).
- 받을 기기: **알림을 허용한 모든 로그인 기기**(펀드 없어도). 내정보에서 켜기/끄기.

**범위 밖**: 발송 이력(`push_sends`) 기록·예약 발송, 웹 푸시, `users.fcm_token` 컬럼 삭제, iOS 실기기 확인.

## 2. 방식

`push_devices` 에 기기별 `post_notice` 플래그를 더한다(기기 단위 = OS 알림 권한 단위). 별도 구독 테이블(등록 흐름 중복)·사용자 단위 설정(기기별 권한과 어긋남)은 택하지 않았다.

## 3. 백엔드

### 3.1 데이터
- `push_devices.post_notice BOOLEAN NOT NULL DEFAULT true` — alembic 마이그레이션 1개. 기존 행은 true.
- `PUT /api/v1/push-devices` 본문: `{token, platform, fund_notice, post_notice}`. `post_notice` 는 선택(생략 시 true — 구버전 앱 호환). upsert 시 두 플래그 모두 갱신.

### 3.2 글 작성
- `BlogCreate.notify: bool = False` — DB 에 저장하지 않는 요청 전용 필드(`crud.create_blog` 로 넘기지 않음).
- `create_blog` 라우터: `notify` 가 참일 때만 `notify_new_post(post.id)`. **웹 SSE `new_post` 이벤트는 지금처럼 모든 새 글에 발행**(기존 동작 유지).

### 3.3 발송 태스크 `send_new_post_notification(post_id)`
- 대상: `push_devices` ⨝ `users` — `users.is_active` 이고 역할 등급 ≥ 게시판 `min_role_required`(기존 `_ROLE_LEVEL` 규칙), `push_devices.post_notice = true`.
- 메시지: `title=f"[{게시판 이름}] 새 글"`, `body=글 제목`, `data={type:'new_post', post_id, board_id}`, Android 채널 `blog-post`, sound default.
- 발송: `get_push_sender().send_batch(tokens, message)`(100개 묶음). 응답의 무효 토큰(DeviceNotRegistered)은 `push_devices` 에서 삭제.
- 결과는 로그와 반환 dict(`recipients`·`success`·`failure`·`invalid`)로만. 예외는 로그 후 삼킨다(재시도 없음 — 중복 발송 방지).
- `users.fcm_token` 은 더 이상 읽지 않는다(컬럼은 유지).

## 4. 모바일

### 4.1 등록 조건
- 기존 "로그인 + 펀드 ≥1 + 권한 허용" → **"로그인 + 권한 허용"** 이면 등록.
- 함께 보내는 플래그: `fund_notice = 펀드 ≥1`, `post_notice = 내정보 설정(기본 켜짐, 기기 저장)`.
- 저장 비교는 토큰만이 아니라 **토큰 + 두 플래그** 서명으로 — 플래그만 바뀌어도 다시 PUT.
- 동기화 시점: 기존(로그인 복원·펀드 추가/삭제·active 복귀·시트 수락) + 새 글 알림 스위치 변경.
- 펀드 백그라운드 정기 작업 등록 조건(펀드 ≥1)은 그대로.

### 4.2 권한 묻기
- 펀드 안내 시트를 일반화: 문구 "새 글·펀드 리포트 알림 받기". 기존 "펀드 첫 등록(0→1)"·"펀드 화면 진입 1회" 경로 유지.
- **로그인 후 홈 탭에서 1회** 같은 시트(아직 안 물었고, 권한이 미결정(`effectivePermission`)이고, 푸시 설정됨일 때). 기록(`wasPrompted`)은 기존 것을 공유 — 어느 경로든 한 번만.

### 4.3 내정보 "새 글 알림" 스위치
- 로그인 상태에서만 표시. 켤 때: 권한 미결정이면 OS 권한 요청, 다시 물을 수 없는 거부면 설정 앱 열기 안내. 값은 기기 저장소(SecureStore)에 두고 동기화 호출.

### 4.4 알림 수신·탭
- 탭: `new_post` → `/blog/{post_id}`, `fund_report` → 기존 `/fund`+갱신. 판정은 순수 함수(`handlers-core`).
- 앱이 앞에 있을 때: `new_post` 는 배너 표시(앱엔 새 글 SSE 토스트가 없음), `fund_report` 는 기존대로 배너 없음.
- Android 채널 `blog-post`("새 글", 기본 중요도) 생성.

## 5. admin_web
- 글 **작성** 화면에 "앱 알림 보내기" 체크박스(기본 꺼짐). 수정 화면에는 없음. 요청에 `notify` 포함.

## 6. 오류·호환
- 서버 먼저 배포해도 안전: 구버전 앱은 펀드 기기만 등록하고 `post_notice` 를 안 보내 기본 true → 그 기기들만 새 글 알림을 받는다. 새 앱 배포 후 전 기기로 넓어진다.
- 알림 위임·발송 실패는 글 작성을 막지 않는다(기존 `notify_new_post` 예외 삼킴 유지).

## 7. 테스트
- 백엔드: 마이그레이션 왕복, PUT 의 `post_notice` 저장·생략 시 true, `notify=false` 면 위임 안 함·true 면 위임, 대상 필터(역할 등급·`post_notice`·비활성 사용자), 무효 토큰 삭제, 발송기 예외 시 삼킴.
- 모바일(jest, 순수 로직): 등록 조건(펀드 0이어도 등록)·플래그 서명 비교, 탭 경로 분기, 포그라운드 배너 분기, 홈 1회 시트 판단.
- 실기기: 펀드 없는 계정의 등록·수신·탭 → 글 상세, 스위치 끄면 미수신.
