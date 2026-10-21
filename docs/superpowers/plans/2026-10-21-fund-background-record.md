# 펀드 백그라운드 기록 · 빈 날 표시 (알림 계획 보충) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱·웹을 열지 않은 날에도 모바일이 백그라운드에서 펀드 리포트를 가져와 히스토리에 기록하고, 그래도 빠진 날은 히스토리에 "이전 기록 M.D" 로 드러낸다.

**Architecture:** 서버 `send_fund_notice` 가 알림용 메시지 뒤에 제목·본문 없는 깨우기용 메시지(`type: 'fund_refresh'`)를 한 번 더 보낸다. 앱은 모듈 최상위에서 두 백그라운드 태스크(push 수신·6시간 정기)를 정의하고, 둘 다 1단계와 같은 `fundRefresher.run()` 을 25초 한도로 돌린다. 백그라운드에서 생긴 새 기록의 Drive 백업은 파일 표시만 남기고 다음 앱 복귀 때 한다.

**Tech Stack:** Python(Celery, httpx) · Expo SDK 57(`expo-background-task`, `expo-task-manager`, `expo-notifications`) · jest(jest-expo).

**스펙:** `docs/superpowers/specs/2026-10-19-fund-report-notice-design.md` §1, §5(깨우기용), §7.1, §7.2, §9, §10. **선행:** `docs/superpowers/plans/2026-10-21-fund-report-notice.md` — 백엔드 Task S1 은 그 계획 **작업 3(발송 태스크)** 이후, 모바일 Task S3~S5 는 **작업 8(모바일 푸시)** 이후. Task S2(빈 날 표시)는 선행 없이 언제든.

---

## 상시 규칙 (모든 작업)

- 모든 커밋은 `dev` 브랜치. `git add -A`·`git add .` 금지 — 파일을 하나씩 지정. `.serena/project.yml` 은 절대 스테이징하지 않는다(다른 세션도 같은 브랜치에 커밋).
- 커밋 메시지는 한국어, 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T814x7jTTuEcJBrCqKt8Pf
  ```
- 테스트가 실패하면 커밋하지 않는다.
- 백엔드 테스트: `cd backend && uv run pytest -p no:warnings <파일>`. 모바일 테스트: `cd mobile && npx jest <파일>`, 타입: `npm run typecheck`.
- 모바일 `npx expo install` 은 **사용자가 직접** 실행한다(Task S3-1). 하위 에이전트는 설치 명령을 실행하지 않는다.
- core(`mobile/src/features/fund/core/`)를 고치면 `scripts/check-fund-core-sync.sh --write` 로 web_client 에 복사하고 같은 커밋에 넣는다. core 는 상대 import 만, 세미콜론 사용.
- 하위 에이전트 지시에 넣을 것: 보고·커밋 메시지는 한국어만 / Fact-Forcing Gate 훅이 파일 첫 수정마다 거부하면 요구 사실을 제시하고 같은 호출을 다시 할 것(훅 설정·env 변경 금지) / 패키지 설치 명령 직접 실행 금지.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/apps/collector/push/base.py` (수정) | `PushMessage.title/body` 선택화, `priority`·`content_available` |
| `backend/apps/collector/push/expo.py` (수정) | `_payload` — 빈 필드 생략, `priority`·`contentAvailable` |
| `backend/apps/collector/tasks/push_sends.py` (수정) | `send_fund_notice` 에 깨우기용 발송 추가 |
| `backend/tests/test_push_sends_task.py`, `backend/tests/test_expo_push.py` (수정) | 위 테스트 |
| `mobile/src/features/fund/core/history-view.ts` (수정, +web 복사) | `HistoryRowView.gapFrom` |
| `mobile/src/features/fund/core/history-view.test.ts` (수정) | gapFrom 테스트 |
| `mobile/src/features/fund/history-web/history-page.ts` (수정) | 날짜 옆 "이전 기록 M.D" |
| `mobile/src/features/fund/background/background-mode.ts` (신규) | 백그라운드 실행 중 표시(중첩 카운트) |
| `mobile/src/features/fund/background/backup-pending.ts` (신규) | 백업 보류 파일 표시 |
| `mobile/src/features/fund/background/push-payload.ts` (+test, 신규) | 태스크 payload 에서 `type` 꺼내기(방어적) |
| `mobile/src/features/fund/background/run-core.ts` (+test, 신규) | `backgroundRecordWith` — 로그인 확인·force·25초 한도 |
| `mobile/src/features/fund/background/periodic-core.ts` (+test, 신규) | `syncPeriodicTaskWith` — 정기 작업 등록·해제 판단 |
| `mobile/src/features/fund/background/tasks.ts` (신규) | `defineTask` 2개(모듈 최상위), 실제 의존성 연결, `useBackgroundTasks` |
| `mobile/src/features/fund/auto-refresh.ts` (+test, 수정) | 백그라운드면 백업 대신 보류, `flushPendingBackup` |
| `mobile/src/app/_layout.tsx`, `mobile/src/app/fund/index.tsx` (수정) | 태스크 모듈 로드·훅·펀드 추가/삭제 시 동기화 |
| `mobile/app.config.js` (수정) | 플러그인 설정 |
| `README.md`, 스펙 §7.1 (수정) | 실기기 확인 절차·관찰한 payload 모양 |

---

### Task S1: 서버 — 깨우기용(무음) 메시지 추가

**선행:** 알림 계획 작업 2(`ExpoPushSender`)·작업 3(`push_sends.send_fund_notice`) 완료.

**Files:**
- Modify: `backend/apps/collector/push/base.py` (`PushMessage`)
- Modify: `backend/apps/collector/push/expo.py` (`_payload`)
- Modify: `backend/apps/collector/tasks/push_sends.py` (`send_fund_notice`)
- Test: `backend/tests/test_expo_push.py`, `backend/tests/test_push_sends_task.py`

- [ ] **S1-1. 실패하는 테스트 추가**

