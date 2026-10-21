# 새 글 알림 — Expo 푸시 이전 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans 로 작업 단위 실행. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 관리자가 글을 쓸 때 "앱 알림 보내기"를 고른 글만, 알림을 허용한 모든 로그인 기기(펀드 없어도)에 Expo 푸시로 새 글 알림을 보내고, 앱은 내정보 스위치로 기기별 수신을 켜고 끈다.

**구조:** `push_devices` 에 기기별 `post_notice` 플래그를 더한다(마이그레이션 1개). blog 의 `PUT /api/v1/push-devices` 가 플래그를 받아 저장하고(생략 시 true), 글 작성 `POST /api/v1/blogs` 는 요청 전용 필드 `notify` 가 참일 때만 Celery `collector.send_new_post_notification` 에 위임한다(웹 SSE `new_post` 는 지금처럼 항상). 태스크는 `users.fcm_token` 대신 `push_devices ⨝ users` 에서 대상을 골라 `ExpoPushSender.send_batch` 로 보내고 무효 토큰을 지운다. 앱은 "로그인 + 권한 허용"이면 등록하고, 저장값을 토큰 + 두 플래그 서명으로 바꿔 플래그만 바뀌어도 다시 PUT 한다.

**기술:** FastAPI · SQLAlchemy 2(async/sync) · Alembic · Celery / React(Vite, TS) / Expo SDK 57(expo-notifications, expo-secure-store, expo-router typedRoutes) · pytest(aiosqlite·SQLite) · jest(jest-expo, 순수 로직만)

**설계:** [`docs/superpowers/specs/2026-10-21-new-post-push-design.md`](../specs/2026-10-21-new-post-push-design.md) · **선행 계획:** [`2026-10-21-fund-report-notice.md`](2026-10-21-fund-report-notice.md)(push_devices·ExpoPushSender·등록 큐) · **설정 가이드:** [`docs/push_notification_setup.md`](../../push_notification_setup.md)

---

## 설계와 다르게 정한 것 (코드 조사 결과 반영)

| 설계 | 실제 코드 | 이 계획 |
|---|---|---|
| `BlogCreate.notify` 는 "`crud.create_blog` 로 넘기지 않음" | `crud.create_blog` 가 `BlogPost(**data.model_dump())` 로 스키마 전체를 컬럼에 넣음 → `notify` 가 섞이면 `TypeError` | `crud.create_blog` 를 `data.model_dump(exclude={"notify"})` 로 1줄 수정(스키마 객체는 그대로 넘김). 테스트로 `notify=True` 작성이 201 인지 고정 |
| 푸시 저장 비교를 "토큰 + 두 플래그 서명"으로 | 기존 저장값(`push_device_v1`)은 **토큰 문자열 그대로**이고, 해제(`unregisterWith`·권한 회수 분기)가 그 값을 그대로 `DELETE /push-devices/{token}` 경로에 넣음 | 저장 키는 **그대로** 두고 값을 JSON(`{"v":2,"token","fund","post"}`)으로 바꾼다. 읽을 때 `decodeSaved` 가 `{` 로 시작하지 않는 값(구버전 = Expo 토큰 문자열)은 `{token, fund:null, post:null}` 로 읽음 → 서명이 달라 **한 번 다시 PUT**, 해제 때는 순수 토큰을 꺼내 DELETE. 키를 바꾸면 업데이트 후 로그아웃 때 옛 토큰을 못 지우므로 바꾸지 않는다 |
| 발송 태스크 `send_new_post_notification` 반환값 | 지금은 `sent` 키 | 설계대로 `recipients`·`success`·`failure`·`invalid`(호출자 없음 — blog 는 `send_task` 만) |
| 알림 제목 | 지금 `"[게시판] 새 글이 등록되었습니다"` | 설계대로 `"[게시판] 새 글"`. 게시판이 없으면(삭제 경쟁) `"새 글"` |
| `post_id` 판정 | 서버는 int 로 보냄 | 탭 판정은 양의 정수 **또는 숫자 문자열**을 허용(플랫폼별 data 직렬화 차이 대비). 그 밖이면 무시 |
| 내정보 스위치 "로그인 상태에서만" | 웹(`expo start --web`)은 `isPushConfigured()=false` | 로그인 + `isPushConfigured()` 일 때만 표시(웹·projectId 없음은 숨김) |
| 내정보 스위치로 OS 권한을 물었을 때 | 홈·펀드 시트는 `wasPrompted` 가 없고 권한이 "미결정"이면 뜸. Android 는 첫 거부 뒤에도 `canAskAgain=true` → 미결정으로 보임 | 스위치에서 권한을 요청하면 `markPrompted('accepted')` 도 기록 — 같은 질문을 시트로 또 하지 않게 |
| 채널 생성 함수 | `ensureFundChannel()`(펀드 채널만) | 작업 8 에서 `ensurePushChannels()`(펀드·새 글 두 채널)로 바꾸고 호출부 2곳(시트·스위치)도 같이 바꾼다. 작업 6 은 기존 `ensureFundChannel` 을 그대로 부른다 |
| 마이그레이션 왕복 테스트(설계 §7) | pytest 는 SQLite `create_all` 이라 마이그레이션 파일을 실행하지 않음 | 선행 계획 1-9b 와 같은 **일회용 PostgreSQL 컨테이너 왕복**(upgrade → downgrade -1 → upgrade) 단계로 확인 |
| 권한 거부 후 스위치를 켤 때 | — | 값은 켜짐으로 저장하고(사용자 의사), "설정 열기" 안내만 띄운다. 권한이 없으면 등록 자체가 안 되므로 서버에는 영향 없음 |

## 상시 규칙 (모든 작업)

- 모든 커밋은 `dev` 브랜치. `git add -A`·`git add .` 금지 — 파일을 **하나씩** 지정한다. `.serena/project.yml` 은 절대 스테이징하지 않는다(작업 트리에 수정분이 있음).
- 커밋 메시지는 한국어. 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- **테스트가 실패하면 커밋하지 않는다.**
- 검증 명령(작업 끝마다 해당하는 것):
  - 백엔드: `cd backend && uv run pytest -p no:warnings -q` — 기준 1340개, 실패 0, 총 수 = 기준 + 이 계획에서 추가한 수
  - 모바일: `cd mobile && npx jest` 와 `npm run typecheck` — 기준 505개, 실패 0, 총 수 = 기준 + 추가분, 타입 오류 0
  - admin_web: `cd admin_web && npx tsc --noEmit` — 오류 0
- 패키지 설치(`npm install`·`npx expo install`·`uv add`)는 하지 않는다. 필요하면 사용자가 한다(이 계획은 새 패키지가 필요 없다 — RN `Switch` 는 react-native 내장).
- 실제 env 파일(`.env.development`·`.env.production`·`.env.*.local` 등)은 **수정하지도 출력하지도 않는다**.
- KIS API 를 호출하지 않는다(이 기능과 무관한 수집 태스크도 실행하지 않는다).
- 로컬에서 Celery 워커를 띄울 때는 반드시 `REDIS_URL=redis://localhost:6379/5` (enqueue 하는 blog 서버도 같은 값). DB 0 에는 예전 세션의 미처리 수집 태스크가 남아 있을 수 있다.
- Expo 실서버를 테스트에서 호출하지 않는다(발송기는 가짜로 바꿔 끼운다).
- `mobile/src/features/fund/background/tasks.ts` 는 수정하지 않는다 — 정기 작업 등록 조건(펀드 ≥1)과 무음 push(`fund_refresh`) 처리는 그대로다.
- 하위 에이전트 지시에 넣을 것: 보고·커밋 메시지는 한국어만 / Fact-Forcing Gate 훅이 파일 첫 수정마다 거부하면 요구 사실을 제시하고 같은 호출을 다시 할 것(훅 설정·env 변경 금지) / 패키지 설치 명령 직접 실행 금지 / dev 브랜치·파일 개별 add·끝 두 줄.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/alembic/versions/c1d2e3f4a5b6_push_devices_post_notice.py` (신규) | `push_devices.post_notice BOOLEAN NOT NULL DEFAULT true` 추가·제거 |
| `backend/shared/models.py` (수정) | `PushDevice.post_notice` 컬럼 |
| `backend/apps/blog/push_schemas.py` (수정) | `PushDeviceIn.post_notice: bool = True` |
| `backend/apps/blog/repositories/push_repo.py` (수정) | `upsert_device`·`_apply` 가 `post_notice` 도 저장 |
| `backend/apps/blog/services/push_devices.py` (수정) | 스키마 → 저장소로 `post_notice` 전달 |
| `backend/apps/blog/schemas.py` (수정) | `BlogCreate.notify: bool = False`(요청 전용) |
| `backend/apps/blog/crud.py` (수정) | `create_blog` 가 `notify` 를 컬럼으로 넘기지 않음 |
| `backend/apps/blog/routers/blogs.py` (수정) | `notify` 참일 때만 `notify_new_post`, SSE 는 항상 |
| `backend/apps/collector/tasks/notifications.py` (수정) | `push_devices` 기반 대상·Expo 발송·무효 토큰 삭제·예외 삼킴 |
| `backend/tests/test_push_devices_api.py` (수정) | `post_notice` 저장·생략 시 true |
| `backend/tests/test_blog_create_notify.py` (신규) | 글 작성의 `notify` 위임 분기·SSE 유지 |
| `backend/tests/test_new_post_notification_task.py` (신규) | 대상 필터·메시지·무효 토큰 삭제·예외 삼킴 |
| `admin_web/src/types/api.ts` (수정) | `BlogCreate.notify?: boolean` |
| `admin_web/src/pages/BlogEditorPage.tsx` (수정) | 작성 화면에만 "앱 알림 보내기" 체크박스 |
| `mobile/src/features/push/registration-core.ts` (+test, 수정) | 등록 조건(로그인+권한), 플래그 서명 저장·해석(구버전 호환), `parsePostNotice` |
| `mobile/src/features/push/api.ts` (수정) | PUT 본문에 `fund_notice`·`post_notice` |
| `mobile/src/features/push/post-notice.ts` (신규) | 새 글 알림 설정 기기 저장(SecureStore, 기본 켜짐) |
| `mobile/src/features/push/registration.ts` (수정) | 새 의존성(`postNotice`·`saveSaved`·플래그 PUT) 연결 |
| `mobile/src/features/push/prompt-core.ts` (+test, 수정) | `postNoticeEnableAction`, `shouldPromptOnHome` |
| `mobile/src/features/push/post-notice-row.tsx` (신규) | 내정보 "새 글 알림" 스위치 행 |
| `mobile/src/app/(tabs)/profile.tsx` (수정) | 스위치 행 배치 |
| `mobile/src/features/push/push-prompt-sheet.tsx` (수정) | 문구 일반화("새 글·펀드 리포트 알림 받기") |
| `mobile/src/features/push/home-push-prompt.tsx` (신규) | 홈 탭 1회 안내 시트 |
| `mobile/src/app/(tabs)/index.tsx` (수정) | 홈에 `HomePushPrompt` 배치 |
| `mobile/src/features/push/handlers-core.ts` (+test, 수정) | 탭 경로 분기(`new_post`→`/blog/{id}`), 포그라운드 배너 판정, 채널 id |
| `mobile/src/features/push/handlers.ts` (수정) | 포그라운드 배너 분기, 두 채널 생성(`ensurePushChannels`), 탭 이동 |
| `mobile/src/app/fund/index.tsx` (수정, 주석 1줄) | "마지막 펀드를 지우면 알림 해제" 주석 → 실제 동작(펀드 알림 플래그만 끔) |
| `README.md`, `docs/push_notification_setup.md`, `docs/ROADMAP.md` (수정) | 새 글 알림 Expo 이전 반영 |

---

### 작업 1: 마이그레이션 + 모델 + `PUT /api/v1/push-devices` 의 `post_notice`

**파일:**
- 생성: `backend/alembic/versions/c1d2e3f4a5b6_push_devices_post_notice.py`
- 수정: `backend/shared/models.py:239-255`(`PushDevice`)
- 수정: `backend/apps/blog/push_schemas.py:13-16`(`PushDeviceIn`)
- 수정: `backend/apps/blog/repositories/push_repo.py:22-52`(`_apply`·`upsert_device`)
- 수정: `backend/apps/blog/services/push_devices.py:11-14`(`register`)
- 테스트: `backend/tests/test_push_devices_api.py`(파일 끝에 추가)

- [ ] **1-1. 실패하는 테스트 작성** — `backend/tests/test_push_devices_api.py` 파일 **끝에** 추가(기존 fixture `api`·`maker`, 헬퍼 `_users`·`_devices`, 상수 `TOKEN` 을 그대로 쓴다)

```python
async def test_put_saves_post_notice(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put(
        "/api/v1/push-devices",
        json={"token": TOKEN, "platform": "android", "fund_notice": False, "post_notice": False},
    )
    assert r.status_code == 204
    devs = await _devices(maker)
    assert len(devs) == 1
    assert (devs[0].fund_notice, devs[0].post_notice) == (False, False)


async def test_put_without_post_notice_defaults_true(api, maker):
    """구버전 앱(post_notice 를 안 보냄) 호환 — 생략하면 true 로 저장(설계 §6)."""
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    await client.put(
        "/api/v1/push-devices",
        json={"token": TOKEN, "platform": "android", "fund_notice": True, "post_notice": False},
    )
    assert (await _devices(maker))[0].post_notice is False
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "fund_notice": True})
    assert r.status_code == 204
    devs = await _devices(maker)
    assert len(devs) == 1 and devs[0].post_notice is True and devs[0].fund_notice is True


