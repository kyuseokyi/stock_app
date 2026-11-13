# 댓글 신고·차단 · 닉네임 금칙어 · AI 요약 기사 출처 설계 (2026-11-13)

스토어 출시 체크리스트 [`docs/deploy/store-release.md`](../../deploy/store-release.md)의 **D8**, **R2**, **R3**.
배경: 게시글은 관리자만 쓰고, 사용자는 게시판별로 켤 수 있는 댓글만 쓴다(운영에서는 꺼 둠). Play UGC 정책·Apple 1.2(신고·차단·조치·연락처)를 댓글을 켜기 **전에** 갖춘다.

## 1. 댓글 기본값 끄기 (D8)
- `boards.comments_enabled` 기본값을 `false`로: 모델 `default=False, server_default="false"`, 생성 스키마 `comments_enabled: bool = False`. 마이그레이션은 `server_default`만 바꾸고 **기존 행 값은 그대로**.
- 어드민 게시판 목록에서 댓글을 **켤 때** 확인 창: "댓글을 켜면 사용자가 쓴 글이 공개됩니다. 신고가 들어오면 '신고 관리'에서 처리해 주세요. 켤까요?"

## 2. 서버 (blog 앱 — 댓글과 같은 서비스)

### 데이터 (마이그레이션 1개)
- `comment_reports`: `id`, `comment_id`(FK blog_comments CASCADE), `reporter_id`(FK users CASCADE), `reason`(문자열: `abuse`·`spam`·`sexual`·`privacy`·`scam`·`other`), `detail`(Text, nullable, 최대 200자), `status`(`pending`·`dismissed`·`actioned`, 기본 pending), `created_at`. **UNIQUE(comment_id, reporter_id)**.
- `user_blocks`: `blocker_id`, `blocked_id`(둘 다 FK users CASCADE, 복합 PK), `created_at`.
- `blog_comments.hidden_at`(timestamptz, nullable) — 신고로 가려진 시각.
- `users.comment_banned_at`(timestamptz, nullable) — 댓글 작성 금지.

### 규칙
- 숨김 기준: 서로 다른 신고자 수가 `COMMENT_HIDE_THRESHOLD`(env, 기본 3) 이상이 되는 순간 `hidden_at=now`.
- 신고자 본인에게는 신고 즉시 그 댓글이 목록에서 빠진다.
- 자기 댓글은 신고할 수 없다(400 `CANNOT_REPORT_OWN`). 이미 신고했으면 409 `ALREADY_REPORTED`. `other`면 `detail` 필수(422).
- 차단: 자기 자신·관리자는 차단할 수 없다(400). 멱등(이미 차단이면 200).
- 댓글 작성: `comment_banned_at`이 있으면 403 `COMMENT_BANNED`(기존 `TERMS_REQUIRED` 검사 다음).

### API
| 메서드·경로 | 인증 | 동작 |
|---|---|---|
| `GET /api/v1/blogs/{id}/comments` | **선택**(토큰 있으면 사용) | 요청자가 차단한 사람의 댓글과 요청자가 신고한 댓글을 뺀다. `hidden_at`이 있는 댓글은 `hidden: true`, `content: ""`, `author_name: null`로 내려준다(관리자는 원문 그대로 + `hidden: true`). 기존 필드는 유지하고 `hidden: bool`, `is_mine: bool`(토큰 있을 때) 추가 |
| `POST /api/v1/comments/{id}/reports` | 필요 | body `{reason, detail?}` → 201 `{ok: true, hidden: bool}` |
| `GET /api/v1/me/blocks` | 필요 | `[{user_id, nickname, blocked_at}]` 최신순 |
| `POST /api/v1/me/blocks/{user_id}` | 필요 | 201(새로)·200(이미) |
| `DELETE /api/v1/me/blocks/{user_id}` | 필요 | 204(없어도 204) |
| `GET /api/v1/admin/comment-reports?status=pending` | 관리자 | 댓글 단위로 묶음: 댓글 id·내용·게시글 id/제목·작성자 id/닉네임/작성 금지 여부·신고 수·사유별 수·최근 신고 시각·hidden. 최근 신고순 |
| `POST /api/v1/admin/comment-reports/{comment_id}/resolve` | 관리자 | body `{action}`: `delete`(댓글 삭제), `dismiss`(숨김 해제 + 그 댓글 신고를 dismissed), `ban_author`(작성자 `comment_banned_at` 설정 + 댓글 삭제) |
| `PATCH /api/v1/admin/users/{id}/comment-ban` | 관리자 | body `{banned: bool}` — 해제 포함 |