`backend/tests/test_expo_push.py` 끝에 추가(파일 상단 import 에 `from apps.collector.push.expo import _payload` 가 없으면 추가):
```python
def test_silent_payload_has_only_data_priority_content_available():
    from apps.collector.push.base import PushMessage

    m = PushMessage(data={"type": "fund_refresh", "date": "2026-10-21"}, priority="high", content_available=True)
    assert _payload("tok", m) == {
        "to": "tok",
        "data": {"type": "fund_refresh", "date": "2026-10-21"},
        "priority": "high",
        "contentAvailable": True,
    }


def test_alert_payload_unchanged_shape():
    from apps.collector.push.base import PushMessage

    m = PushMessage(title="제목", body="본문", data={"type": "fund_report"}, channel_id="fund-report", sound="default")
    assert _payload("tok", m) == {
        "to": "tok", "title": "제목", "body": "본문", "data": {"type": "fund_report"},
        "channelId": "fund-report", "sound": "default",
    }


def test_new_post_message_style_still_works():
    """새 글 알림의 기존 호출(title/body/data 키워드 + send_multicast)이 그대로 동작."""
    from apps.collector.push.base import PushMessage
    from apps.collector.push.mock import MockPushSender

    m = PushMessage(title="[공지] 새 글이 등록되었습니다", body="제목", data={"type": "new_post", "post_id": 1})
    assert MockPushSender().send_multicast(["a", "b"], m) == 2
```

`backend/tests/test_push_sends_task.py` 끝에 추가:
```python
def test_sends_wake_message_after_alert(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    push_sends.send_fund_notice(_seed(maker))
    assert len(sender.calls) == 2
    (alert_tokens, alert), (wake_tokens, wake) = sender.calls
    assert sorted(wake_tokens) == sorted(alert_tokens)
    assert alert.data["type"] == "fund_report" and alert.title
    assert wake.title is None and wake.body is None
    assert wake.data == {"type": "fund_refresh", "date": "2026-03-05"}
    assert wake.priority == "high" and wake.content_available is True


def test_test_mode_wakes_admin_device_too(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    push_sends.send_fund_notice(_seed(maker, mode="test"))
    assert [c[0] for c in sender.calls] == [["ExponentPushToken[admin]"], ["ExponentPushToken[admin]"]]


def test_counts_follow_alert_and_wake_invalid_tokens_also_deleted(maker, monkeypatch):
    class WakeInvalid(FakeSender):
        def send_batch(self, tokens, message):
            self.calls.append((list(tokens), message))
            if message.data.get("type") == "fund_refresh":
                return BatchResult(success=1, failure=1, invalid_tokens=["ExponentPushToken[u1]"])
            return BatchResult(success=len(tokens))

    monkeypatch.setattr(push_sends, "get_push_sender", lambda: WakeInvalid())
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        s = db.get(PushSend, sid)
        assert (s.status, s.success_count, s.failure_count) == ("done", 2, 0)  # 이력은 알림용 기준
        assert "ExponentPushToken[u1]" not in set(db.execute(select(PushDevice.token)).scalars())


def test_wake_failure_does_not_change_status(maker, monkeypatch):
    class WakeBoom(FakeSender):
        def send_batch(self, tokens, message):
            if message.data.get("type") == "fund_refresh":
                raise RuntimeError("wake 실패")
            return super().send_batch(tokens, message)

    monkeypatch.setattr(push_sends, "get_push_sender", lambda: WakeBoom())
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        assert db.get(PushSend, sid).status == "done"
```

- [ ] **S1-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_expo_push.py tests/test_push_sends_task.py`
예상: 새 테스트 FAIL — `TypeError: PushMessage.__init__() missing 2 required positional arguments: 'title' and 'body'` 및 `len(sender.calls) == 1`.

- [ ] **S1-3. `PushMessage` 수정** — `backend/apps/collector/push/base.py`

`class PushMessage` 를 아래로 교체(필드 순서 title, body, data 유지 → 기존 키워드 호출 그대로):
```python
@dataclass
class PushMessage:
    # 깨우기용(무음) 메시지는 title/body 없이 data 만 — 앱 백그라운드 태스크가 받는다
    title: str | None = None
    body: str | None = None
    data: dict = field(default_factory=dict)  # 딥링크 등 부가 데이터
    channel_id: str | None = None  # Android 알림 채널(Expo channelId)
    sound: str | None = None
    priority: str | None = None  # 'high' — 잠든 Android 기기도 깨움
    content_available: bool = False  # iOS 백그라운드 깨우기(Expo contentAvailable)
```

- [ ] **S1-4. `_payload` 수정** — `backend/apps/collector/push/expo.py`

`def _payload(...)` 를 아래로 교체:
```python
def _payload(token: str, message: PushMessage) -> dict:
    """비어 있는 필드는 보내지 않는다 — 제목·본문이 없으면 Android 데이터 전용(앱 태스크가 받음)."""
    m: dict = {"to": token}
    if message.title:
        m["title"] = message.title
    if message.body:
        m["body"] = message.body
    if message.data:
        m["data"] = message.data
    if message.channel_id:
        m["channelId"] = message.channel_id
    if message.sound:
        m["sound"] = message.sound
    if message.priority:
        m["priority"] = message.priority
    if message.content_available:
        m["contentAvailable"] = True  # 옛 이름 _contentAvailable 은 하위 호환일 뿐(Expo 문서 2026-10-21)
    return m
```
기존 test_expo_push 의 알림용 payload 기대값이 `"title"/"body"/"data"` 를 항상 포함하도록 되어 있으면(빈 data 포함) 새 규칙에 맞게 기대값만 고친다 — 비어 있지 않은 값은 그대로 들어간다.

- [ ] **S1-5. `send_fund_notice` 에 깨우기용 발송** — `backend/apps/collector/tasks/push_sends.py`

`message = PushMessage(...)` 블록 바로 아래에:
```python
        # 깨우기용(무음) — 앱이 꺼져 있어도 백그라운드에서 갱신·히스토리 기록(스펙 §7.1). 이력 수치에는 넣지 않는다
        wake = PushMessage(
            data={"type": "fund_refresh", "date": send.ref_date.isoformat()},
            priority="high",
            content_available=True,
        )
```
`try: result = get_push_sender().send_batch(tokens, message) ... except ...:` 블록을 아래로 교체:
```python
        sender = get_push_sender()
        try:
            result = sender.send_batch(tokens, message)
        except Exception as exc:  # noqa: BLE001
            logger.warning("send_fund_notice: 발송기 오류(send_id=%s): %s", send_id, exc)
            result = BatchResult(failure=len(tokens))
        wake_invalid: list[str] = []
        if tokens:
            try:
                wake_result = sender.send_batch(tokens, wake)
                wake_invalid = wake_result.invalid_tokens
                logger.info("send_fund_notice: wake id=%s ok=%s fail=%s", send_id, wake_result.success, wake_result.failure)
            except Exception as exc:  # noqa: BLE001 - 깨우기 실패는 알림 결과를 바꾸지 않는다
                logger.warning("send_fund_notice: 깨우기용 발송 실패(send_id=%s): %s", send_id, exc)
        invalid = sorted(set(result.invalid_tokens) | set(wake_invalid))