async def test_put_rejects_non_bool_post_notice(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put(
        "/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "post_notice": "yes please"}
    )
    assert r.status_code == 422


async def test_model_default_post_notice_true(maker):
    """post_notice 를 지정하지 않은 행(기존 코드·테스트 경로)은 true."""
    a, _ = await _users(maker)
    async with maker() as s:
        s.add(PushDevice(token=TOKEN, user_id=a.id, platform="android", fund_notice=True))
        await s.commit()
    assert (await _devices(maker))[0].post_notice is True
```

- [ ] **1-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_push_devices_api.py`
예상: 새 테스트 4개 FAIL(`AttributeError: 'PushDevice' object has no attribute 'post_notice'` 류, `test_put_rejects_non_bool_post_notice` 는 204 반환으로 FAIL), 기존 테스트는 PASS.

- [ ] **1-3. 모델 컬럼 추가** — `backend/shared/models.py`

`class PushDevice` 의 docstring 과 `fund_notice` 정의를 다음으로 바꾼다(`fund_notice` 아래에 `post_notice` 추가):

```python
class PushDevice(Base, TimestampMixin):
    """기기 단위 Expo 푸시 토큰. 알림 종류별 수신 여부(fund_notice·post_notice)를 기기마다 둔다(users.fcm_token 과 별개)."""
```

```python
    fund_notice: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )
    # 새 글 알림 수신(앱 내정보 스위치). 구버전 앱은 보내지 않으므로 기본 true
    post_notice: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )
```

- [ ] **1-4. 마이그레이션** — `backend/alembic/versions/c1d2e3f4a5b6_push_devices_post_notice.py`

```python
"""새 글 알림 — push_devices.post_notice(기기별 새 글 알림 수신 여부, 기존 행은 true)

Revision ID: c1d2e3f4a5b6
Revises: b9c0d1e2f3a4
Create Date: 2026-10-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c1d2e3f4a5b6"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "push_devices",
        sa.Column("post_notice", sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("push_devices", "post_notice")
```

head 가 하나인지 확인:
```bash
cd backend && grep -rl 'down_revision = "b9c0d1e2f3a4"' alembic/versions && uv run alembic heads
```
예상: 파일은 `alembic/versions/c1d2e3f4a5b6_push_devices_post_notice.py` 하나, `alembic heads` 는 `c1d2e3f4a5b6 (head)` 한 줄.

- [ ] **1-5. 스키마** — `backend/apps/blog/push_schemas.py` 의 `PushDeviceIn` 을 다음으로 바꾼다

```python
class PushDeviceIn(BaseModel):
    token: str = Field(min_length=1, max_length=255, pattern=EXPO_TOKEN_PATTERN)
    platform: Literal["android", "ios"]
    fund_notice: bool = True
    # 새 글 알림. 생략 시 true — 구버전 앱(펀드 기기만 등록, 이 필드 없음) 호환(설계 §6)
    post_notice: bool = True
```

- [ ] **1-6. 저장소** — `backend/apps/blog/repositories/push_repo.py` 의 `_apply` 와 `upsert_device` 를 다음으로 바꾼다(나머지 함수는 그대로)

```python
def _apply(dev: PushDevice, *, user_id: int, platform: str, fund_notice: bool, post_notice: bool) -> None:
    dev.user_id = user_id
    dev.platform = platform
    dev.fund_notice = fund_notice
    dev.post_notice = post_notice
    dev.updated_at = func.now()  # 값이 같아도 마지막 등록 시각 갱신(오래된 토큰 정리용)


async def upsert_device(
    db: AsyncSession,
    *,
    token: str,
    user_id: int,
    platform: str,
    fund_notice: bool,
    post_notice: bool = True,
) -> None:
    """token 기준 upsert — 다른 사용자 토큰이면 소유자를 바꾼다(같은 기기에서 계정을 바꾼 경우).

    같은 token 의 PUT 이 겹쳐 insert 가 UNIQUE 위반이 나면 롤백 후 기존 행을 갱신한다(1회 재시도).
    """
    fields = {"user_id": user_id, "platform": platform, "fund_notice": fund_notice, "post_notice": post_notice}
    dev = await _find_by_token(db, token)
    if dev is None:
        db.add(PushDevice(token=token, **fields))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            dev = await _find_by_token(db, token)
            if dev is None:
                raise
            _apply(dev, **fields)
            await db.commit()
    else:
        _apply(dev, **fields)
        await db.commit()
```

(`post_notice` 기본값 `True` 는 기존 테스트 `test_upsert_race_retries_on_integrity_error` 가 인자 없이 부르는 것을 깨지 않기 위함.)

- [ ] **1-7. 서비스** — `backend/apps/blog/services/push_devices.py` 의 `register` 를 다음으로 바꾼다

```python
async def register(db: AsyncSession, *, user_id: int, payload: PushDeviceIn) -> None:
    await push_repo.upsert_device(
        db,
        token=payload.token,
        user_id=user_id,
        platform=payload.platform,
        fund_notice=payload.fund_notice,
        post_notice=payload.post_notice,
    )
```

- [ ] **1-8. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_push_devices_api.py tests/test_push_sends_task.py`
예상: 전부 PASS(새 4개 포함). 이어서 전체: `cd backend && uv run pytest -p no:warnings -q` → 실패 0, 총 1344개(1340 + 4).

- [ ] **1-9. 마이그레이션 실제 PostgreSQL 왕복 확인(일회용 컨테이너)**

pytest 는 SQLite `create_all` 이라 마이그레이션 파일을 실행하지 않는다 — 배포 때 처음 돌다 깨지지 않게 여기서 확인한다(개발서버 DB·터널 15432 사용 금지).

```bash
docker run -d --rm --name post-notice-mig-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=mig -p 55432:5432 postgres:16
for i in $(seq 1 30); do docker exec post-notice-mig-pg pg_isready -U postgres -q && break; perl -e 'select(undef,undef,undef,1)'; done
cd backend
export ALEMBIC_DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:55432/mig
uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
docker exec post-notice-mig-pg psql -U postgres -d mig -Atc "select column_default, is_nullable from information_schema.columns where table_name='push_devices' and column_name='post_notice'; select version_num from alembic_version;"
unset ALEMBIC_DATABASE_URL
docker stop post-notice-mig-pg
```
예상: 세 alembic 명령 모두 오류 없음. psql 출력 `true|NO` 와 `c1d2e3f4a5b6`. 컨테이너는 `--rm` 이라 stop 으로 사라진다. 실패하면 마이그레이션을 고치고 다시 — 커밋하지 않는다.

- [ ] **1-10. 커밋**

```bash
git add backend/alembic/versions/c1d2e3f4a5b6_push_devices_post_notice.py
git add backend/shared/models.py
git add backend/apps/blog/push_schemas.py
git add backend/apps/blog/repositories/push_repo.py
git add backend/apps/blog/services/push_devices.py
git add backend/tests/test_push_devices_api.py
git commit -m "$(cat <<'EOF'
feat(blog): push_devices.post_notice — 기기별 새 글 알림 수신 여부, PUT 에서 생략하면 true(구버전 앱 호환)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 2: 글 작성 `BlogCreate.notify` — 고른 글만 앱 알림 위임

**파일:**
- 수정: `backend/apps/blog/schemas.py:55-56`(`BlogCreate`)
- 수정: `backend/apps/blog/crud.py:94-99`(`create_blog`)
- 수정: `backend/apps/blog/routers/blogs.py:33-57`(`create_blog`)
- 테스트: `backend/tests/test_blog_create_notify.py`(신규)

- [ ] **2-1. 실패하는 테스트 작성** — `backend/tests/test_blog_create_notify.py`

```python
"""글 작성 — notify 가 참일 때만 앱 알림(Celery) 위임, 웹 SSE new_post 는 항상 발행."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from apps.blog.routers import blogs as blogs_router
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, BlogPost, Board, User, UserRole


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def api(maker, monkeypatch):
    notified: list[int] = []
    events: list[dict] = []

    # blogs.py 가 이름으로 import 하므로 라우터 모듈의 이름을 바꿔 끼운다(실제 Celery·Redis 접근 없음)
    monkeypatch.setattr(blogs_router, "notify_new_post", lambda post_id: notified.append(post_id))

    async def _publish(event: dict) -> None:
        events.append(event)

    monkeypatch.setattr(blogs_router, "publish_event", _publish)

    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        board = Board(name="공지", order_index=0)
        s.add_all([admin, board])
        await s.commit()

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return admin  # ADMIN 이므로 require_admin 도 통과

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, board.id, notified, events
    app.dependency_overrides.clear()


def _body(board_id: int, **extra) -> dict:
    return {"board_id": board_id, "title": "새 글 제목", "content": "<p>본문</p>", **extra}


async def test_notify_omitted_does_not_delegate_but_publishes_sse(api):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id))
    assert r.status_code == 201
    assert notified == []
    assert [e["type"] for e in events] == ["new_post"] and events[0]["post_id"] == r.json()["id"]


async def test_notify_false_does_not_delegate(api):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=False))
    assert r.status_code == 201
    assert notified == []
    assert len(events) == 1


async def test_notify_true_delegates_and_publishes(api, maker):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=True))
    assert r.status_code == 201
    post_id = r.json()["id"]
    assert notified == [post_id]
    assert len(events) == 1
    async with maker() as s:  # notify 는 컬럼이 아니다 — 글은 정상 저장
        post = (await s.execute(select(BlogPost).where(BlogPost.id == post_id))).scalar_one()
        assert post.title == "새 글 제목"


async def test_response_has_no_notify_field(api):
    client, board_id, _, _ = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=True))
    assert "notify" not in r.json()
```

- [ ] **2-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_blog_create_notify.py`
예상: `test_notify_omitted_does_not_delegate_but_publishes_sse`·`test_notify_false_does_not_delegate` FAIL(`notified == [id]` — 지금은 항상 위임). `notify=True` 두 테스트는 pydantic 이 모르는 필드를 무시해 PASS 일 수 있다.

- [ ] **2-3. 스키마** — `backend/apps/blog/schemas.py` 의 `BlogCreate` 를 다음으로 바꾼다

```python
class BlogCreate(BlogBase):
    author_id: int | None = Field(None, description="작성자 ID (선택)")
    # 요청 전용(DB 에 저장하지 않음) — 참이면 앱 새 글 푸시를 보낸다. 웹 SSE 는 이 값과 무관하게 발행
    notify: bool = Field(False, description="앱 알림 보내기")
```

- [ ] **2-4. crud** — `backend/apps/blog/crud.py` 의 `create_blog` 를 다음으로 바꾼다

```python
async def create_blog(db: AsyncSession, data: schemas.BlogCreate) -> BlogPost:
    post = BlogPost(**data.model_dump(exclude={"notify"}))  # notify 는 요청 전용 — 컬럼이 아니다
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post
```

- [ ] **2-5. 라우터** — `backend/apps/blog/routers/blogs.py` 의 `create_blog` 본문 중 위임 부분을 다음으로 바꾼다

바꾸기 전:
```python
    post = await crud.create_blog(db, payload)
    # (모바일) 새 글 알림을 Celery 워커로 위임 — FCM 발송
    notify_new_post(post.id)
```
바꾼 뒤:
```python
    post = await crud.create_blog(db, payload)
    # (모바일) 관리자가 "앱 알림 보내기"를 고른 글만 Celery 워커로 위임 — Expo 푸시
    if payload.notify:
        notify_new_post(post.id)
```
(아래 `publish_event({...})` SSE 발행은 그대로 둔다.)

- [ ] **2-6. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_blog_create_notify.py tests/test_blog_featured.py`
예상: 전부 PASS. 이어서 전체: `cd backend && uv run pytest -p no:warnings -q` → 실패 0, 총 1348개(1344 + 4).

- [ ] **2-7. 커밋**

```bash
git add backend/apps/blog/schemas.py
git add backend/apps/blog/crud.py
git add backend/apps/blog/routers/blogs.py
git add backend/tests/test_blog_create_notify.py
git commit -m "$(cat <<'EOF'
feat(blog): 글 작성 notify — 관리자가 고른 글만 앱 새 글 알림 위임, 웹 SSE 는 기존대로 항상

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 3: 발송 태스크 `send_new_post_notification` — push_devices · Expo 발송

**파일:**
- 수정(전체 교체): `backend/apps/collector/tasks/notifications.py`
- 테스트: `backend/tests/test_new_post_notification_task.py`(신규)

- [ ] **3-1. 실패하는 테스트 작성** — `backend/tests/test_new_post_notification_task.py`

```python
"""send_new_post_notification — 대상(역할 등급·post_notice·활성 사용자)·메시지·무효 토큰 삭제·예외 삼킴."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from apps.collector.push.base import BatchResult, PushSender
from apps.collector.tasks import notifications
from shared.models import Base, BlogPost, Board, PushDevice, User, UserRole


class FakeSender(PushSender):
    def __init__(self, invalid: frozenset[str] = frozenset(), boom: bool = False):
        self.calls: list[tuple[list[str], object]] = []
        self.invalid = invalid
        self.boom = boom

    def send(self, token, message):  # pragma: no cover - send_batch 만 쓴다
        return True

    def send_batch(self, tokens, message):
        self.calls.append((list(tokens), message))
        if self.boom:
            raise RuntimeError("expo down")
        bad = [t for t in tokens if t in self.invalid]
        return BatchResult(success=len(tokens) - len(bad), failure=len(bad), invalid_tokens=bad)


@pytest.fixture
def maker(monkeypatch):
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    mk = sessionmaker(engine, class_=Session, expire_on_commit=False)
    monkeypatch.setattr(notifications, "SyncSessionLocal", mk)
    yield mk
    engine.dispose()


def _seed(mk, *, board_role: UserRole = UserRole.FREE) -> int:
    """기기 5개: free(on), premium(on), free(off), inactive(on), admin(on). 반환은 글 id."""
    with mk() as db:
        free = User(nickname="무료", role=UserRole.FREE, is_active=True)
        premium = User(nickname="유료", role=UserRole.PREMIUM, is_active=True)
        off = User(nickname="끔", role=UserRole.FREE, is_active=True)
        gone = User(nickname="휴면", role=UserRole.FREE, is_active=False)
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        db.add_all([free, premium, off, gone, admin])
        db.flush()
        db.add_all([
            PushDevice(token="ExponentPushToken[free]", user_id=free.id, platform="android", fund_notice=False, post_notice=True),
            PushDevice(token="ExponentPushToken[premium]", user_id=premium.id, platform="ios", fund_notice=True, post_notice=True),
            PushDevice(token="ExponentPushToken[off]", user_id=off.id, platform="android", fund_notice=True, post_notice=False),
            PushDevice(token="ExponentPushToken[gone]", user_id=gone.id, platform="android", fund_notice=True, post_notice=True),
            PushDevice(token="ExponentPushToken[admin]", user_id=admin.id, platform="android", fund_notice=False, post_notice=True),
        ])
        board = Board(name="공지", order_index=0, min_role_required=board_role)
        db.add(board)
        db.flush()
        post = BlogPost(board_id=board.id, title="오늘의 시장", content="<p>x</p>")
        db.add(post)
        db.commit()
        return post.id


def _use(monkeypatch, sender: FakeSender) -> None:
    monkeypatch.setattr(notifications, "get_push_sender", lambda: sender)


def test_free_board_targets_active_post_notice_devices(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)
    tokens, msg = sender.calls[0]
    assert sorted(tokens) == [
        "ExponentPushToken[admin]", "ExponentPushToken[free]", "ExponentPushToken[premium]",
    ]  # post_notice=false·비활성 사용자는 제외, 펀드 여부(fund_notice)는 무관
    assert msg.title == "[공지] 새 글" and msg.body == "오늘의 시장"
    assert msg.data["type"] == "new_post" and msg.data["post_id"] == pid
    assert msg.channel_id == "blog-post" and msg.sound == "default"
    assert out == {"post_id": pid, "status": "ok", "recipients": 3, "success": 3, "failure": 0, "invalid": 0}


def test_premium_board_excludes_lower_roles(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    pid = _seed(maker, board_role=UserRole.PREMIUM)
    notifications.send_new_post_notification(pid)
    assert sorted(sender.calls[0][0]) == ["ExponentPushToken[admin]", "ExponentPushToken[premium]"]


def test_invalid_tokens_are_deleted(maker, monkeypatch):
    sender = FakeSender(invalid=frozenset({"ExponentPushToken[free]"}))
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)
    assert out["invalid"] == 1 and out["failure"] == 1 and out["success"] == 2
    with maker() as db:
        left = set(db.execute(select(PushDevice.token)).scalars())
    assert "ExponentPushToken[free]" not in left and "ExponentPushToken[off]" in left


def test_sender_exception_is_swallowed(maker, monkeypatch):
    sender = FakeSender(boom=True)
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)  # 예외가 밖으로 나오면 Celery 가 재시도 → 중복 발송
    assert out["status"] == "ok" and out["success"] == 0 and out["failure"] == 3
    with maker() as db:
        assert len(list(db.execute(select(PushDevice.token)).scalars())) == 5  # 아무것도 지우지 않음


def test_missing_post(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    out = notifications.send_new_post_notification(999)
    assert out["status"] == "post_not_found" and out["recipients"] == 0
    assert sender.calls == []


def test_unexpected_error_is_swallowed(maker, monkeypatch):
    def broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(notifications, "SyncSessionLocal", broken)
    out = notifications.send_new_post_notification(1)
    assert out == {"post_id": 1, "status": "failed"}


def test_no_targets_skips_sender(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    with maker() as db:
        board = Board(name="빈", order_index=0)
        db.add(board)
        db.flush()
        post = BlogPost(board_id=board.id, title="t", content="c")
        db.add(post)
        db.commit()
        pid = post.id
    out = notifications.send_new_post_notification(pid)
    assert sender.calls == [] and out["recipients"] == 0 and out["status"] == "ok"
```

- [ ] **3-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_new_post_notification_task.py`
예상: 대부분 FAIL — 지금 태스크는 `users.fcm_token` 을 읽어 `sender.calls` 가 비고(`IndexError`), 반환 키도 `sent` 다.

- [ ] **3-3. 태스크 교체** — `backend/apps/collector/tasks/notifications.py` 전체를 다음으로 바꾼다

```python
"""새 글 푸시 알림 Celery 태스크(blog 가 글 작성 시 notify=true 일 때만 위임).

대상: push_devices ⨝ users — 활성 사용자이고, 역할 등급이 게시판 min_role_required 이상이며,
기기의 post_notice 가 켜진 토큰. users.fcm_token 은 더 이상 읽지 않는다(컬럼은 유지).
발송 이력(push_sends)은 남기지 않고 로그와 반환 dict 로만 결과를 남긴다.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, select

from shared.database import SyncSessionLocal
from shared.models import Board, BlogPost, PushDevice, User, UserRole

from ..celery_app import celery_app
from ..push import PushMessage, get_push_sender
from ..push.base import BatchResult

logger = logging.getLogger("tasks.notifications")

NEW_POST_CHANNEL_ID = "blog-post"  # 앱 handlers-core.POST_CHANNEL_ID 와 같은 값

# 권한 서열 (값이 클수록 상위 권한)
_ROLE_LEVEL = {UserRole.FREE: 0, UserRole.PREMIUM: 1, UserRole.ADMIN: 2}


@celery_app.task(name="collector.send_new_post_notification")
def send_new_post_notification(post_id: int) -> dict:
    """새 글 알림을 대상 기기에 발송한다. 예외는 로그 후 삼킨다(재시도로 인한 중복 발송 방지)."""
    try:
        return _run(post_id)
    except Exception:  # noqa: BLE001
        logger.exception("send_new_post_notification: 처리 중 예외(post_id=%s)", post_id)
        return {"post_id": post_id, "status": "failed"}


def _run(post_id: int) -> dict:
    with SyncSessionLocal() as db:
        post = db.get(BlogPost, post_id)
        if post is None:
            logger.warning("send_new_post_notification: post %s 없음", post_id)
            return {"post_id": post_id, "status": "post_not_found", "recipients": 0,
                    "success": 0, "failure": 0, "invalid": 0}
        board = db.get(Board, post.board_id)
        required = _ROLE_LEVEL.get(board.min_role_required if board else UserRole.FREE, 0)
        title = f"[{board.name}] 새 글" if board else "새 글"
        body = post.title
        board_id = post.board_id

        rows = db.execute(
            select(PushDevice.token, User.role)
            .join(User, User.id == PushDevice.user_id)
            .where(PushDevice.post_notice.is_(True), User.is_active.is_(True))
        ).all()
        tokens = [token for token, role in rows if _ROLE_LEVEL.get(role, 0) >= required]

        result = BatchResult()
        if tokens:
            message = PushMessage(
                title=title,
                body=body,
                data={"type": "new_post", "post_id": post_id, "board_id": board_id},
                channel_id=NEW_POST_CHANNEL_ID,
                sound="default",
            )
            try:
                result = get_push_sender().send_batch(tokens, message)
            except Exception as exc:  # noqa: BLE001 - 발송기 오류는 전부 실패로 집계
                logger.warning("send_new_post_notification: 발송기 오류(post_id=%s): %s", post_id, exc)
                result = BatchResult(failure=len(tokens))

        if result.invalid_tokens:
            db.execute(delete(PushDevice).where(PushDevice.token.in_(result.invalid_tokens)))
            db.commit()

    logger.info(
        "send_new_post_notification: post=%s recipients=%s ok=%s fail=%s invalid=%s",
        post_id, len(tokens), result.success, result.failure, len(result.invalid_tokens),
    )
    return {
        "post_id": post_id,
        "status": "ok",
        "recipients": len(tokens),
        "success": result.success,
        "failure": result.failure,
        "invalid": len(result.invalid_tokens),
    }
```

- [ ] **3-4. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings -q tests/test_new_post_notification_task.py tests/test_push_sends_task.py tests/test_expo_push.py`
예상: 전부 PASS. 이어서 전체: `cd backend && uv run pytest -p no:warnings -q` → 실패 0, 총 1355개(1348 + 7).

- [ ] **3-5. (선택) 로컬 워커 스모크 — Mock 발송기**

실제 기기로 보내지 않는 확인. 실행하려면 일회용 DB 가 필요하므로(개발서버 DB 에 테스트 글 금지) 생략해도 된다. 실행할 때는 반드시 `REDIS_URL=redis://localhost:6379/5`, `PUSH_BACKEND=mock`(셸 env 로만, env 파일 수정 금지)으로 워커를 띄우고, 끝나면 `redis-cli -n 5 FLUSHDB`.

- [ ] **3-6. 커밋**

```bash
git add backend/apps/collector/tasks/notifications.py
git add backend/tests/test_new_post_notification_task.py
git commit -m "$(cat <<'EOF'
feat(collector): 새 글 알림을 push_devices·Expo 발송기로 이전 — 역할 등급·post_notice·활성 사용자 대상, 무효 토큰 삭제, 예외 삼킴

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---
### 작업 4: admin_web — 글 작성 화면 "앱 알림 보내기" 체크박스

**파일:**
- 수정: `admin_web/src/types/api.ts:65-71`(`BlogCreate`)
- 수정: `admin_web/src/pages/BlogEditorPage.tsx`

admin_web 에는 테스트 러너가 없다 — 타입 검사 + 브라우저 확인으로 검증한다.

- [ ] **4-1. 타입** — `admin_web/src/types/api.ts` 의 `BlogCreate` 를 다음으로 바꾼다

```ts
export interface BlogCreate {
  board_id: number
  title: string
  content: string
  thumbnail_url?: string | null
  author_id?: number | null
  notify?: boolean // 요청 전용 — 참이면 앱 새 글 푸시(작성 때만, 수정에는 없음)
}
```

- [ ] **4-2. 상태 추가** — `admin_web/src/pages/BlogEditorPage.tsx`

`const [error, setError] = useState('')` 바로 아래에 추가:
```tsx
  const [notify, setNotify] = useState(false) // 앱 알림 보내기(작성 때만, 기본 꺼짐)
```

- [ ] **4-3. 작성·수정 요청 분리** — 같은 파일 `onSubmit` 의 `if (isEdit) { ... } else { ... }` 블록을 다음으로 바꾼다

바꾸기 전:
```tsx
      if (isEdit) {
        await updateBlog(id!, payload) // isEdit 분기 → id 존재
      } else {
        await createBlog(payload)
      }
```
바꾼 뒤:
```tsx
      if (isEdit) {
        await updateBlog(id!, payload) // isEdit 분기 → id 존재. 수정은 알림을 보내지 않는다
      } else {
        await createBlog({ ...payload, notify })
      }
```

- [ ] **4-4. 체크박스** — 같은 파일에서 `<RichTextEditor ... />` 를 감싼 `<div>` 가 끝난 직후, 버튼 줄(`<div className="flex justify-end gap-2">`) 바로 앞에 추가:

```tsx
        {!isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            앱 알림 보내기
            <span className="text-xs text-slate-400">
              (새 글 알림을 켠 앱 기기에 푸시를 보냅니다. 웹 실시간 알림은 체크와 상관없이 나갑니다)
            </span>
          </label>
        )}