## 3. 닉네임 금칙어 (R2)
- `shared/nickname_filter.py`: 금칙어 목록(욕설·비하·성적 표현·관리자/운영자 사칭 — "관리자", "운영자", "admin", "FunNote" 포함) + `is_blocked_nickname(name) -> bool`(공백·특수문자 제거, 소문자 비교, 부분 일치).
- 적용: 소셜 가입(새 사용자 생성)과 게스트·심사 계정 생성에서 걸리면 닉네임을 기존 기본값 규칙(`유저####`)으로 바꾼다. 기존 사용자 닉네임을 로그인마다 덮어쓰는 경로가 있으면 거기에도 적용.
- 관리자 강제 변경: `PATCH /api/v1/admin/users/{id}/nickname {nickname}`(1~20자, 금칙어 검사는 하지 않음 — 관리자 판단). 어드민 회원 화면에서 사용.

## 4. AI 요약 기사 출처 (R3)
- 아침 브리핑과 급등락 사유(그리고 뉴스를 근거로 쓰는 다른 AI 결과가 있으면 같은 방식)에 근거 기사 목록을 붙인다: `sources: [{title, url, pub_date}]`, 최대 3개, `url`은 `originallink` 우선·없으면 `link`.
- LLM 출력 스키마에 넣지 않는다(모델이 만들지 않게). 서비스가 LLM 호출에 넣은 뉴스 항목으로 채워 저장·응답에 덧붙인다. 기존 응답 필드 유지, `sources`는 없으면 `[]`(옛 캐시 호환).
- 앱·웹: 해당 카드 아래 "참고 기사" 작은 링크 목록(제목 한 줄 말줄임, 앱은 인앱 브라우저, 웹은 새 탭 `rel="noopener noreferrer"`).

## 5. 앱·웹 (사용자)
- 댓글마다 ⋯ 메뉴:
  - 내 댓글: **삭제**(확인 → 기존 `DELETE /comments/{id}`)
  - 남의 댓글(로그인 시): **신고**(사유 6개 선택, 기타는 200자 입력) / **이 사용자 차단**(확인)
  - 비로그인: 메뉴 대신 로그인 안내
- 가려진 댓글: 회색 "신고로 가려진 댓글이에요" 한 줄.
- 신고 후 토스트 "신고했어요. 검토 후 조치할게요", 차단 후 "차단했어요. 이 사용자의 댓글이 보이지 않아요" + 목록 새로고침.
- 오류 문구: `COMMENT_BANNED` "운영 정책 위반으로 댓글을 쓸 수 없어요", `ALREADY_REPORTED` "이미 신고한 댓글이에요".
- 내정보 → **차단한 사용자**(로그인 시): 목록 + [해제]. 앱은 새 화면, 웹은 `/me/blocks`.

## 6. 어드민
- 새 메뉴 **신고 관리**: 대기 목록 표(댓글 내용·게시글·작성자·신고 수·사유·hidden) + 버튼 [댓글 삭제] [작성자 댓글 금지] [기각]. 처리 후 목록에서 빠짐. 상태 필터(대기/전체).
- 회원 화면: 닉네임 변경, 댓글 금지 켜기/끄기.
- 게시판 화면: 댓글 켤 때 확인 창(1절).

## 7. 테스트
- 서버(pytest): 기본값 false(새 게시판), 기존 행 유지(마이그레이션 server_default만), 신고(성공·중복 409·자기 400·other detail 422·3명째 hidden), 목록 필터(차단·본인 신고·hidden 표시·관리자 원문), 차단 CRUD·자기/관리자 400, 작성 금지 403, 어드민 목록 묶음·resolve 3종·권한 403, 닉네임 금칙어 판정과 가입 시 치환, 관리자 닉네임 변경, sources 채움(뉴스 없으면 []).
- 앱(jest)·웹(vitest): 메뉴 분기(내 것/남의 것/비로그인), 오류 코드 문구, 가려진 댓글 표시.
- 어드민: 기존 테스트 방식이 있으면 따름.

## 8. 반영
- 마이그레이션은 배포 때 자동 실행(로컬 upgrade 금지). 앱은 JS만(OTA 가능, 네이티브 변경 없음).
- 문서: README(블로그·인증 절), `docs/feature-report/app.md`, `store-release.md` D8·R2·R3 체크.