```
그 아래 `if result.invalid_tokens: db.execute(delete(...).where(PushDevice.token.in_(result.invalid_tokens)))` 를:
```python
        if invalid:
            db.execute(delete(PushDevice).where(PushDevice.token.in_(invalid)))
```
로 바꾸고, 마지막 `logger.info(...)` 의 `len(result.invalid_tokens)` 를 `len(invalid)` 로 바꾼다.

주의: 기존 `test_sender_exception_marks_failed` 의 `Boom` 은 두 호출 모두 예외 → 알림 실패(`failed`, failure=2) 그대로, 깨우기 예외는 로그만. 기존 `test_now_sends_to_fund_notice_devices_and_renders_date` 는 `sender.calls[0]` 만 보므로 그대로 통과.

- [ ] **S1-6. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_expo_push.py tests/test_push_sends_task.py` → 모두 PASS
실행: `cd backend && uv run pytest -p no:warnings` → 전체 실패 0

- [ ] **S1-7. 커밋**

```bash
git add backend/apps/collector/push/base.py backend/apps/collector/push/expo.py backend/apps/collector/tasks/push_sends.py \
  backend/tests/test_expo_push.py backend/tests/test_push_sends_task.py
git commit -m "feat(collector): 펀드 알림에 무음 깨우기 메시지 추가(앱 백그라운드 기록용)"
```

---

### Task S2: 빈 날 표시 — core `gapFrom` + 히스토리 페이지

**선행 없음.**

**Files:**
- Modify: `mobile/src/features/fund/core/history-view.ts`
- Test: `mobile/src/features/fund/core/history-view.test.ts`
- Modify: `mobile/src/features/fund/history-web/history-page.ts` (CSS·`row`)
- Copy: `web_client/src/lib/fundCore/history-view.ts` (sync 스크립트)

- [ ] **S2-1. 실패하는 테스트 추가** — `history-view.test.ts` 끝에

(요일: 2026-10-16 금, 10-19 월, 10-20 화, 10-21 수, 10-22 목, 10-23 금)
```ts
describe('gapFrom — 빠진 평일 표시', () => {
  const rows = (dates: string[], range: 'all' | '1m' = 'all') =>
    toHistoryView(h({ A: dates.map((d) => p(d, 1000)) }), 'A', range).rows.map((r) => [r.date, r.gapFrom]);

  it('연속 평일이면 표시 없음, 첫 기록도 없음', () => {
    expect(rows(['2026-10-20', '2026-10-21', '2026-10-22'])).toEqual([
      ['2026.10.22', null],
      ['2026.10.21', null],
      ['2026.10.20', null],
    ]);
  });

  it('금 → 월 은 주말만 건너뛴 것이라 표시 없음', () => {
    expect(rows(['2026-10-16', '2026-10-19'])).toEqual([
      ['2026.10.19', null],
      ['2026.10.16', null],
    ]);
  });

  it('평일이 빠지면 바로 이전 기록 날짜(M.D)', () => {
    expect(rows(['2026-10-19', '2026-10-21', '2026-10-23'])).toEqual([
      ['2026.10.23', '10.21'],
      ['2026.10.21', '10.19'],
      ['2026.10.19', null],
    ]);
  });

  it('금 → 화 는 월요일이 빠진 것', () => {
    expect(rows(['2026-10-16', '2026-10-20'])[0]).toEqual(['2026.10.20', '10.16']);
  });

  it('기간 필터로 잘린 맨 아래 행도 범위 밖 이전 기록과 비교한다', () => {
    const r = rows(['2026-08-03', '2026-10-21'], '1m');
    expect(r).toEqual([['2026.10.21', '8.3']]);
  });
});
```

- [ ] **S2-2. 실패 확인**

실행: `cd mobile && npx jest src/features/fund/core/history-view.test.ts`
예상: FAIL — `gapFrom` 이 `undefined`.

- [ ] **S2-3. 구현** — `core/history-view.ts`

타입 줄을:
```ts
// gapFrom: 바로 이전 기록이 '직전 평일'보다 앞이면 그 날짜(M.D) — 그 사이가 빠졌다는 표시(공휴일은 모름)
export type HistoryRowView = { date: string; value: ViewCell; day: ViewCell; month: ViewCell; gapFrom: string | null };
```
`daysBefore` 함수 아래에 추가:
```ts
/** UTC 기준 요일로 토·일 판단 */
function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 || w === 6;
}

/** 직전 평일(토·일 건너뜀) */
function prevWeekday(iso: string): string {
  let d = daysBefore(iso, 1);
  while (isWeekend(d)) d = daysBefore(d, 1);
  return d;
}

/** 'YYYY-MM-DD' → 'M.D' */
function md(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}
```
`toHistoryView` 의 `rows:` 를 아래로 교체(기간 필터로 잘려도 이전 기록은 전체 목록에서 찾는다 — `pts` 는 `all` 의 꼬리):
```ts
    rows: pts
      .map((p, i) => {
        const prev = all[all.length - pts.length + i - 1];
        return {
          date: dot(p.date),
          value: cell('현재평가금', p.value),
          day: cell('당일 손익금', p.day),
          month: cell('월 손익금', p.month),
          gapFrom: prev && prev.date < prevWeekday(p.date) ? md(prev.date) : null,
        };
      })
      .reverse(),
```

- [ ] **S2-4. 히스토리 페이지에 표시** — `history-web/history-page.ts`

`CSS` 의 `.hrow .k { ... }` 줄 다음에:
```css
.hrow .gap { margin-left:6px; font-size:11px; color:var(--text-2); }
```
`function row(r)` 를:
```js
  function row(r) {
    var date = [h('span', 'num', [r.date])];
    if (r.gapFrom) date.push(h('span', 'gap', ['이전 기록 ' + r.gapFrom]));
    return h('div', 'hrow', [
      h('div', 'line', [h('div', 'k', date), val(r.value, 'v', 'div')]),
      h('div', 'sub', [h('span', 'muted', ['당일 ']), val(r.day), h('span', 'muted', [' · 월 ']), val(r.month)])
    ]);
  }
```
(`PAGE_SCRIPT` 는 `String.raw` 안이라 백틱 금지 — 위 코드는 따옴표만 쓴다. 값은 `h()` 가 textContent 로 넣는다.)