```

- [ ] **4-5. 타입 검사**

실행: `cd admin_web && npx tsc --noEmit`
예상: 출력 없음(오류 0).

- [ ] **4-6. 브라우저 확인(선택, 일회용 DB 일 때만)**

`npm run dev` 로 띄울 수 있으면 `/blogs/new` 에 체크박스가 보이고 `/blogs/:id/edit` 에는 없는지, 개발자 도구 Network 의 `POST /blogs` 본문에 `"notify":true|false` 가 실리는지 본다. 개발서버 DB 에 글을 만들지 않는다 — 불가하면 생략하고 타입 검사로 갈음.

- [ ] **4-7. 커밋**

```bash
git add admin_web/src/types/api.ts
git add admin_web/src/pages/BlogEditorPage.tsx
git commit -m "$(cat <<'EOF'
feat(admin_web): 글 작성 화면에 "앱 알림 보내기" 체크박스(기본 꺼짐, 수정 화면엔 없음)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 5: 모바일 — 등록 조건(로그인 + 권한) · 플래그 서명 저장 · PUT 플래그

**파일:**
- 수정(전체 교체): `mobile/src/features/push/registration-core.ts`
- 수정(전체 교체): `mobile/src/features/push/registration-core.test.ts`
- 수정: `mobile/src/features/push/api.ts`(`putPushDevice`)
- 생성: `mobile/src/features/push/post-notice.ts`
- 수정(전체 교체): `mobile/src/features/push/registration.ts`
- 수정: `mobile/src/app/fund/index.tsx:143`(주석 1줄)

