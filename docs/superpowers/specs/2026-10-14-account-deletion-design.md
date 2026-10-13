# 회원 탈퇴 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: 범위 "회원 탈퇴만", 방식 "즉시 삭제 + 공개기록 익명화", 설계안 "좋아 그대로 진행해줘")
> 범위 밖: 게스트→소셜 이관(게스트는 개발용 — 운영 미노출이라 실사용자 없음, ROADMAP 에서 '불필요'로 정리), 애플 로그인.

## 1. API — `DELETE /api/v1/auth/me` (auth 서비스 8001, 인증 필요)
- 본문 `{"confirm": "탈퇴"}` — 불일치/누락 400 `CONFIRM_REQUIRED`. ADMIN 역할 403 `ADMIN_CANNOT_DELETE`. 성공 204.
- Router → Service(`apps/auth/services/account_deletion.py`) → DB. 한 트랜잭션:
  1. 공개 기록 익명화: `hall_of_fame` 의 해당 user 행 `user_nickname='탈퇴한 회원'`, `user_id=NULL`; `weekly_ranking_results` 의 해당 user 행 `nickname='탈퇴한 회원'`, `user_id=NULL`.
  2. `users` 행 삭제 → 기존 FK 규칙대로 게임 계좌·포지션·거래·퀘스트·배지·아카데미·퀴즈시도·streak·streak 보상·댓글 CASCADE, 블로그 글·코치 메시지 author SET NULL.
- 커밋 후(베스트 에포트, 실패해도 204): Redis 정리 — 모든 시즌 `game:season:{id}:ranking` 에서 ZREM, 진행 중 주간 키 `game:season:{id}:week:*:ranking` ZREM 및 `…:base` HDEL(SCAN 사용, KEYS 금지).
- 카카오 연결 끊기(베스트 에포트): provider=KAKAO 이고 `KAKAO_ADMIN_KEY` 설정 시 `POST https://kapi.kakao.com/v1/user/unlink` (헤더 `Authorization: KakaoAK {admin_key}`, form `target_id_type=user_id&target_id={provider_id}`), 타임아웃 5초, 실패는 경고 로그. 네이버는 저장 토큰이 없어 생략(클라이언트 안내 문구).
- 기존 토큰: stateless JWT 이지만 `get_current_user` 가 행 재조회 → 탈퇴 후 401(테스트로 보장).

## 2. 마이그레이션
- `weekly_ranking_results.user_id` FK: CASCADE → **SET NULL**, 컬럼 nullable 로. UNIQUE(season_id, week_start, user_id) 는 NULL 다중 허용(PG 기본)이라 유지. down_revision = 현재 head(`c9d0e1f2a3b4`).
- 코드에서 `weekly_ranking_results.user_id` 를 쓰는 곳(unseen 보상 조회·ack)은 NULL 행을 자연히 제외 — 회귀 테스트.

## 3. 화면
- **모바일 내정보**(`src/app/(tabs)/profile.tsx`): 로그아웃 아래 작은 회색 "회원 탈퇴" 텍스트 버튼 → 바텀시트(기존 Sheet 패턴): 삭제 항목 안내(게임 계좌·거래·퀘스트·출석·퀴즈 기록·댓글 삭제 / 명예의 전당·주간 기록은 '탈퇴한 회원'으로 남음 / 되돌릴 수 없음 / 네이버 연결은 네이버 설정에서 해제 가능) + "탈퇴하기"(up 계열 위험 버튼) + "취소". 성공 → 로그아웃 → 홈 이동 → 토스트 "탈퇴가 완료됐어요".
- **웹**(`components/Layout.tsx` 헤더): "{닉네임} 님"을 누르면 드롭다운(로그아웃·회원 탈퇴) → 같은 내용의 확인 모달 → 성공 시 로그아웃·홈·토스트.
- API·타입 계층 분리(mobile `features/auth/api.ts`, web `api/auth.ts`), TS strict, 파스텔 테마 토큰 사용.

## 4. 검증
- backend pytest: 연관 데이터 CASCADE 삭제, 명예의 전당·주간 결과 익명화(행 유지·user_id NULL), Redis ZREM/HDEL, confirm 400, ADMIN 403, 탈퇴 후 기존 토큰으로 `/me` 401, 카카오 unlink 호출(키 있을 때만·실패해도 204, httpx 목), unseen 보상이 NULL 행 제외.
- 마이그레이션: 로컬 docker PG 일회용 DB upgrade/downgrade/upgrade.
- mobile tsc/jest, web tsc/build. 모바일 에뮬레이터 + 일회용 DB/Redis DB5 로 탈퇴 흐름 스모크(스크린샷), 끝나면 정리.
- 문서: README auth 섹션 API 한 줄 + `KAKAO_ADMIN_KEY` env(.env.example), ROADMAP 92행 갱신.