- [ ] **S2-5. 통과 확인 + web 복사**

실행: `cd mobile && npx jest src/features/fund/core/history-view.test.ts src/features/fund/history-web` → PASS
실행: `cd mobile && npm run typecheck` → 오류 0 (`gapFrom` 은 필수 필드 — 오류가 나면 `grep -rn "HistoryRowView\|rows: \[" mobile/src` 로 찾은 리터럴에 `gapFrom: null` 추가)
실행(저장소 루트): `scripts/check-fund-core-sync.sh --write` → `fund core: in sync`
실행: `cd web_client && npx tsc --noEmit` → 오류 0(웹은 `gapFrom` 을 쓰지 않음, 타입만 늘어남)

- [ ] **S2-6. 커밋**

```bash
git add mobile/src/features/fund/core/history-view.ts mobile/src/features/fund/core/history-view.test.ts \
  mobile/src/features/fund/history-web/history-page.ts web_client/src/lib/fundCore/history-view.ts
git commit -m "feat(fund): 히스토리에 빠진 평일 표시(이전 기록 M.D)"
```

---

### Task S3: 백그라운드 기록 순수 로직 (설치 전에도 테스트 가능)

**선행:** 알림 계획 작업 8 완료(`expo-notifications` 설치, `features/auth/logout-hooks.ts` 존재).

**Files:**
- Create: `mobile/src/features/fund/background/background-mode.ts`
- Create: `mobile/src/features/fund/background/push-payload.ts`, `push-payload.test.ts`
- Create: `mobile/src/features/fund/background/run-core.ts`, `run-core.test.ts`
- Create: `mobile/src/features/fund/background/periodic-core.ts`, `periodic-core.test.ts`

- [ ] **S3-1. 사용자에게 패키지 설치 요청 (하위 에이전트는 실행하지 않음)**

사용자에게 안내: `! cd mobile && npx expo install expo-background-task expo-task-manager`
그리고 "Task S5 의 재빌드 전까지 기기의 개발 앱은 쓰지 말 것"(새 네이티브 모듈이 옛 바이너리에서 빨간 화면을 낸다). 실행 중인 Metro(8082)가 있으면 멈춘다. 설치 확인: `ls mobile/node_modules | grep -E "expo-background-task|expo-task-manager"` 두 줄.

- [ ] **S3-2. 실패하는 테스트 작성**

`mobile/src/features/fund/background/push-payload.test.ts`:
```ts
import { pushTypeOf } from './push-payload';

describe('pushTypeOf — 태스크 payload 모양이 문서에 없어 여러 모양을 받는다', () => {
  it('data.data 가 객체', () => {
    expect(pushTypeOf({ data: { type: 'fund_refresh', date: '2026-10-21' } })).toBe('fund_refresh');
  });
  it('data.data.body 가 JSON 문자열', () => {
    expect(pushTypeOf({ data: { body: '{"type":"fund_refresh"}' } })).toBe('fund_refresh');
  });
  it('data.body 가 JSON 문자열', () => {
    expect(pushTypeOf({ body: '{"type":"fund_refresh"}' })).toBe('fund_refresh');
  });
  it('data.dataString (Android)', () => {
    expect(pushTypeOf({ data: { dataString: '{"type":"fund_refresh"}' } })).toBe('fund_refresh');
  });
  it('최상위에 type', () => {
    expect(pushTypeOf({ type: 'fund_report' })).toBe('fund_report');
  });
  it('모르는 모양·깨진 JSON·비객체는 null', () => {
    expect(pushTypeOf(null)).toBeNull();
    expect(pushTypeOf('x')).toBeNull();
    expect(pushTypeOf({ body: '{깨짐' })).toBeNull();
    expect(pushTypeOf({ data: { other: 1 } })).toBeNull();
  });
});
```

`mobile/src/features/fund/background/run-core.test.ts`:
```ts
import { backgroundRecordWith, type RunDeps } from './run-core';

const deps = (over: Partial<RunDeps> = {}) => {
  const leave = jest.fn();
  const d: RunDeps & { leave: jest.Mock } = {
    hydrate: jest.fn(async () => {}),
    isLoggedIn: jest.fn(() => true),
    run: jest.fn(async () => {}),
    enter: jest.fn(() => leave),
    timeoutMs: 50,
    random: () => 0,
    sleep: jest.fn(async () => {}),
    leave,
    ...over,
  };
  return d;
};

it('로그아웃 상태면 아무것도 하지 않는다', async () => {
  const d = deps({ isLoggedIn: () => false });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('skipped');
  expect(d.run).not.toHaveBeenCalled();
  expect(d.enter).not.toHaveBeenCalled();
});

it('hydrate 가 실패하면 건너뛴다', async () => {
  const d = deps({ hydrate: async () => Promise.reject(new Error('x')) });
  await expect(backgroundRecordWith('periodic', d)).resolves.toBe('skipped');
  expect(d.run).not.toHaveBeenCalled();
});

it('push 는 force, 정기 작업은 force 없이', async () => {
  const a = deps();
  await backgroundRecordWith('push', a);
  expect(a.run).toHaveBeenCalledWith({ force: true });
  const b = deps();
  await backgroundRecordWith('periodic', b);
  expect(b.run).toHaveBeenCalledWith({ force: false });
});

it('끝나면 백그라운드 표시를 끈다', async () => {
  const d = deps();
  await expect(backgroundRecordWith('push', d)).resolves.toBe('done');
  expect(d.enter).toHaveBeenCalledTimes(1);
  expect(d.leave).toHaveBeenCalledTimes(1);
});

it('한도를 넘으면 timeout 으로 돌아오지만, 표시는 실행이 실제로 끝날 때 끈다', async () => {
  let finish: () => void = () => {};
  const d = deps({ run: jest.fn(() => new Promise<void>((res) => (finish = res))) });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('timeout');
  expect(d.leave).not.toHaveBeenCalled(); // 늦게 끝난 실행이 앞 화면처럼 백업하지 않게
  finish();
  await new Promise((r) => setTimeout(r, 0));
  expect(d.leave).toHaveBeenCalledTimes(1);
});

it('push 는 0~10초 무작위로 기다린 뒤 가져온다(모든 기기가 한꺼번에 원본을 치지 않게), 정기 작업은 바로', async () => {
  const a = deps({ random: () => 0.5 });
  await backgroundRecordWith('push', a);
  expect(a.sleep).toHaveBeenCalledWith(5_000);
  const b = deps({ random: () => 0.5 });
  await backgroundRecordWith('periodic', b);
  expect(b.sleep).not.toHaveBeenCalled();
});

it('실행이 실패해도 표시를 끄고 done', async () => {
  const d = deps({ run: jest.fn(async () => Promise.reject(new Error('x'))) });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('done');
  expect(d.leave).toHaveBeenCalledTimes(1);
});
```