**구버전 저장값 처리:** 키 `push_device_v1` 은 그대로. 값이 `{` 로 시작하면 새 형식(JSON), 아니면 구버전(Expo 토큰 문자열 — 항상 `Expo` 로 시작)으로 읽는다. 구버전은 플래그가 `null` 이라 서명이 달라 **첫 동기화에서 한 번 다시 PUT** 하고 새 형식으로 덮어쓴다. 해제(로그아웃·권한 회수)는 두 형식 모두에서 순수 토큰을 꺼내 DELETE 한다. JSON 이 깨져 있으면 "저장 없음"으로 보고 다시 등록한다(해제할 토큰을 모르므로 DELETE 는 생략 — 서버의 그 행은 같은 토큰 재등록 때 덮인다).

- [ ] **5-1. 실패하는 테스트 작성** — `mobile/src/features/push/registration-core.test.ts` 전체를 다음으로 바꾼다

```ts
import {
  createPushRegistrar,
  decodeSaved,
  encodeSaved,
  parsePostNotice,
  sameRegistration,
  syncPushRegistrationWith,
  unregisterWith,
  withTimeout,
  type SyncDeps,
} from './registration-core';

const TOKEN = 'ExponentPushToken[a]';
const BOTH_ON = { fundNotice: true, postNotice: true };

const mk = (over: Partial<SyncDeps> = {}) => {
  const saved = { v: null as string | null };
  const d: SyncDeps = {
    isConfigured: () => true,
    authToken: () => 'jwt',
    countFunds: async () => 1,
    postNotice: async () => true,
    permission: async () => 'granted',
    getPushToken: async () => TOKEN,
    loadSaved: async () => saved.v,
    saveSaved: jest.fn(async (raw: string | null) => {
      saved.v = raw;
    }),
    put: jest.fn(async () => {}),
    del: jest.fn(async () => {}),
    ...over,
  };
  return { d, saved };
};

describe('저장값 서명', () => {
  it('encode → decode 왕복', () => {
    expect(decodeSaved(encodeSaved(TOKEN, { fundNotice: false, postNotice: true }))).toEqual({
      token: TOKEN,
      fundNotice: false,
      postNotice: true,
    });
  });

  it('구버전 값(토큰 문자열만)은 플래그 null 로 읽는다', () => {
    expect(decodeSaved(TOKEN)).toEqual({ token: TOKEN, fundNotice: null, postNotice: null });
  });

  it('비었거나 깨진 값은 null', () => {
    expect(decodeSaved(null)).toBeNull();
    expect(decodeSaved('')).toBeNull();
    expect(decodeSaved('{broken')).toBeNull();
    expect(decodeSaved('{"v":2}')).toBeNull();
  });

  it('토큰·두 플래그가 모두 같아야 같은 등록', () => {
    const s = decodeSaved(encodeSaved(TOKEN, BOTH_ON));
    expect(sameRegistration(s, TOKEN, BOTH_ON)).toBe(true);
    expect(sameRegistration(s, TOKEN, { fundNotice: true, postNotice: false })).toBe(false);
    expect(sameRegistration(s, TOKEN, { fundNotice: false, postNotice: true })).toBe(false);
    expect(sameRegistration(s, 'ExponentPushToken[b]', BOTH_ON)).toBe(false);
    expect(sameRegistration(decodeSaved(TOKEN), TOKEN, BOTH_ON)).toBe(false); // 구버전 → 다시 PUT
    expect(sameRegistration(null, TOKEN, BOTH_ON)).toBe(false);
  });
});

describe('parsePostNotice', () => {
  it("저장값이 '0' 일 때만 꺼짐, 없으면 기본 켜짐", () => {
    expect(parsePostNotice(null)).toBe(true);
    expect(parsePostNotice('1')).toBe(true);
    expect(parsePostNotice('0')).toBe(false);
  });
});

describe('syncPushRegistrationWith', () => {
  it('설정 안 됨이면 아무것도 안 한다', async () => {
    const { d } = mk({ isConfigured: () => false });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('skipped');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그인·권한이 있으면 두 플래그와 함께 PUT 하고 서명을 저장한다', async () => {
    const { d, saved } = mk();
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, BOTH_ON);
    expect(decodeSaved(saved.v)).toEqual({ token: TOKEN, ...BOTH_ON });
  });

  it('펀드가 0개여도 등록한다(fund_notice=false)', async () => {
    const { d, saved } = mk({ countFunds: async () => 0 });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, { fundNotice: false, postNotice: true });
    expect(d.del).not.toHaveBeenCalled();
    expect(decodeSaved(saved.v)?.fundNotice).toBe(false);
  });

  it('새 글 알림을 끄면 post_notice=false 로 등록한다', async () => {
    const { d } = mk({ postNotice: async () => false });
    await syncPushRegistrationWith(d);
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, { fundNotice: true, postNotice: false });
  });

  it('토큰·플래그가 저장값과 같으면 PUT 을 생략한다', async () => {
    const { d, saved } = mk();
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('플래그만 바뀌어도 다시 PUT 한다', async () => {
    const { d, saved } = mk({ postNotice: async () => false });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledTimes(1);
    expect(decodeSaved(saved.v)?.postNotice).toBe(false);
  });

  it('구버전 저장값(토큰만)이면 한 번 다시 PUT 하고 새 형식으로 바꾼다', async () => {
    const { d, saved } = mk();
    saved.v = TOKEN;
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledTimes(1);
    expect(saved.v).toBe(encodeSaved(TOKEN, BOTH_ON));
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).toHaveBeenCalledTimes(1);
  });

  it('권한이 없어지면 저장된 순수 토큰으로 DELETE 한다', async () => {
    const { d, saved } = mk({ permission: async () => 'denied' });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unregistered');
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('권한이 없고 저장값도 없으면 아무것도 안 한다', async () => {
    const { d } = mk({ permission: async () => 'denied' });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.put).not.toHaveBeenCalled();
    expect(d.del).not.toHaveBeenCalled();
  });

  it('로그아웃 상태면 서버 호출 없이 끝난다', async () => {
    const { d, saved } = mk({ authToken: () => null });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.del).not.toHaveBeenCalled();
    expect(d.put).not.toHaveBeenCalled();
  });

  it('실패는 조용히 failed 로 끝나고 저장값은 그대로', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('failed');
    expect(saved.v).toBeNull();
  });
});

describe('unregisterWith', () => {
  it('저장된 토큰을 주어진 인증 토큰으로 지우고 비운다(실패해도 비운다)', async () => {
    const { d, saved } = mk({ del: jest.fn(async () => Promise.reject(new Error('401'))) });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await unregisterWith(d, 'old-jwt');
    expect(d.del).toHaveBeenCalledWith('old-jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('구버전 저장값(토큰만)도 순수 토큰으로 지운다', async () => {
    const { d, saved } = mk();
    saved.v = TOKEN;
    await unregisterWith(d, 'jwt');
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('저장된 토큰이 없으면 호출하지 않는다', async () => {
    const { d } = mk();
    await unregisterWith(d, 'jwt');
    expect(d.del).not.toHaveBeenCalled();
  });
});

describe('createPushRegistrar (직렬화)', () => {
  it('put 진행 중 해제 요청이 오면 최종 상태가 해제됨', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, saved } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s = reg.sync(); // put 대기 중
    const u = reg.unregister('jwt'); // 로그아웃 훅
    release();
    await expect(s).resolves.toBe('registered');
    await u;
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('앞 작업이 실패해도 다음 작업은 실행된다', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    const reg = createPushRegistrar(d);
    await expect(reg.sync()).resolves.toBe('failed');
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await reg.unregister('jwt');
    expect(saved.v).toBeNull();
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('시간 안에 안 끝나면 reject', async () => {
    const p = withTimeout(new Promise<void>(() => {}), 1000);
    const assertion = expect(p).rejects.toThrow('timeout');
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('끝나면 값을 돌려주고 타이머를 정리한다', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('원본이 reject 되면 그대로 전달하고 타이머를 정리한다', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('토큰 조회가 멈춰 timeout 되면 sync 는 failed 로 끝난다', async () => {
    const { d } = mk({ getPushToken: () => withTimeout(new Promise<string>(() => {}), 1000) });
    const r = syncPushRegistrationWith(d);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(r).resolves.toBe('failed');
  });
});

describe('createPushRegistrar 합치기', () => {
  it('대기 중인 sync 가 있으면 새 sync 요청을 합친다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s1 = reg.sync(); // 실행 시작(put 대기)
    await Promise.resolve();
    const s2 = reg.sync(); // 큐에서 대기
    const s3 = reg.sync(); // s2 와 합쳐짐
    expect(s3).toBe(s2);
    release();
    await Promise.all([s1, s2]);
    expect(d.put).toHaveBeenCalledTimes(1); // 두 번째는 서명이 같아 unchanged
  });

  it('대기 sync → unregister → 새 sync 는 합쳐지지 않고 해제 뒤에 실행되어 최종 등록된다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, saved } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s1 = reg.sync(); // 실행 시작(put 대기)
    await Promise.resolve();
    const s2 = reg.sync(); // 큐에서 대기
    const u = reg.unregister('jwt');
    const s3 = reg.sync(); // 해제 뒤에 새로 줄을 서야 함
    expect(s3).not.toBe(s2);
    release();
    await Promise.all([s1, s2, u]);
    await expect(s3).resolves.toBe('registered');
    expect(decodeSaved(saved.v)?.token).toBe(TOKEN);
  });
});
```

