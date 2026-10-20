# 장 마감 시간에 맞춘 지표 갱신 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 모든 설명·커밋 메시지는 한국어.

**목표:** 국내 지수 15:40(평일), 미국 지수 06:30(+07:30 안전망, 화~토) 수집, 화면에 실제 갱신 시각 표시.
**구조:** Celery beat 일정 3개(새 2, 변경 1) + 웹 안내 문구 2곳 + 모바일 계획 문구 + 문서. 태스크 코드는 그대로.
**스펙:** [`../specs/2026-10-20-market-close-schedule-design.md`](../specs/2026-10-20-market-close-schedule-design.md)

---

### Task 1: beat 일정 (TDD)

**Files:** Modify `backend/tests/test_market_tasks.py::test_beat_schedule_entries`, `backend/apps/collector/celery_app.py`

- [ ] **Step 1: 테스트 확장** — `test_beat_schedule_entries` 끝에 추가

```python
    # 장 마감 시간에 맞춘 지표 갱신(2026-10-20): 국내 지수 15:40 평일, 미국 06:30 + 07:30 안전망(화~토)
    kr = beat["collect-kr-indices"]
    assert kr["task"] == "collector.collect_market_indices" and kr["kwargs"] == {"region": "KR"}
    assert kr["schedule"].hour == {15} and kr["schedule"].minute == {40}
    assert kr["schedule"].day_of_week == {1, 2, 3, 4, 5}
    for key, hour in (("collect-us-indices", 6), ("collect-us-indices-retry", 7)):
        us = beat[key]
        assert us["task"] == "collector.collect_market_indices" and us["kwargs"] == {"region": "US"}
        assert us["schedule"].hour == {hour} and us["schedule"].minute == {30}
        assert us["schedule"].day_of_week == {2, 3, 4, 5, 6}
```

- [ ] **Step 2: 실패 확인** — `cd backend && uv run pytest tests/test_market_tasks.py::test_beat_schedule_entries` → FAIL(`KeyError: 'collect-kr-indices'`)

- [ ] **Step 3: 일정 수정** — `celery_app.py` 의 `collect-us-indices` 항목을 아래 세 항목으로 바꾼다(국내 지수는 그 앞에)

```python
    # 국내 지수 — KRX 정규장 마감(15:30) 10분 뒤. 지수는 NXT 와 무관하게 15:30 종가로 확정.
    # 20:30 일일 파이프라인의 국내 지수 단계는 안전망으로 그대로 둔다(같은 날짜 덮어쓰기).
    "collect-kr-indices": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=15, minute=40, day_of_week="mon-fri"),
        "kwargs": {"region": "KR"},
    },
    # 미국 지수·환율·대표 종목 — 미국 장 마감(서머타임 05:00 / 그 외 06:00 KST) 뒤. 미국 월~금 → 한국 화~토 아침
    "collect-us-indices": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=6, minute=30, day_of_week="tue-sat"),
        "kwargs": {"region": "US"},
    },
    # 안전망 — 06:30 이 실패했거나 종가가 늦게 확정된 날을 메꾼다(멱등)
    "collect-us-indices-retry": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=7, minute=30, day_of_week="tue-sat"),
        "kwargs": {"region": "US"},
    },
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

### Task 2: 화면 문구

- [ ] `web_client/src/components/market/BasisNote.tsx`: `매일 장 마감 후 갱신` → `국내 지수 15:40 · 종목·테마·업종 20:30 · 미국 06:30 갱신`
- [ ] `web_client/src/components/screener/MarketStrip.tsx`: `매일 장 마감 후 갱신` → `매일 20:30 갱신`
- [ ] `docs/superpowers/plans/2026-10-20-mobile-screener.md` 의 `basis-note.tsx` 코드 문구를 웹 BasisNote 와 같게
- [ ] `cd web_client && npx tsc --noEmit` → 오류 0

### Task 3: 문서 · 검증 · 커밋

- [ ] README "시장 데이터 수집" 절과 `docs/server_setup.md` 의 beat 일정 설명에 국내 지수 15:40·미국 06:30(+07:30) 반영
- [ ] `cd backend && uv run pytest` → 전부 통과
- [ ] 커밋(파일 명시, `git add -A` 금지)
- [ ] 배포 뒤 확인: 다음 거래일 15:40 이후 관리자 데이터 현황 → 국내 지수 기준일 = 당일, 06:30 이후 미국 지수 = 전날(미국 날짜)