`mobile/src/features/fund/background/periodic-core.test.ts`:
```ts
import { syncPeriodicTaskWith, type PeriodicDeps } from './periodic-core';

const deps = (over: Partial<PeriodicDeps> = {}): PeriodicDeps => ({
  want: true,
  available: jest.fn(async () => true),
  isRegistered: jest.fn(async () => false),
  register: jest.fn(async () => {}),
  unregister: jest.fn(async () => {}),
  ...over,
});

it('원하는데 없으면 등록', async () => {
  const d = deps();
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('registered');
  expect(d.register).toHaveBeenCalledTimes(1);
});

it('이미 등록돼 있으면 그대로', async () => {
  const d = deps({ isRegistered: async () => true });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unchanged');
  expect(d.register).not.toHaveBeenCalled();
});

it('원하지 않는데 있으면 해제', async () => {
  const d = deps({ want: false, isRegistered: async () => true });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unregistered');
  expect(d.unregister).toHaveBeenCalledTimes(1);
});

it('OS 가 막아 두면(Restricted) 등록하지 않는다', async () => {
  const d = deps({ available: async () => false });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unavailable');
  expect(d.register).not.toHaveBeenCalled();
});

it('오류는 삼키고 failed', async () => {
  const d = deps({ isRegistered: async () => Promise.reject(new Error('x')) });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('failed');
});
```

- [ ] **S3-3. 실패 확인**

실행: `cd mobile && npx jest src/features/fund/background`
예상: FAIL — `Cannot find module './push-payload'` 등.

- [ ] **S3-4. 구현**

`mobile/src/features/fund/background/background-mode.ts`:
```ts
// 지금 백그라운드 태스크 안에서 자동 갱신 중인지 — 그동안 생긴 새 기록의 Drive 백업은 다음 앱 복귀로 미룬다.
// push·정기 작업이 겹칠 수 있어 카운트로 센다. 각 태스크는 enter() 가 준 leave 를 한 번만 부른다.
let depth = 0;

export const isBackgroundRun = (): boolean => depth > 0;

export function enterBackgroundRun(): () => void {
  depth += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    depth = Math.max(0, depth - 1);
  };
}

export const resetBackgroundRunForTest = (): void => {
  depth = 0;
};
```

`mobile/src/features/fund/background/push-payload.ts`:
```ts
// 백그라운드 알림 태스크의 data 는 FCM·APNs 원본 payload 라 모양이 문서에 없다(Expo 문서 2026-10-21 확인).
// 알려진 후보를 차례로 본다: 객체 data / JSON 문자열 body / Android dataString / 최상위 type.
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function typeIn(v: unknown): string | null {
  if (isObj(v) && typeof v.type === 'string') return v.type;
  if (typeof v === 'string') {
    try {
      return typeIn(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return null;
}

export function pushTypeOf(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  const inner = payload.data;
  const candidates: unknown[] = [payload];
  if (isObj(inner)) candidates.push(inner, inner.body, inner.dataString);
  candidates.push(payload.body, payload.dataString);
  for (const c of candidates) {
    const t = typeIn(c);
    if (t) return t;
  }
  return null;
}
```

`mobile/src/features/fund/background/run-core.ts`:
```ts
// 백그라운드 기록 본문 — push·정기 태스크가 공유. 실제 갱신은 1단계 자동 갱신과 같은 fundRefresher.run().
export type RunReason = 'push' | 'periodic';
export type RunDeps = {
  hydrate: () => Promise<void>;
  isLoggedIn: () => boolean;
  run: (opts: { force: boolean }) => Promise<void>;
  enter: () => () => void; // 백그라운드 표시 켜기 → 끄기 함수
  timeoutMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const BACKGROUND_TIMEOUT_MS = 25_000; // iOS 는 약 30초 안에 끝내야 한다
// 관리자 발송 한 번에 모든 기기가 깨어나므로 원본 사이트 부하를 나눈다(SSE 는 0~30초, 여기선 25초 한도 안에서 0~10초)
export const PUSH_JITTER_MS = 10_000;

const defaultSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export async function backgroundRecordWith(
  reason: RunReason,
  d: RunDeps,
): Promise<'skipped' | 'done' | 'timeout'> {
  try {
    await d.hydrate(); // 화면 없이 깨어나면 로그인 정보가 아직 안 읽혔을 수 있다
  } catch {
    return 'skipped';
  }
  if (!d.isLoggedIn()) return 'skipped';

  const leave = d.enter();
  const jitter = reason === 'push' ? Math.floor((d.random ?? Math.random)() * PUSH_JITTER_MS) : 0;
  // 표시는 한도 시점이 아니라 실행이 실제로 끝날 때 끈다 — 늦게 끝난 실행이 백그라운드에서 백업하지 않게
  const work = (jitter > 0 ? (d.sleep ?? defaultSleep)(jitter) : Promise.resolve())
    .then(() => d.run({ force: reason === 'push' }))
    .catch(() => {})
    .finally(leave)
    .then(() => 'done' as const);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), d.timeoutMs ?? BACKGROUND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
```

`mobile/src/features/fund/background/periodic-core.ts`:
```ts
// 정기 백그라운드 작업 등록·해제 판단(로그인 + 펀드 ≥1 일 때만). 푸시 설정·권한과는 무관.
export type PeriodicDeps = {
  want: boolean;
  available: () => Promise<boolean>; // OS 가 백그라운드 작업을 허용하는지
  isRegistered: () => Promise<boolean>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
};

export type PeriodicResult = 'registered' | 'unregistered' | 'unchanged' | 'unavailable' | 'failed';

export async function syncPeriodicTaskWith(d: PeriodicDeps): Promise<PeriodicResult> {
  try {
    const has = await d.isRegistered();
    if (!d.want) {
      if (!has) return 'unchanged';
      await d.unregister();
      return 'unregistered';
    }
    if (has) return 'unchanged';
    if (!(await d.available())) return 'unavailable';
    await d.register();
    return 'registered';
  } catch {
    return 'failed'; // 다음 동기화 시점(앱 실행·펀드 추가/삭제·로그인)에 다시
  }
}
```

- [ ] **S3-5. 통과 확인**