- [ ] **5-2. 실패 확인**

실행: `cd mobile && npx jest src/features/push/registration-core.test.ts`
예상: FAIL — `decodeSaved`·`encodeSaved`·`parsePostNotice`·`sameRegistration` 가 export 되지 않음(타입 오류 또는 `is not a function`).

- [ ] **5-3. 순수 로직 교체** — `mobile/src/features/push/registration-core.ts` 전체를 다음으로 바꾼다

```ts
// 푸시 토큰 등록 동기화 — 순수 로직(의존성 주입). 실패는 조용히(다음 시점 재시도).
export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** 서버에 함께 보내는 알림 종류별 수신 여부 */
export type PushFlags = { fundNotice: boolean; postNotice: boolean };

/** 기기에 저장한 마지막 등록. 구버전 저장값(토큰만)은 플래그가 null */
export type SavedDevice = { token: string; fundNotice: boolean | null; postNotice: boolean | null };

export type SyncDeps = {
  isConfigured: () => boolean;
  authToken: () => string | null;
  countFunds: () => Promise<number>;
  postNotice: () => Promise<boolean>;
  permission: () => Promise<PushPermission>;
  getPushToken: () => Promise<string>;
  loadSaved: () => Promise<string | null>;
  saveSaved: (raw: string | null) => Promise<void>;
  put: (authToken: string, pushToken: string, flags: PushFlags) => Promise<void>;
  del: (authToken: string, pushToken: string) => Promise<void>;
};

export type SyncResult = 'skipped' | 'registered' | 'unchanged' | 'unregistered' | 'idle' | 'failed';

/** 새 글 알림 설정 저장값 → 켜짐 여부. '0' 만 꺼짐(없으면 기본 켜짐) */
export const parsePostNotice = (raw: string | null): boolean => raw !== '0';

export function encodeSaved(token: string, f: PushFlags): string {
  return JSON.stringify({ v: 2, token, fund: f.fundNotice, post: f.postNotice });
}

/**
 * 저장값 해석. '{' 로 시작하면 새 형식(JSON), 아니면 구버전(Expo 토큰 문자열 그대로) — 플래그 null 이라
 * 서명이 달라 한 번 다시 PUT 된다. 깨진 JSON 은 null(저장 없음으로 보고 다시 등록).
 */
export function decodeSaved(raw: string | null): SavedDevice | null {
  if (!raw) return null;
  if (!raw.startsWith('{')) return { token: raw, fundNotice: null, postNotice: null };
  try {
    const o = JSON.parse(raw) as { token?: unknown; fund?: unknown; post?: unknown };
    if (typeof o.token !== 'string' || !o.token) return null;
    return {
      token: o.token,
      fundNotice: typeof o.fund === 'boolean' ? o.fund : null,
      postNotice: typeof o.post === 'boolean' ? o.post : null,
    };
  } catch {
    return null;
  }
}

/** 토큰과 두 플래그가 모두 같을 때만 같은 등록(→ PUT 생략) */
export function sameRegistration(saved: SavedDevice | null, token: string, f: PushFlags): boolean {
  return (
    saved !== null && saved.token === token && saved.fundNotice === f.fundNotice && saved.postNotice === f.postNotice
  );
}

/**
 * 로그인 + 권한 허용 → 등록(펀드 0개여도). 플래그: fund = 펀드 ≥1, post = 내정보 설정.
 * 토큰이나 플래그가 바뀌었을 때만 PUT. 권한이 없으면 등록돼 있던 토큰을 해제
 */
export async function syncPushRegistrationWith(d: SyncDeps): Promise<SyncResult> {
  if (!d.isConfigured()) return 'skipped';
  try {
    const auth = d.authToken();
    if (!auth) return 'idle'; // 로그아웃 해제는 unregisterWith(로그아웃 직전 훅)가 맡는다
    const saved = decodeSaved(await d.loadSaved());
    if ((await d.permission()) === 'granted') {
      const flags: PushFlags = { fundNotice: (await d.countFunds()) > 0, postNotice: await d.postNotice() };
      const token = await d.getPushToken();
      if (sameRegistration(saved, token, flags)) return 'unchanged';
      await d.put(auth, token, flags);
      await d.saveSaved(encodeSaved(token, flags));
      return 'registered';
    }
    if (!saved) return 'idle';
    await d.del(auth, saved.token);
    await d.saveSaved(null);
    return 'unregistered';
  } catch {
    return 'failed';
  }
}

/** 한 번에 하나씩 순서대로 실행하는 Promise 큐 — 앞 작업이 실패해도 다음은 실행된다 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

/** 로그아웃 직전 — 지워지기 전 인증 토큰을 받아 해제. 서버 실패여도 기기 기록은 비운다 */
export async function unregisterWith(
  d: Pick<SyncDeps, 'loadSaved' | 'saveSaved' | 'del'>,
  authToken: string,
): Promise<void> {
  const saved = decodeSaved(await d.loadSaved().catch(() => null));
  if (!saved) return;
  await d.del(authToken, saved.token).catch(() => {});
  await d.saveSaved(null).catch(() => {});
}

export const PUSH_TIMEOUT_MS = 10_000;

/** ms 안에 안 끝나면 reject(끝나면 타이머 정리) — 멈춘 네트워크가 직렬화 큐를 막지 않게 */
export function withTimeout<T>(task: Promise<T>, ms: number, label = 'push'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    task.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 동기화와 해제를 한 큐로 직렬화 — 진행 중인 put 이 끝난 뒤 해제가 실행돼 "로그아웃 후 등록 잔존"이 없다 */
export function createPushRegistrar(d: SyncDeps) {
  const enqueue = createSerialQueue();
  let pendingSync: Promise<SyncResult> | null = null;
  return {
    // 아직 시작 전인 sync 가 큐에 있으면 새 요청은 그 결과를 공유(합치기). unregister 는 합치지 않는다
    sync: () => {
      if (pendingSync) return pendingSync;
      // 내 시작 시점에 pendingSync 가 아직 나라면 비운다(unregister 뒤 새로 선 sync 의 합치기 대상을 지우지 않게)
      const p: Promise<SyncResult> = enqueue(() => {
        if (pendingSync === p) pendingSync = null;
        return syncPushRegistrationWith(d);
      });
      pendingSync = p;
      return p;
    },
    // 해제 뒤에 들어오는 sync 가 해제 앞의 대기 sync 에 합쳐져 해제보다 먼저 실행되지 않게 합치기 대상을 끊는다
    unregister: (authToken: string) => {
      pendingSync = null;
      return enqueue(() => unregisterWith(d, authToken));
    },
  };
}
```

- [ ] **5-4. 순수 로직 테스트 통과 확인**

실행: `cd mobile && npx jest src/features/push/registration-core.test.ts`
예상: PASS(27개). 아직 `registration.ts`·`api.ts` 가 옛 시그니처라 `npm run typecheck` 는 실패한다 — 5-5~5-7 에서 맞춘다.

- [ ] **5-5. API** — `mobile/src/features/push/api.ts`

import 줄 `import { PUSH_TIMEOUT_MS } from './registration-core';` 를 다음으로 바꾼다:
```ts
import { PUSH_TIMEOUT_MS, type PushFlags } from './registration-core';
```
`putPushDevice` 를 다음으로 바꾼다:
```ts
export async function putPushDevice(
  authToken: string,
  pushToken: string,
  platform: 'android' | 'ios',
  flags: PushFlags,
): Promise<void> {
  const res = await timedFetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      token: pushToken,
      platform,
      fund_notice: flags.fundNotice,
      post_notice: flags.postNotice,
    }),
  });
  if (!res.ok) throw new Error(`push-devices PUT ${res.status}`);
}
```

- [ ] **5-6. 새 글 알림 설정 저장소** — `mobile/src/features/push/post-notice.ts`(신규)

```ts
// 내정보 "새 글 알림" 설정 — 기기 저장(기본 켜짐). 서버에는 등록 동기화 때 post_notice 로 함께 간다
import * as SecureStore from 'expo-secure-store';

import { parsePostNotice } from './registration-core';

const POST_NOTICE_KEY = 'push_post_notice_v1';

/** 읽기 실패는 기본값(켜짐) */
export async function loadPostNotice(): Promise<boolean> {
  try {
    return parsePostNotice(await SecureStore.getItemAsync(POST_NOTICE_KEY));
  } catch {
    return true;
  }
}

export const savePostNotice = (on: boolean): Promise<void> =>
  SecureStore.setItemAsync(POST_NOTICE_KEY, on ? '1' : '0').catch(() => {});
```

- [ ] **5-7. 실제 의존성 연결** — `mobile/src/features/push/registration.ts` 전체를 다음으로 바꾼다

```ts
// 푸시 등록 동기화 — 실제 의존성 연결. 호출 시점: 앱 실행·로그인 직후, 펀드 추가·삭제, 권한 허용 직후,
// 내정보 새 글 알림 스위치 변경, active 복귀. 로그아웃 직전은 훅.
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { loadFunds } from '@/features/fund/fund-store';

import { deletePushDevice, putPushDevice } from './api';
import { getProjectId, isPushConfigured } from './config';
import { loadPostNotice } from './post-notice';
import { createPushRegistrar, PUSH_TIMEOUT_MS, withTimeout, type PushPermission, type SyncDeps } from './registration-core';

// 키를 바꾸지 않는다 — 구버전(토큰 문자열) 값도 이 키에 있어야 업데이트 뒤 로그아웃 때 해제할 수 있다
const SAVED_KEY = 'push_device_v1';
const platform = Platform.OS === 'ios' ? 'ios' : 'android';

const deps: SyncDeps = {
  isConfigured: isPushConfigured,
  authToken: () => useAuthStore.getState().token,
  countFunds: async () => (await loadFunds()).length,
  postNotice: loadPostNotice,
  permission: async () => (await Notifications.getPermissionsAsync()).status as PushPermission,
  getPushToken: async () =>
    (await withTimeout(Notifications.getExpoPushTokenAsync({ projectId: getProjectId() }), PUSH_TIMEOUT_MS, 'push token')).data,
  loadSaved: () => SecureStore.getItemAsync(SAVED_KEY),
  saveSaved: (raw) => (raw ? SecureStore.setItemAsync(SAVED_KEY, raw) : SecureStore.deleteItemAsync(SAVED_KEY)),
  put: (auth, token, flags) => putPushDevice(auth, token, platform, flags),
  del: deletePushDevice,
};

const registrar = createPushRegistrar(deps);

export const syncPushRegistration = () => registrar.sync();

let hooked = false;
/** 로그아웃 직전 해제 훅 — 앱 시작 시 한 번 */
export function installPushLogoutHook(): void {
  if (hooked) return;
  hooked = true;
  registerBeforeLogout((authToken) => {
    if (isPushConfigured()) void registrar.unregister(authToken);
  });
}
```

- [ ] **5-8. 펀드 화면 주석 정정** — `mobile/src/app/fund/index.tsx` 의 다음 줄

바꾸기 전:
```tsx
            void syncPushRegistration(); // 마지막 펀드를 지우면 알림 해제
```
바꾼 뒤:
```tsx
            void syncPushRegistration(); // 마지막 펀드를 지우면 펀드 알림만 끔(fund_notice=false) — 새 글 알림 등록은 유지
```

- [ ] **5-9. 전체 검증**

실행: `cd mobile && npx jest && npm run typecheck`
예상: jest 실패 0, 총 = 505 + 이번 작업 순증가분(기존 registration-core 테스트 17개 → 27개, +10 → 515개). typecheck 오류 0.

- [ ] **5-10. 커밋**