실행: `cd mobile && npx jest src/features/fund/background` → `18 passed`
실행: `cd mobile && npm run typecheck` → 오류 0

- [ ] **S3-6. 커밋**

```bash
git add mobile/src/features/fund/background/background-mode.ts \
  mobile/src/features/fund/background/push-payload.ts mobile/src/features/fund/background/push-payload.test.ts \
  mobile/src/features/fund/background/run-core.ts mobile/src/features/fund/background/run-core.test.ts \
  mobile/src/features/fund/background/periodic-core.ts mobile/src/features/fund/background/periodic-core.test.ts
git commit -m "feat(mobile): 펀드 백그라운드 기록 순수 로직(payload 해석·25초 한도·정기 작업 판단)"
```

---

### Task S4: 백업 보류 — 백그라운드면 파일 표시, 앱 복귀 때 백업

**Files:**
- Create: `mobile/src/features/fund/background/backup-pending.ts`
- Modify: `mobile/src/features/fund/auto-refresh.ts`
- Test: `mobile/src/features/fund/auto-refresh.test.ts`

- [ ] **S4-1. 실패하는 테스트 추가** — `auto-refresh.test.ts`

파일 상단 `jest.mock('./backup-service', ...)` 줄 아래에:
```ts
jest.mock('./background/backup-pending', () => ({ markBackupPending: jest.fn(), takeBackupPending: jest.fn() }));
```
import 묶음에:
```ts
import { enterBackgroundRun, resetBackgroundRunForTest } from './background/background-mode';
import { markBackupPending, takeBackupPending } from './background/backup-pending';
```
`import { fundRefresher, markAddedDuringRun, recordIfRegistered } from './auto-refresh';` 를
`import { flushPendingBackup, fundRefresher, markAddedDuringRun, recordIfRegistered } from './auto-refresh';` 로.

파일 끝에:
```ts
describe('백그라운드 실행 중 백업 보류', () => {
  const backup = maybeAutoBackup as jest.Mock;
  const mark = markBackupPending as jest.Mock;
  beforeEach(() => {
    backup.mockClear();
    mark.mockClear();
    resetBackgroundRunForTest();
  });

  it('백그라운드면 백업 대신 보류 표시만 남긴다', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const leave = enterBackgroundRun();
    const run = fundRefresher.run();
    markAddedDuringRun();
    release([]);
    await run;
    leave();
    expect(backup).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it('앞 화면이면 기존처럼 바로 백업', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const run = fundRefresher.run();
    markAddedDuringRun();
    release([]);
    await run;
    expect(backup).toHaveBeenCalledTimes(1);
    expect(mark).not.toHaveBeenCalled();
  });
});

describe('flushPendingBackup', () => {
  it('보류 표시가 있으면 백업하고, 없으면 하지 않는다', () => {
    const d = { takeBackupPending: jest.fn(() => true), maybeAutoBackup: jest.fn(async () => {}) };
    flushPendingBackup(d);
    expect(d.maybeAutoBackup).toHaveBeenCalledTimes(1);
    const e = { takeBackupPending: jest.fn(() => false), maybeAutoBackup: jest.fn(async () => {}) };
    flushPendingBackup(e);
    expect(e.maybeAutoBackup).not.toHaveBeenCalled();
  });

  it('기본 의존성은 보류 파일 모듈을 쓴다', () => {
    (takeBackupPending as jest.Mock).mockReturnValueOnce(false);
    flushPendingBackup();
    expect(takeBackupPending).toHaveBeenCalled();
  });
});
```

- [ ] **S4-2. 실패 확인**

실행: `cd mobile && npx jest src/features/fund/auto-refresh.test.ts`
예상: FAIL — `Cannot find module './background/backup-pending'`

- [ ] **S4-3. 보류 파일 모듈** — `mobile/src/features/fund/background/backup-pending.ts`

```ts
// 백그라운드에서 새 기록이 생겼다는 표시 — 다음 앱 복귀 때 Drive 백업. 메모리가 아니라 파일인 이유:
// Android 는 앱이 꺼진 상태에서 태스크만 따로 실행됐다 끝날 수 있고, SecureStore 는 iOS 잠금 중 못 읽을 수 있다.
import { File, Paths } from 'expo-file-system';

const pendingFile = (): File => new File(Paths.document, 'fund-backup-pending.json');

export function markBackupPending(): void {
  try {
    const f = pendingFile();
    if (!f.exists) f.create();
    f.write(String(Date.now()));
  } catch {
    // 못 남겨도 다음 새 기록 때 maybeAutoBackup 이 다시 시도한다
  }
}

/** 표시가 있었으면 지우고 true */
export function takeBackupPending(): boolean {
  try {
    const f = pendingFile();
    if (!f.exists) return false;
    f.delete();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **S4-4. `auto-refresh.ts` 수정**

import 에 추가:
```ts
import { isBackgroundRun } from './background/background-mode';
import { markBackupPending, takeBackupPending } from './background/backup-pending';
```
`fundRefresher.subscribe(...)` 블록(44~49행)을:
```ts
// 백업은 이번 갱신의 모든 펀드를 기록한 뒤 1번 — 첫 펀드에서 하면 나머지 기록이 다음 날까지 Drive 에 빠진다.
// 백그라운드 태스크 안이면 백업하지 않고 표시만(구글 토큰 갱신이 화면 없이 실패할 수 있고 시간이 짧다)
fundRefresher.subscribe(() => {
  if (!fundRefresher.getStatus().running && addedThisRun) {
    addedThisRun = false;
    if (isBackgroundRun()) markBackupPending();
    else void maybeAutoBackup();
  }
});

/** 백그라운드에서 미뤄 둔 백업 — 앱이 앞에 와서 자동 갱신이 끝난 뒤 */
export function flushPendingBackup(deps = { takeBackupPending, maybeAutoBackup }): void {
  if (deps.takeBackupPending()) void deps.maybeAutoBackup();
}
```
`useFundAutoRefresh` 안의 두 `void fundRefresher.run();` 을 각각:
```ts
    void fundRefresher.run().then(() => flushPendingBackup());
```
과
```ts
      if (prev !== 'active' && next === 'active') void fundRefresher.run().then(() => flushPendingBackup());
```
로 바꾼다.

- [ ] **S4-5. 통과 확인**

실행: `cd mobile && npx jest src/features/fund` → 모두 PASS(기존 markAddedDuringRun 테스트 포함)
실행: `cd mobile && npm run typecheck` → 오류 0

- [ ] **S4-6. 커밋**

```bash
git add mobile/src/features/fund/background/backup-pending.ts mobile/src/features/fund/auto-refresh.ts mobile/src/features/fund/auto-refresh.test.ts
git commit -m "feat(mobile): 백그라운드 새 기록은 백업을 다음 앱 복귀로 미룸"
```

---

### Task S5: 태스크 정의·연결·config + 재빌드

**Files:**
- Create: `mobile/src/features/fund/background/tasks.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/src/app/fund/index.tsx` (`handleAdd`·`handleRemove`)
- Modify: `mobile/app.config.js` (plugins)

- [ ] **S5-1. 태스크 모듈** — `mobile/src/features/fund/background/tasks.ts`

```ts
// 백그라운드 태스크 2개 — 화면 없이 깨어날 때도 등록돼 있어야 하므로 모듈 최상위에서 정의한다(_layout 이 맨 위에서 import).
// push: 관리자 발송의 깨우기용 메시지(type 'fund_refresh') / periodic: 6시간 안팎(OS 재량) 안전망.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { isPushConfigured } from '@/features/push/config';

import { fundRefresher } from '../auto-refresh';
import { loadFunds } from '../fund-store';
import { enterBackgroundRun } from './background-mode';
import { syncPeriodicTaskWith } from './periodic-core';
import { pushTypeOf } from './push-payload';
import { backgroundRecordWith, type RunReason } from './run-core';

export const PUSH_TASK = 'fund-refresh-push';
export const PERIODIC_TASK = 'fund-refresh-periodic';
const PERIODIC_MINUTES = 360;

const backgroundRecord = (reason: RunReason) =>
  backgroundRecordWith(reason, {
    hydrate: () => useAuthStore.getState().hydrate(),
    isLoggedIn: () => useAuthStore.getState().user !== null,
    run: (o) => fundRefresher.run(o),
    enter: enterBackgroundRun,
  });

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error) return;
  if (__DEV__) console.log('[fund-bg] push payload', JSON.stringify(data).slice(0, 500)); // 실제 모양 확인용(S5-6)
  if (pushTypeOf(data) !== 'fund_refresh') return;
  if (AppState.currentState === 'active') return; // 앞에 있으면 SSE·자동 갱신이 이미 처리
  await backgroundRecord('push');
});