```bash
git add mobile/src/features/push/registration-core.ts
git add mobile/src/features/push/registration-core.test.ts
git add mobile/src/features/push/api.ts
git add mobile/src/features/push/post-notice.ts
git add mobile/src/features/push/registration.ts
git add mobile/src/app/fund/index.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): 푸시 등록 조건을 로그인+권한으로 — 펀드 없어도 등록, fund·post 플래그 서명 저장(구버전 토큰 저장값은 한 번 재등록)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---
### 작업 6: 모바일 — 내정보 "새 글 알림" 스위치

**파일:**
- 수정: `mobile/src/features/push/prompt-core.ts`(함수 추가)
- 수정: `mobile/src/features/push/prompt-core.test.ts`(import 줄 교체 + 끝에 추가)
- 생성: `mobile/src/features/push/post-notice-row.tsx`
- 수정: `mobile/src/app/(tabs)/profile.tsx`

`@/ui` 에는 Switch 가 없다 → RN 내장 `Switch` 를 `ListRow` 의 `right` 슬롯에 넣고 `onPress` 는 주지 않는다(chevron 이 생기지 않게). 웹·projectId 없음(`isPushConfigured()=false`)이면 행을 숨긴다.

- [ ] **6-1. 실패하는 테스트 작성** — `mobile/src/features/push/prompt-core.test.ts`

1행 import 를 다음으로 바꾼다:
```ts
import { effectivePermission, postNoticeEnableAction, shouldOfferPrompt, shouldPromptOnEnter } from './prompt-core';
```
파일 끝에 추가:
```ts
describe('postNoticeEnableAction', () => {
  it('권한 허용이면 저장만', () => {
    expect(postNoticeEnableAction('granted')).toBe('none');
  });
  it('권한 미결정이면 OS 권한 요청', () => {
    expect(postNoticeEnableAction('undetermined')).toBe('request');
  });
  it('다시 물을 수 없는 거부면 설정 앱 안내', () => {
    expect(postNoticeEnableAction('denied')).toBe('open-settings');
  });
});
```

- [ ] **6-2. 실패 확인**

실행: `cd mobile && npx jest src/features/push/prompt-core.test.ts`
예상: FAIL — `postNoticeEnableAction is not a function`.

- [ ] **6-3. 순수 판정 추가** — `mobile/src/features/push/prompt-core.ts` 파일 끝에 추가

```ts
/** 내정보 "새 글 알림"을 켤 때 할 일: 허용됨 → 저장만, 미결정 → OS 권한 요청, 다시 물을 수 없는 거부 → 설정 앱 안내 */
export function postNoticeEnableAction(
  permission: 'granted' | 'denied' | 'undetermined',
): 'none' | 'request' | 'open-settings' {
  if (permission === 'granted') return 'none';
  if (permission === 'undetermined') return 'request';
  return 'open-settings';
}
```

- [ ] **6-4. 테스트 통과 확인**

실행: `cd mobile && npx jest src/features/push/prompt-core.test.ts`
예상: PASS(12개).

- [ ] **6-5. 스위치 행** — `mobile/src/features/push/post-notice-row.tsx`(신규)

```tsx
// 내정보 "새 글 알림" 스위치 — 값은 기기 저장(SecureStore), 바꾸면 등록 동기화로 서버 post_notice 갱신
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, Linking, Switch, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ListRow } from '@/ui';

import { isPushConfigured } from './config';
import { ensureFundChannel } from './handlers';
import { loadPostNotice, savePostNotice } from './post-notice';
import { markPrompted } from './prompt';
import { effectivePermission, postNoticeEnableAction } from './prompt-core';
import { syncPushRegistration } from './registration';

export function PostNoticeRow() {
  const { theme } = useUnistyles();
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPostNotice().then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!isPushConfigured()) return null; // 웹·projectId 없음 — 푸시를 쓰지 않는다

  const toggle = async (next: boolean) => {
    setBusy(true);
    setOn(next);
    try {
      await savePostNotice(next);
      if (next) {
        const action = postNoticeEnableAction(effectivePermission(await Notifications.getPermissionsAsync()));
        if (action === 'request') {
          await ensureFundChannel(); // Android 13+ 는 권한 요청 전에 채널이 있어야 한다
          await Notifications.requestPermissionsAsync();
          await markPrompted('accepted'); // 같은 질문을 홈·펀드 시트로 다시 하지 않게
        } else if (action === 'open-settings') {
          Alert.alert('알림이 꺼져 있어요', '휴대폰 설정에서 이 앱의 알림을 허용해야 새 글 알림을 받을 수 있어요.', [
            { text: '닫기', style: 'cancel' },
            { text: '설정 열기', onPress: () => void Linking.openSettings() },
          ]);
        }
      }
    } catch {
      // 권한·채널 요청 실패여도 설정값은 저장됐다 — 아래 동기화가 다음 기회에 맞춘다
    } finally {
      setBusy(false);
      void syncPushRegistration();
    }
  };

  return (
    <ListRow
      title="새 글 알림"
      subtitle="새 글이 올라오면 알림으로 알려드려요"
      left={<Text style={styles.emoji}>🔔</Text>}
      right={
        <Switch
          value={on}
          disabled={busy}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          accessibilityLabel="새 글 알림"
        />
      }
    />
  );
}

const styles = StyleSheet.create(() => ({
  emoji: { fontSize: 18 },
}));
```

- [ ] **6-6. 내정보 배치** — `mobile/src/app/(tabs)/profile.tsx`

import 블록의 `import { useAuthStore } from '@/features/auth/store';` 바로 아래에 추가:
```tsx
import { PostNoticeRow } from '@/features/push/post-notice-row';
```
로그인 분기(`if (user) {`)의 "내 펀드 수익" 그룹을 다음으로 바꾼다(같은 그룹에 행 추가):

바꾸기 전:
```tsx
        <View style={styles.group}>
          <ListRow
            title="내 펀드 수익"
            subtitle="fund.ivyro.net 펀드 현황"
            left={<Text style={styles.emoji}>💰</Text>}
            onPress={() => router.push('/fund')}
          />
        </View>
```
바꾼 뒤:
```tsx
        <View style={styles.group}>
          <ListRow
            title="내 펀드 수익"
            subtitle="fund.ivyro.net 펀드 현황"
            left={<Text style={styles.emoji}>💰</Text>}
            onPress={() => router.push('/fund')}
          />
          <PostNoticeRow />
        </View>
```
(비로그인 분기에는 넣지 않는다 — 로그인 상태에서만 표시.)

- [ ] **6-7. 전체 검증**

실행: `cd mobile && npx jest && npm run typecheck`
예상: jest 실패 0, 총 518개(515 + 3). typecheck 오류 0.

- [ ] **6-8. 커밋**

```bash
git add mobile/src/features/push/prompt-core.ts
git add mobile/src/features/push/prompt-core.test.ts
git add mobile/src/features/push/post-notice-row.tsx
git add "mobile/src/app/(tabs)/profile.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 내정보 "새 글 알림" 스위치 — 켤 때 권한 미결정이면 요청·거부면 설정 안내, 바꾸면 등록 동기화

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 7: 모바일 — 안내 시트 문구 일반화 + 로그인 후 홈 탭 1회

**파일:**
- 수정: `mobile/src/features/push/prompt-core.ts`(함수 추가)
- 수정: `mobile/src/features/push/prompt-core.test.ts`(import 줄 교체 + 끝에 추가)
- 수정: `mobile/src/features/push/push-prompt-sheet.tsx`(문구)
- 생성: `mobile/src/features/push/home-push-prompt.tsx`
- 수정: `mobile/src/app/(tabs)/index.tsx`(컴포넌트 부분, `styles` 는 그대로)

로그인은 내정보 탭에서 일어나므로 `useEffect` 가 아니라 **`useFocusEffect`** 로 판단한다(로그인 뒤 홈 탭으로 돌아올 때 뜸). 기록(`wasPrompted`)은 펀드 경로와 공유 — 어느 경로든 한 번만.

- [ ] **7-1. 실패하는 테스트 작성** — `mobile/src/features/push/prompt-core.test.ts`

1행 import 를 다음으로 바꾼다:
```ts
import {
  effectivePermission,
  postNoticeEnableAction,
  shouldOfferPrompt,
  shouldPromptOnEnter,
  shouldPromptOnHome,
} from './prompt-core';
```
파일 끝에 추가:
```ts
describe('shouldPromptOnHome', () => {
  const base = { loggedIn: true, prompted: false, permission: 'undetermined', configured: true };
  it('로그인 + 미질문 + 권한 미결정 + 설정됨이면 true(펀드 없어도)', () => {
    expect(shouldPromptOnHome(base)).toBe(true);
  });
  it('비로그인이면 false', () => {
    expect(shouldPromptOnHome({ ...base, loggedIn: false })).toBe(false);
  });
  it('이미 물어봤으면 false(펀드 경로와 기록 공유)', () => {
    expect(shouldPromptOnHome({ ...base, prompted: true })).toBe(false);
  });
  it('권한이 이미 결정됐으면 false', () => {
    expect(shouldPromptOnHome({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldPromptOnHome({ ...base, permission: 'denied' })).toBe(false);
  });
  it('푸시 미설정이면 false', () => {
    expect(shouldPromptOnHome({ ...base, configured: false })).toBe(false);
  });
});
```

- [ ] **7-2. 실패 확인**

실행: `cd mobile && npx jest src/features/push/prompt-core.test.ts`
예상: FAIL — `shouldPromptOnHome is not a function`.

- [ ] **7-3. 순수 판정 추가** — `mobile/src/features/push/prompt-core.ts` 파일 끝에 추가

```ts
/** 로그인 후 홈 탭: 푸시 설정됨 + 아직 안 물어봄 + OS 권한 미결정이면 안내 시트(펀드 없어도). 기록은 펀드 경로와 공유 */
export function shouldPromptOnHome(s: {
  loggedIn: boolean;
  prompted: boolean;
  permission: string;
  configured: boolean;
}): boolean {
  return s.configured && s.loggedIn && !s.prompted && s.permission === 'undetermined';
}
```

- [ ] **7-4. 테스트 통과 확인**

실행: `cd mobile && npx jest src/features/push/prompt-core.test.ts`
예상: PASS(17개).

- [ ] **7-5. 시트 문구 일반화** — `mobile/src/features/push/push-prompt-sheet.tsx`

주석 `/** 펀드 첫 등록 직후 한 번 — [알림 받기] 일 때만 OS 권한을 요청한다 */` 를 다음으로 바꾼다:
```tsx
/** 홈(로그인 후)·펀드 첫 등록·펀드 화면 진입 중 한 번 — [알림 받기] 일 때만 OS 권한을 요청한다 */
```
`return (...)` 의 `<BottomSheet ...>` 와 `<Text ...>` 두 줄을 다음으로 바꾼다:

바꾸기 전:
```tsx
    <BottomSheet title="리포트가 올라오면 알려드릴까요?" onClose={later}>
      <Text style={styles.text}>매일 수익률 리포트가 업데이트되면 알림으로 알려드려요. 설정에서 언제든 끌 수 있어요.</Text>
```
바꾼 뒤:
```tsx
    <BottomSheet title="새 글·펀드 리포트 알림 받기" onClose={later}>
      <Text style={styles.text}>
        새 글이 올라오거나 펀드 수익률 리포트가 업데이트되면 알림으로 알려드려요. 새 글 알림은 내정보에서 언제든 끌 수 있어요.
      </Text>
```

- [ ] **7-6. 홈 1회 시트 컴포넌트** — `mobile/src/features/push/home-push-prompt.tsx`(신규)

```tsx
// 로그인 후 홈 탭에서 한 번 — 펀드가 없어도 새 글 알림 권한을 묻는다(기록 wasPrompted 는 펀드 경로와 공유)
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';

import { isPushConfigured } from './config';
import { wasPrompted } from './prompt';
import { effectivePermission, shouldPromptOnHome } from './prompt-core';
import { PushPromptSheet } from './push-prompt-sheet';

export function HomePushPrompt() {
  const loggedIn = useAuthStore((s) => s.user !== null);
  const hydrated = useAuthStore((s) => s.hydrated);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false); // 포커스가 다시 와도 열린 시트를 또 열지 않게
  openRef.current = open;

  useFocusEffect(
    useCallback(() => {
      if (!hydrated || !loggedIn || !isPushConfigured()) return;
      let alive = true;
      void Promise.all([wasPrompted(), Notifications.getPermissionsAsync()])
        .then(([prompted, perm]) => {
          if (!alive || openRef.current) return;
          const permission = effectivePermission(perm); // Android 13+ 미요청 'denied' 보정
          if (shouldPromptOnHome({ loggedIn, prompted, permission, configured: true })) setOpen(true);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [hydrated, loggedIn]),
  );

  return open ? <PushPromptSheet onClose={() => setOpen(false)} /> : null;
}
```

- [ ] **7-7. 홈 배치** — `mobile/src/app/(tabs)/index.tsx`

로딩 분기의 이른 `return` 과 목록 `return` 이 서로 다른 트리라 각각에 넣으면 로딩→목록 전환 때 시트가 다시 마운트된다. 그래서 두 화면을 `content` 로 만들고 Fragment 의 **두 번째 자식**으로 `HomePushPrompt` 를 둬 위치를 고정한다. 파일 맨 위 import 부터 `export default function HomeScreen() { ... }` 의 끝(`}`)까지를 다음으로 바꾼다(아래 `const styles = StyleSheet.create(...)` 는 그대로):

```tsx
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';
import { HomePushPrompt } from '@/features/push/home-push-prompt';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { data, loading, error, reload, refresh } = useFeaturedPosts();
  const { refreshing, onRefresh } = usePullRefresh(refresh);

  // 처음 불러올 때만 전체 화면 로딩 — 당겨서 새로고침 중에는 목록을 그대로 둔다
  const content =
    loading && data.length === 0 ? (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    ) : (
      // 빈 상태·오류도 목록 안에 둬서 당겨서 새로고침이 되게 한다
      <FlatList
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 16 },
          data.length === 0 && styles.grow,
        ]}
        data={data}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={<Text style={styles.title}>📌 추천 글</Text>}
        renderItem={({ item }) => <BlogCard post={item} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          error ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>추천 글을 불러오지 못했습니다</Text>
              <Text style={styles.hint}>{error}</Text>
              <Pressable style={styles.retry} onPress={reload}>
                <Text style={styles.retryText}>다시 시도</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.hint}>아직 추천 글이 없습니다</Text>
              <Text style={styles.hint}>화면을 아래로 당기면 새로고침돼요</Text>
            </View>
          )
        }
      />
    );

  // 시트는 Fragment 의 두 번째 자리에 고정 — 로딩→목록 전환에도 다시 마운트되지 않는다
  return (
    <>
      {content}
      <HomePushPrompt />
    </>
  );
}
```

- [ ] **7-8. 전체 검증**

실행: `cd mobile && npx jest && npm run typecheck`
예상: jest 실패 0, 총 523개(518 + 5). typecheck 오류 0.

- [ ] **7-9. 커밋**

```bash
git add mobile/src/features/push/prompt-core.ts
git add mobile/src/features/push/prompt-core.test.ts
git add mobile/src/features/push/push-prompt-sheet.tsx
git add mobile/src/features/push/home-push-prompt.tsx
git add "mobile/src/app/(tabs)/index.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 알림 안내 시트를 "새 글·펀드 리포트 알림 받기"로 일반화 + 로그인 후 홈 탭에서 1회 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 8: 모바일 — 알림 탭(새 글 → 글 상세) · 포그라운드 배너 · `blog-post` 채널

**파일:**
- 수정(전체 교체): `mobile/src/features/push/handlers-core.ts`
- 수정(전체 교체): `mobile/src/features/push/handlers-core.test.ts`
- 수정(전체 교체): `mobile/src/features/push/handlers.ts`
- 수정: `mobile/src/features/push/push-prompt-sheet.tsx`(import·호출 이름)
- 수정: `mobile/src/features/push/post-notice-row.tsx`(import·호출 이름)

- [ ] **8-1. 실패하는 테스트 작성** — `mobile/src/features/push/handlers-core.test.ts` 전체를 다음으로 바꾼다

```ts
import {
  createResponseClaimer,
  handleNotificationResponseWith,
  isFundNotification,
  newPostIdOf,
  shouldShowForegroundBanner,
} from './handlers-core';

describe('isFundNotification', () => {
  it('data.type 이 fund_report 일 때만 true', () => {
    expect(isFundNotification({ type: 'fund_report', date: '2026-10-21' })).toBe(true);
    expect(isFundNotification({ type: 'new_post' })).toBe(false);
    expect(isFundNotification(undefined)).toBe(false);
  });
});

describe('newPostIdOf', () => {
  it('new_post 의 양의 정수 post_id(숫자 문자열 허용)만', () => {
    expect(newPostIdOf({ type: 'new_post', post_id: 12, board_id: 3 })).toBe(12);
    expect(newPostIdOf({ type: 'new_post', post_id: '34' })).toBe(34);
  });
  it('그 밖은 null', () => {
    expect(newPostIdOf({ type: 'new_post' })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: 0 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: -1 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: 1.5 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: '12abc' })).toBeNull();
    expect(newPostIdOf({ type: 'fund_report', post_id: 12 })).toBeNull();
    expect(newPostIdOf(null)).toBeNull();
  });
});

describe('handleNotificationResponseWith', () => {
  it('펀드 알림 탭 → 펀드 화면 이동 + 강제 갱신', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'fund_report' }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/fund');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('새 글 알림 탭 → 글 상세로 이동(갱신 없음)', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post', post_id: 7, board_id: 1 }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/blog/7');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('글 id 가 없는 새 글 알림·모르는 알림은 무시', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post' }, deps)).toBe(false);
    expect(handleNotificationResponseWith({ type: 'fund_refresh' }, deps)).toBe(false);
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});

describe('shouldShowForegroundBanner', () => {
  it('새 글은 앱이 앞에 있어도 배너(앱엔 새 글 SSE 토스트가 없음)', () => {
    expect(shouldShowForegroundBanner({ type: 'new_post', post_id: 1 })).toBe(true);
  });
  it('펀드 리포트·무음 깨우기·모르는 알림은 배너 없음', () => {
    expect(shouldShowForegroundBanner({ type: 'fund_report' })).toBe(false);
    expect(shouldShowForegroundBanner({ type: 'fund_refresh' })).toBe(false);
    expect(shouldShowForegroundBanner(undefined)).toBe(false);
  });
});

describe('createResponseClaimer', () => {
  it('동시에 같은 응답이 와도 한 번만 처리한다(저장소는 한 번만 읽음)', async () => {
    const load = jest.fn(async () => null as string | null);
    const save = jest.fn();
    const claim = createResponseClaimer(load, save);
    const results = await Promise.all([claim('a'), claim('a')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('저장된 id 와 같으면 거부, 새 id 면 허용', async () => {
    const claim = createResponseClaimer(async () => 'old', jest.fn());
    await expect(claim('old')).resolves.toBe(false);
    await expect(claim('new')).resolves.toBe(true);
    await expect(claim('new')).resolves.toBe(false);
  });

  it('저장소 읽기 실패는 미처리로 간주', async () => {
    const claim = createResponseClaimer(() => Promise.reject(new Error('x')), jest.fn());
    await expect(claim('a')).resolves.toBe(true);
  });
});
```

- [ ] **8-2. 실패 확인**

실행: `cd mobile && npx jest src/features/push/handlers-core.test.ts`
예상: FAIL — `newPostIdOf`·`shouldShowForegroundBanner` 가 없음, 새 글 탭 테스트 FAIL.

- [ ] **8-3. 순수 로직 교체** — `mobile/src/features/push/handlers-core.ts` 전체를 다음으로 바꾼다

```ts
// 알림 탭·표시 처리 — 순수 로직
export const FUND_CHANNEL_ID = 'fund-report';
export const POST_CHANNEL_ID = 'blog-post'; // 서버 collector/tasks/notifications.NEW_POST_CHANNEL_ID 와 같은 값

export type PushRoute = '/fund' | `/blog/${number}`;

const typeOf = (data: unknown): unknown =>
  typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined;

export function isFundNotification(data: unknown): boolean {
  return typeOf(data) === 'fund_report';
}

/** 새 글 알림의 글 id — 양의 정수(플랫폼별 직렬화 차이 대비 숫자 문자열 허용)일 때만, 아니면 null */
export function newPostIdOf(data: unknown): number | null {
  if (typeOf(data) !== 'new_post') return null;
  const raw = (data as { post_id?: unknown }).post_id;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 탭: 새 글 → /blog/{id}, 펀드 리포트 → /fund + 강제 갱신. 처리했으면 true */
export function handleNotificationResponseWith(
  data: unknown,
  deps: { navigate: (path: PushRoute) => void; refresh: () => void },
): boolean {
  const postId = newPostIdOf(data);
  if (postId !== null) {
    deps.navigate(`/blog/${postId}`);
    return true;
  }
  if (!isFundNotification(data)) return false;
  deps.navigate('/fund');
  deps.refresh();
  return true;
}

/** 앱이 앞에 있을 때 배너: 새 글만(앱엔 새 글 SSE 토스트가 없음). 펀드는 SSE·자동 갱신이 이미 반영 */
export function shouldShowForegroundBanner(data: unknown): boolean {
  return newPostIdOf(data) !== null;
}

/** 같은 알림 응답을 한 번만 처리하게 하는 판정. 저장소는 한 번만 읽고, await 이후 비교·갱신은 동기로 처리한다 */
export function createResponseClaimer(
  load: () => Promise<string | null>,
  save: (id: string) => void,
): (id: string) => Promise<boolean> {
  let loaded: Promise<string | null> | undefined;
  let last: string | null | undefined;
  return async (id) => {
    loaded ??= load().catch(() => null);
    const stored = await loaded;
    if (last === undefined) last = stored;
    if (last === id) return false;
    last = id;
    save(id);
    return true;
  };
}
```

- [ ] **8-4. 테스트 통과 확인**

실행: `cd mobile && npx jest src/features/push/handlers-core.test.ts`
예상: PASS(11개).

- [ ] **8-5. 연결부 교체** — `mobile/src/features/push/handlers.ts` 전체를 다음으로 바꾼다

```ts
// 알림 표시·채널·탭 처리 — 루트 레이아웃에서 usePushSetup() 한 번
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher } from '@/features/fund/auto-refresh';

import { isPushConfigured } from './config';
import {
  createResponseClaimer,
  FUND_CHANNEL_ID,
  handleNotificationResponseWith,
  POST_CHANNEL_ID,
  shouldShowForegroundBanner,
} from './handlers-core';
import { installPushLogoutHook, syncPushRegistration } from './registration';

// 같은 알림 응답을 두 번 처리하지 않게(효과 재실행·앱 재실행 때 getLastNotificationResponseAsync 가 같은 응답을 다시 줄 수 있음)
const HANDLED_KEY = 'push_last_handled_v1';
const claimResponse = createResponseClaimer(
  () => SecureStore.getItemAsync(HANDLED_KEY),
  (id) => void SecureStore.setItemAsync(HANDLED_KEY, id).catch(() => {}),
);

// 로그아웃 훅은 모듈 로드 시점에 설치 — hydrate().then(validateSession) 의 401 로그아웃보다 먼저 있어야 한다(멱등)
installPushLogoutHook();

// 앱이 앞에 있을 때: 새 글은 배너(앱엔 새 글 토스트가 없음), 펀드 리포트는 배너 없음(SSE·자동 갱신이 반영). 둘 다 알림 목록에는 남김
Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    shouldShowBanner: shouldShowForegroundBanner(n.request.content.data),
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Android 13+ 는 권한 요청 전에 채널이 있어야 한다 — 펀드 리포트·새 글 두 채널 */
export async function ensurePushChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(FUND_CHANNEL_ID, {
    name: '펀드 리포트',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync(POST_CHANNEL_ID, {
    name: '새 글',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export function usePushSetup(): void {
  const router = useRouter();
  const loggedIn = useAuthStore((s) => s.user !== null);
  // 로그인 상태 복원(hydrate) 전에 /fund 로 가면 펀드 화면이 user=null 로 보고 /profile 로 튕긴다 → 복원 후에 처리
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    if (!isPushConfigured() || !hydrated) return;
    void ensurePushChannels();
    const handle = async (r: Notifications.NotificationResponse | null) => {
      if (!r || !(await claimResponse(r.notification.request.identifier))) return;
      handleNotificationResponseWith(r.notification.request.content.data, {
        navigate: (p) => router.push(p as Href),
        refresh: () => void fundRefresher.run({ force: true }),
      });
    };
    void Notifications.getLastNotificationResponseAsync().then(handle); // 콜드 스타트(앱이 꺼진 상태에서 탭)
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, [router, hydrated]);

  // 앱 실행·로그인 직후 등록 동기화
  useEffect(() => {
    if (loggedIn) void syncPushRegistration();
  }, [loggedIn]);

  // 설정 앱에서 알림 권한을 켜고 돌아오면 재동기화(토큰·플래그가 같으면 서버 호출은 생략됨)
  useEffect(() => {
    if (!loggedIn || !hydrated || !isPushConfigured()) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncPushRegistration();
    });
    return () => sub.remove();
  }, [loggedIn, hydrated]);
}
```

- [ ] **8-6. 호출부 이름 변경 (2곳)**

`mobile/src/features/push/push-prompt-sheet.tsx`:
- `import { ensureFundChannel } from './handlers';` → `import { ensurePushChannels } from './handlers';`
- `await ensureFundChannel();` → `await ensurePushChannels();`

`mobile/src/features/push/post-notice-row.tsx`:
- `import { ensureFundChannel } from './handlers';` → `import { ensurePushChannels } from './handlers';`
- `await ensureFundChannel(); // Android 13+ 는 권한 요청 전에 채널이 있어야 한다` → `await ensurePushChannels(); // Android 13+ 는 권한 요청 전에 채널이 있어야 한다`

남은 옛 이름이 없는지 확인:
```bash
cd mobile && grep -rn "ensureFundChannel" src || echo "없음"
```
예상: `없음`.

- [ ] **8-7. 전체 검증**

실행: `cd mobile && npx jest && npm run typecheck`
예상: jest 실패 0, 총 528개(523 + 5: handlers-core 6개 → 11개). typecheck 오류 0. `router.push(p as Href)` 에서 타입 오류가 나면 `p` 의 타입(`PushRoute`)과 typedRoutes 생성 타입 차이이므로 캐스팅 줄만 확인한다(다른 곳은 바꾸지 않는다).

- [ ] **8-8. 커밋**

```bash
git add mobile/src/features/push/handlers-core.ts
git add mobile/src/features/push/handlers-core.test.ts
git add mobile/src/features/push/handlers.ts
git add mobile/src/features/push/push-prompt-sheet.tsx
git add mobile/src/features/push/post-notice-row.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): 새 글 알림 탭 → 글 상세, 앱이 앞에 있을 때 새 글만 배너, Android blog-post 채널

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 9: 문서 — README · push_notification_setup · ROADMAP

**파일:**
- 수정: `README.md`(14·315·565행 부근, "펀드 알림 배포 메모" 절)
- 수정: `docs/push_notification_setup.md`(머리말 설계 링크, §0 표, §7, §10)
- 수정: `docs/ROADMAP.md`(25·107·149행)

- [ ] **9-1. README** — 다음 네 곳을 바꾼다

(1) 디렉터리 트리 줄
- 전: `│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 푸시(Mock) · 펀드 리포트 알림(Expo Push)`
- 후: `│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 알림 · 펀드 리포트 알림(Expo Push)`

(2) 로컬 실행 표 줄
- 전: `| 새 글 실시간 알림(SSE)·푸시(Mock) | 위 + Redis(도커) + celery worker |`
- 후: `| 새 글 실시간 알림(SSE)·앱 푸시(로컬은 PUSH_BACKEND=mock) | 위 + Redis(도커) + celery worker(REDIS_URL=redis://localhost:6379/5) |`

(3) 알림 아키텍처의 "모바일(FCM)" 줄 전체를 다음으로 바꾼다
```markdown
- **새 글 앱 알림(Expo 푸시)**: 관리자 웹 글 **작성** 화면의 "앱 알림 보내기"를 체크한 글만(`POST /api/v1/blogs` 의 요청 전용 필드 `notify`) Celery `collector.send_new_post_notification` 에 위임한다. 대상은 `push_devices` ⨝ `users` — 활성 사용자, 역할 등급 ≥ 게시판 `min_role_required`, 기기의 `post_notice=true`. 제목 `[게시판] 새 글`, 본문 글 제목, Android 채널 `blog-post`. 무효 토큰은 지우고, 결과는 로그로만 남긴다(발송 이력 없음). 웹 SSE `new_post` 는 체크와 상관없이 모든 새 글에 발행. `users.fcm_token` 은 더 이상 쓰지 않는다(컬럼만 남음).
  - 앱: 로그인 + 알림 권한이면 펀드가 없어도 기기를 등록한다(`fund_notice`=펀드 ≥1, `post_notice`=내정보 "새 글 알림" 스위치, 기본 켜짐). 알림 탭 → 글 상세, 앱이 앞에 있을 때는 새 글만 배너. 권한 안내 시트는 로그인 후 홈 탭·펀드 첫 등록·펀드 화면 진입 중 한 번.
```

(4) "### 펀드 알림 배포 메모" 절 바로 아래(3번 항목 뒤)에 새 절 추가
```markdown

### 새 글 알림 배포 메모
1. 운영 DB 마이그레이션: 새 리비전 `c1d2e3f4a5b6`(`push_devices.post_notice`, 기존 행은 true) — 배포 워크플로의 `alembic upgrade head` 로 적용된다.
2. **서버를 먼저 배포해도 안전**: 구버전 앱은 펀드 등록 기기만 등록하고 `post_notice` 를 안 보내 기본 true → 그 기기들만 새 글 알림을 받는다. 새 앱을 배포하면 알림을 허용한 모든 로그인 기기로 넓어진다.
3. blog·Celery 워커 재시작(새 beat 엔트리 없음).
```

- [ ] **9-2. push_notification_setup.md**

(1) 머리말 4행의 설계 링크 줄

바꾸기 전:
```markdown
설계(무엇을 언제 보내는지)는 [`superpowers/specs/2026-10-19-fund-report-notice-design.md`](superpowers/specs/2026-10-19-fund-report-notice-design.md),
```
바꾼 뒤:
```markdown
설계(무엇을 언제 보내는지)는 펀드 리포트 [`superpowers/specs/2026-10-19-fund-report-notice-design.md`](superpowers/specs/2026-10-19-fund-report-notice-design.md) · 새 글 [`superpowers/specs/2026-10-21-new-post-push-design.md`](superpowers/specs/2026-10-21-new-post-push-design.md),
```

(2) §0 표 마지막 행(`google-services.json`) 아래에 행 추가
```markdown
| 새 글 알림 | ✅ Expo 이전 | 관리자가 글 작성 때 "앱 알림 보내기"를 고른 글만, `post_notice` 켠 기기(펀드 무관). Android 채널 `blog-post`. `users.fcm_token` 미사용 |
```

(3) §7 의 3번 항목 아래에 추가
```markdown
4. **새 글 알림 확인**: 펀드가 **없는** 계정으로 로그인 → 홈 탭 안내 시트에서 [알림 받기] → 관리자 웹에서 "앱 알림 보내기"를 체크하고 글 작성 → 기기에 `[게시판] 새 글` 알림 → 탭하면 그 글 상세. 내정보 "새 글 알림"을 끄고 다시 쓰면 오지 않아야 한다. 서버 로그 `send_new_post_notification: post=… recipients=… ok=…` 로 대상 수를 본다.
```

(4) §10 체크리스트 끝에 추가
```markdown
- [ ] 새 글 알림 실기기 확인(7장 4번) — 펀드 없는 계정 수신·탭 → 글 상세·스위치 끄면 미수신
```

- [ ] **9-3. ROADMAP.md**

(1) 25행
- 전: `- [x] 새 글 실시간 알림: 웹 SSE(Redis pub/sub) + 모바일 FCM(Mock)`
- 후: `- [x] 새 글 실시간 알림: 웹 SSE(Redis pub/sub) + 모바일 Expo 푸시(관리자가 고른 글만, 2026-10-21 이전)`

(2) 107행
- 전: `- [x] 실제 푸시 — Expo Push(→FCM/APNs) 발송기, 펀드 리포트 알림부터 적용(2026-10-21). 새 글 알림은 아직 users.fcm_token·Mock`
- 후: `- [x] 실제 푸시 — Expo Push(→FCM/APNs) 발송기, 펀드 리포트 알림·새 글 알림 적용(2026-10-21). 새 글은 push_devices.post_notice·내정보 스위치`

(3) 149행

바꾸기 전:
```markdown
- [ ] 펀드 알림 후속: 운영 앱 빌드에 projectId 포함 확인(`unzip -p <apk> assets/app.config | grep -c projectId`)·6시간 정기 작업 콜드 실측·새 글 알림을 Expo 발송기로 이전(현재 users.fcm_token·Mock)
```
바꾼 뒤(두 줄):
```markdown
- [ ] 펀드 알림 후속: 운영 앱 빌드에 projectId 포함 확인(`unzip -p <apk> assets/app.config | grep -c projectId`)·6시간 정기 작업 콜드 실측
- [ ] 새 글 알림 실기기 확인 — 펀드 없는 계정 등록·수신·탭 → 글 상세, 스위치 끄면 미수신(코드 이전은 2026-10-21 완료)
```

- [ ] **9-4. 남은 옛 서술 확인**

```bash
grep -n "FCM(Mock)\|푸시(Mock)\|fcm_token·Mock" README.md docs/ROADMAP.md docs/push_notification_setup.md || echo "없음"
```
예상: `없음`.

- [ ] **9-5. 커밋**

```bash
git add README.md
git add docs/push_notification_setup.md
git add docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: 새 글 알림 Expo 이전 반영 — README 알림 아키텍처·배포 메모, 푸시 설정 가이드 확인 절차, ROADMAP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 10: 실기기 확인 — **사용자 몫**

에이전트는 이 작업을 실행하지 않는다. 아래 절차를 사용자에게 안내하고 결과를 기다린다. 서버(develop)에 작업 1~3 이 배포되고 마이그레이션 `c1d2e3f4a5b6` 가 적용돼 있어야 한다(`PUSH_BACKEND=expo` 는 펀드 알림 때 이미 전환됨).

- [ ] **10-1. 개발 APK 빌드(release)** — `cd mobile && npm run build:android:devapk`(스크립트가 projectId 포함 여부를 자동 검사) → 기기에 설치. 새 네이티브 모듈은 없으므로 이전 APK 로도 JS 만 바뀐 부분은 확인 가능하지만, release APK 는 JS 가 묶여 있으므로 새로 빌드한다.
- [ ] **10-2. 업데이트 호환** — 이전 버전으로 펀드 알림을 받던 기기에 새 APK 를 덮어 설치 → 앱 실행 → DB `push_devices` 의 그 토큰 행이 `updated_at` 갱신·`post_notice=true` 인지(구버전 저장값 → 한 번 재등록). 로그아웃 → 행이 지워지는지.
- [ ] **10-3. 펀드 없는 계정** — 펀드가 없는 계정으로 로그인 → 홈 탭에서 "새 글·펀드 리포트 알림 받기" 시트 → [알림 받기] → `push_devices` 에 `fund_notice=false, post_notice=true` 행.
- [ ] **10-4. 수신·탭** — 관리자 웹에서 "앱 알림 보내기"를 체크하고 글 작성 → 기기에 `[게시판] 새 글` 알림(앱 백그라운드·종료 두 상태) → 탭하면 그 글 상세. 앱이 앞에 있을 때는 배너가 뜨는지.
- [ ] **10-5. 체크 안 함** — 체크하지 않고 글 작성 → 앱 알림 없음(웹 SSE 토스트는 그대로).
- [ ] **10-6. 스위치 끄기** — 내정보 "새 글 알림" 끄기 → `post_notice=false` → 체크하고 글 작성 → 미수신. 다시 켜면 수신.
- [ ] **10-7. 펀드 알림 회귀** — 펀드 있는 계정에서 관리자 "펀드 리포트 알림" 테스트 발송 → 기존대로 수신·탭 → 펀드 화면, 앱이 앞에 있을 때 배너 없음.
- [ ] **10-8. 결과 반영** — 통과하면 ROADMAP 의 "새 글 알림 실기기 확인"·push_notification_setup §10 항목을 `[x]` 로 바꾸고 날짜를 적어 커밋(파일 개별 add, 끝 두 줄).