TaskManager.defineTask(PERIODIC_TASK, async () => {
  try {
    await backgroundRecord('periodic');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// push 태스크는 푸시가 설정됐으면 항상 등록 — 서버는 펀드를 등록한 기기에만 보낸다(Expo 문서: 모듈 최상위에서 등록)
if (isPushConfigured()) void Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});

/** 정기 작업: 로그인 + 펀드 ≥1 이면 등록, 아니면 해제. 푸시 설정·권한과 무관 */
export async function syncBackgroundTasks(): Promise<void> {
  const loggedIn = useAuthStore.getState().user !== null;
  const funds = loggedIn ? await loadFunds().catch(() => []) : [];
  const r = await syncPeriodicTaskWith({
    want: loggedIn && funds.length > 0,
    available: async () =>
      (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available,
    isRegistered: () => TaskManager.isTaskRegisteredAsync(PERIODIC_TASK),
    register: () => BackgroundTask.registerTaskAsync(PERIODIC_TASK, { minimumInterval: PERIODIC_MINUTES }),
    unregister: () => BackgroundTask.unregisterTaskAsync(PERIODIC_TASK),
  });
  if (__DEV__) console.log('[fund-bg] periodic', r);
}

/** 루트 레이아웃에서 한 번 — 로그인 복원 뒤 동기화, 로그아웃 직전 해제 */
export function useBackgroundTasks(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  const hydrated = useAuthStore((s) => s.hydrated);
  useEffect(() => {
    const off = registerBeforeLogout(() => {
      void BackgroundTask.unregisterTaskAsync(PERIODIC_TASK).catch(() => {});
    });
    return () => {
      off(); // 반환값(Set.delete 의 boolean)을 cleanup 으로 넘기지 않게 감싼다
    };
  }, []);
  useEffect(() => {
    if (hydrated) void syncBackgroundTasks(); // 복원 전(user=null)에 돌면 매 실행마다 해제됐다 재등록된다
  }, [hydrated, loggedIn]);
}
```

- [ ] **S5-2. 화면 연결**

`mobile/index.ts`(앱 엔트리, `package.json` `"main": "index.ts"`) — 현재 `import './unistyles';` 다음 `import 'expo-router/entry';` 두 줄이다. 그 사이에 넣는다:
```ts
// Unistyles를 먼저 초기화(StyleSheet.configure)한 뒤 앱을 부팅한다.
import './unistyles';
// 백그라운드 태스크 정의 — 화면 없이 깨어날 때(앱 종료 상태의 무음 push·정기 작업)는 라우트(_layout)가 평가되지 않으므로 엔트리에서
import './src/features/fund/background/tasks';
import 'expo-router/entry';
```
(`_layout.tsx` 에는 side-effect import 를 두지 않는다 — Expo 문서: "앱이 일찍 require 하는 모듈(예: index.ts)의 최상위에서 정의·등록".)

`mobile/src/app/_layout.tsx`:
- import 에 `import { useBackgroundTasks } from '@/features/fund/background/tasks';`
- `usePushSetup();` 다음 줄에 `useBackgroundTasks(); // 정기 백그라운드 기록 등록·해제`

`mobile/src/app/fund/index.tsx`:
- import 에 `import { syncBackgroundTasks } from '@/features/fund/background/tasks';`
- `handleAdd` 안 `void syncPushRegistration();` 다음 줄에 `void syncBackgroundTasks();`
- `handleRemove` 안 `void syncPushRegistration(); // 마지막 펀드를 지우면 알림 해제` 다음 줄에 `void syncBackgroundTasks();`

- [ ] **S5-3. config 플러그인** — `mobile/app.config.js`

plugins 배열의 `'expo-notifications',` 를:
```js
        ['expo-notifications', { enableBackgroundRemoteNotifications: true }], // 무음 push 로 앱 깨우기(iOS remote-notification)
        'expo-background-task', // 정기 백그라운드 기록(Android WorkManager · iOS BGTaskScheduler)
```
확인: `cd mobile && npx expo config --type introspect | grep -A4 -E "UIBackgroundModes|BGTaskSchedulerPermittedIdentifiers"`
예상: `UIBackgroundModes` 에 `remote-notification` 과 `processing`, `BGTaskSchedulerPermittedIdentifiers` 에 `com.expo.modules.backgroundtask.processing`. **없으면** `ios` 블록에 직접 추가:
```js
      infoPlist: {
        UIBackgroundModes: ['remote-notification', 'processing'],
        BGTaskSchedulerPermittedIdentifiers: ['com.expo.modules.backgroundtask.processing'],
      },
```
(iOS 실발송은 범위 밖이지만 설정은 맞춰 둔다.)

- [ ] **S5-4. 검사**

실행: `cd mobile && npm run typecheck` → 오류 0
실행: `cd mobile && npx jest` → 전체 PASS
실행: `cd mobile && npx expo config > /dev/null && echo ok` → `ok`
실행: `cd mobile && npm run lint` → 새 파일에 error 0

- [ ] **S5-5. 커밋**

```bash
git add mobile/index.ts mobile/src/features/fund/background/tasks.ts mobile/src/app/_layout.tsx mobile/src/app/fund/index.tsx mobile/app.config.js
git commit -m "feat(mobile): 펀드 백그라운드 기록 태스크(무음 push·정기 작업) 연결"
```

- [ ] **S5-6. 재빌드·실기기 확인 (사용자)**

사용자에게 안내(하위 에이전트는 실행하지 않음):
1. 새 dev build: `cd mobile && eas build --profile development --platform android --local` (또는 `npm run build:android:devapk`) 후 설치.
2. **무음 push**: 앱에 로그인 + 펀드 1개 이상 + 알림 허용 → 앱을 최근 앱 목록에서 스와이프로 종료 → admin_web 에서 [테스트 발송] → 앱을 열지 않고 `adb logcat -s ReactNativeJS | grep fund-bg` 로 `[fund-bg] push payload ...` 확인 → 앱을 열어 수익 히스토리에 오늘 기록이 있는지. **로그가 아예 안 찍히면** 태스크 정의 위치 문제(엔트리 `index.ts` 의 import 확인)이거나 Android 가 데이터 전용 메시지를 앱에 넘기지 않은 것 — 알림용 메시지는 왔는지와 함께 보고.
3. **정기 작업**: `adb shell dumpsys jobscheduler | grep -B2 -A8 com.stockapp.dev` 로 WorkManager 작업 번호를 찾아 `adb shell cmd jobscheduler run -f com.stockapp.dev <번호>` → 로그·히스토리 확인.
4. 기록이 안 생기면: 기기 설정 → 앱 → 배터리 → "제한 없음"으로 바꿔 다시 확인(사용자에게 강제하지 않는 확인용 설정).
5. 2번 로그에 찍힌 payload 모양(`data` 안의 어디에 `type` 이 있었는지)을 알려 달라고 요청.

---

### Task S6: 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-fund-report-notice-design.md` §7.1 (`push-payload.ts` 줄)
- Modify: `README.md` ("펀드 수익보기" 절)

- [ ] **S6-1. 스펙에 관찰 결과**

S5-6 에서 받은 실제 payload 모양으로 §7.1 의 "실제 모양은 수동 확인 때 로그로 남겨 여기에 적는다" 를 `실제 Android payload: <관찰한 경로, 예: data.data.body 에 JSON 문자열>(2026-10-XX 확인)` 로 바꾼다. 아직 못 받았으면 이 단계는 건너뛰고 사용자에게 남은 일로 보고한다.

- [ ] **S6-2. README**

"펀드 수익보기" 절의 자동 갱신 줄 아래에 추가:
```markdown
- 앱을 열지 않은 날도 기록: 관리자 알림의 무음 push(`fund_refresh`)와 6시간 안팎의 정기 백그라운드 작업이 갱신·히스토리 기록을 한다(Android 위주, iOS 는 OS 재량·잠금 중 불가). 백그라운드에서 생긴 기록의 Drive 백업은 다음에 앱을 열 때.
- 그래도 빠진 평일은 히스토리 날짜 옆에 "이전 기록 M.D" 로 표시(값을 메우지 않음).
- 실기기 확인: 앱 종료 → admin_web 테스트 발송 → `adb logcat -s ReactNativeJS | grep fund-bg`. 정기 작업 강제 실행은 `adb shell cmd jobscheduler run -f com.stockapp.dev <작업번호>`(번호는 `adb shell dumpsys jobscheduler`).
```

- [ ] **S6-3. 커밋**

```bash
git add README.md docs/superpowers/specs/2026-10-19-fund-report-notice-design.md
git commit -m "docs: 펀드 백그라운드 기록·빈 날 표시 안내"
```

---

## 자체 점검 (작성자)

- 스펙 대응: §1 백그라운드 기록 목표(S3~S5) · §5 깨우기용 메시지·이력은 알림용 기준·test 도 2개(S1) · §7.1 hydrate·force 구분·25초·백업 보류(파일)·표시는 실제 종료 시 해제·push 태스크 type 필터·포그라운드 무시·모듈 최상위 정의·정기 작업은 푸시 무관·등록 시점(S3~S5) · §7.2 gapFrom·날짜 옆 표시·web 복사(S2) · §9 강제 종료·시간 초과·보류·로그아웃·iOS 잠금(설계상 처리, 문서화 S6) · §10 jest·pytest 항목(S1~S4), 수동 확인(S5-6).
- 처음 스펙과 달라진 점(스펙 §7.1 에 이미 반영): push 태스크 등록은 "펀드 ≥1 일 때만"이 아니라 푸시 설정 시 항상(Expo 문서가 모듈 최상위 등록을 요구, 서버가 펀드 등록 기기에만 보내므로 결과는 같음). 파일 이름은 `run-core.ts`·`periodic-core.ts`·`tasks.ts`.
- push 깨우기는 0~10초 무작위 지연(`PUSH_JITTER_MS`) — SSE 의 0~30초와 같은 목적(원본 사이트 동시 요청 분산), 25초 한도 안.
- 태스크 정의는 엔트리 `mobile/index.ts` 에서 import(라우트 `_layout` 은 화면 없이 깨어날 때 평가되지 않을 수 있음).
- 이름 일치: `backgroundRecordWith`·`RunDeps`·`enterBackgroundRun`·`isBackgroundRun`·`markBackupPending`·`takeBackupPending`·`flushPendingBackup`·`syncPeriodicTaskWith`·`syncBackgroundTasks`·`useBackgroundTasks`·`PUSH_TASK`·`PERIODIC_TASK` — 정의한 태스크와 쓰는 태스크가 같다.
