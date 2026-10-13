# 트레이딩 게임 서브페이즈 6b — web_client 게임 모달 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨 · 선행: 6a(web 트레이딩 코어, main `af89b54`) · 단계 프롬프트: `docs/prompts/trading_game/06_phase6_frontend_ui.md` §2-3
> 분할: 6a 코어(완료) → **6b web 모달** → 6c 모바일. 지인 리그는 백로그.

## 1. 목표 / 범위

6a 게임 화면에 에듀테인먼트 모달 4종과 진입점을 붙인다. **백엔드 변경 없음**(Phase 5b API 그대로 사용).

포함:
1. **랭킹 모달** — 탭: 시즌 Top 100 / 명예의 전당(MBTI 뱃지)
2. **퀘스트 모달** — Q1~Q3 진행률·보상 수령·보유 뱃지
3. **아카데미 모달** — 3문항, 통과 시 5x 해금
4. **야간 10초 차트 퀴즈 모달**
5. **Streak 칩** — 헤더 `🔥 n일 연속`

제외: 지인 리그(백로그), MBTI 공유 이미지 내보내기, 모바일(6c).

## 2. 진입점 / 노출 규칙

- `GameHeader`: 6a의 비활성 `🏆 랭킹`·`🎯 퀘스트` 버튼 활성화 + `🧩 퀴즈` 버튼 추가. Streak 칩은 `enabled && current_streak ≥ 1`일 때만.
- **퀴즈 노출(사용자 결정: 항상 열림 + 장 마감 후 강조)**: `🧩 퀴즈` 버튼은 항상. KST **15:30 이후(당일 24:00까지)·토/일**에는 주문 패널 위에 배너 "🧩 야간 10초 차트 퀴즈 도전!"(클릭 시 퀴즈 모달). 판정은 순수 함수 `isQuizPrimeTime(now)`.
- 퀴즈 API가 503 `FEATURE_DISABLED`를 주면 스토어 `quizDisabled=true` → 해당 세션 동안 배너·버튼 숨김(사용자용 플래그 조회 API 없음 — 관리자 전용).
- 5x 🔒 칩 클릭 → 아카데미 모달(6a 안내 토스트 대체).
- 인증: 랭킹(리더보드·명예의 전당 공개 API)은 비로그인도 열람. 퀘스트·퀴즈·아카데미는 비로그인 시 `LoginModal`.

## 3. 백엔드 계약 (Phase 5b — 출처: `schemas/game_dtos.py`, `routers/{leaderboard,quests,academy,quiz}.py`, `services/{ranking_service,quiz_service}.py`)

| 용도 | 엔드포인트 | 인증 | 응답 요지 |
|---|---|---|---|
| 리더보드 | `GET /api/game/seasons/{id}/leaderboard` | ✗ | `[{rank, user_id, nickname\|null, roi_pct, total_asset\|null, win_rate}]`(float) |
| 명예의 전당 | `GET /api/game/hall-of-fame` | ✗ | `[{season_id, rank, nickname, final_roi, final_asset, win_rate, trading_mbti\|null}]`(float), 시즌 desc·순위 asc, 최대 300 |
| 퀘스트 | `GET /api/game/quests` | ✓ | `{quests:[{code,title,description,target,progress,reward_cash(Dec\|null),reward_badge\|null,completed,claimed}], badges:[{code,name,awarded_at\|null}]}` |
| 보상 수령 | `POST /api/game/quests/{code}/claim` | ✓ | `{quest, cash_balance(Dec\|null), badge\|null}` · 409 `QUEST_NOT_COMPLETED/ALREADY_CLAIMED/NO_ACTIVE_SEASON/PRICE_UNAVAILABLE`, 404 `QUEST_NOT_FOUND` |
| 아카데미 | `GET /api/game/academy/quiz` | ✓ | `{unlocked, questions:[{id, question, choices[]}]}` |
| 아카데미 제출 | `POST /api/game/academy/submit` body `{answers:{[id]: index}}` | ✓ | `{unlocked, results:[{id, correct, answer, explanation}]}` |
| 퀴즈 출제 | `GET /api/game/quiz/random` | ✓ | `{id, chart_snapshot:[{open,high,low,close,volume?}], time_limit_sec}`(가격 첫 종가=100 정규화, 날짜 없음) · 404 `NO_QUIZ_AVAILABLE`, 503 `FEATURE_DISABLED` |
| 퀴즈 제출 | `POST /api/game/quiz/{id}/submit` body `{choice:'UP'\|'DOWN'}` | ✓ | `{correct, answer, actual_change(Dec), pattern_type, explanation, rewarded, reward_cash:int, timed_out, ticker, base_date, streak\|null}` · 409 `QUIZ_NOT_SERVED/ALREADY_SUBMITTED` |
| Streak | `GET /api/game/streak/my` | ✓ | `{current_streak, highest_streak, last_activity_date\|null, enabled}` |

- 퀘스트/퀴즈 오류는 `detail: {code, message}` **객체**(6a 주문 오류는 대부분 문자열) → `lib/gameErrors.ts` 확장(§5).
- 퀴즈 판정은 **서버 시각 기준**(10초 + 유예 3초). 프론트 타이머는 연출.

## 4. 프론트 구조

```
web_client/src/
  components/ui/Modal.tsx            # 공용: 오버레이·ESC/바깥 클릭 닫기·role=dialog·aria-modal·제목, 모바일 하단 시트(sm 이상 중앙)
  types/game.ts                      # + LeaderboardRow, HallOfFameRow, Quest/RawQuest, Badge, QuestList, ClaimResult,
                                     #   AcademyQuiz, AcademySubmitResult, QuizQuestion, QuizCandle, QuizResult/RawQuizResult, Streak
  api/game.ts                        # + getLeaderboard, getHallOfFame, getQuests, claimQuest, getAcademyQuiz,
                                     #   submitAcademy, getRandomQuiz, submitQuiz, getMyStreak (Dec→number 변환 포함)
  lib/gameErrors.ts                  # + apiErrorCode(err), gameErrorMessage(err) (객체 detail 지원, code→문구)
  lib/quiz.ts                        # isQuizPrimeTime(now), quizSecondsLeft(startedAt, limit, now) 순수 함수
  store/tradingGame.ts               # + streak, quizDisabled, refreshStreak(), setAcademyUnlocked(), markQuizDisabled()
                                     #   (privateGen 가드 동일 적용, resetPrivate 시 초기화)
  components/game/
    LeaderboardModal.tsx  QuestModal.tsx  AcademyModal.tsx  ChartQuizModal.tsx  QuizMiniChart.tsx  QuizBanner.tsx
    GameHeader.tsx (수정)
  pages/GamePage.tsx (수정)          # activeModal 상태 관리·진입점 연결(OrderPanel.onLockedLeverage → 아카데미 모달)
```

- **모달 내부 데이터(목록·문항·퀴즈 진행)는 모달 로컬 state** — 열릴 때 로드, 닫히면 버림. 전역 스토어에는 화면 간 공유값만(streak·academyUnlocked·quizDisabled).
- 모달은 한 번에 하나(`activeModal: 'ranking' | 'quest' | 'academy' | 'quiz' | null`).

### 4.1 랭킹 모달
- 탭 `시즌 랭킹` / `명예의 전당`. 열릴 때 활성 탭만 로드.
- 시즌 랭킹: 순위·닉네임(없으면 "익명")·수익률(색)·승률. 로그인 유저 행 강조 — 리더보드 `user_id`와 `useAuthStore().user.id` 비교.
- 명예의 전당: 시즌별 그룹 헤더(`시즌 N`), 순위·닉네임·최종 수익률·승률·MBTI 칩(null이면 숨김).
- 빈 목록: "아직 순위가 없어요" / "아직 명예의 전당이 비어 있어요".

### 4.2 퀘스트 모달
- 각 퀘스트 카드: 제목·설명·진행 막대(`min(progress,target)/target`)·보상(`+₩500,000` 또는 `🏅 뱃지`)·상태 버튼(`진행 중` 비활성 / `보상 받기` / `받음 ✓`).
- 수령 성공 → 해당 카드 갱신 + 뱃지 목록에 추가(있으면) + 스토어 `refreshTrading()`(자본금 반영) + 토스트 "보상을 받았어요".
- 수령 실패 → `gameErrorMessage` 토스트.
- 하단 보유 뱃지 칩 목록(없으면 숨김).

### 4.3 아카데미 모달
- `unlocked`면 "🔓 5배 레버리지가 해금됐어요" 안내만.
- 미해금: 문항별 선택지(라디오) → 모든 문항 선택 시 `[제출]` 활성 → 결과 표시(문항별 ✅/❌·정답·해설). `unlocked=true`면 스토어 `setAcademyUnlocked(true)` + 토스트, 아니면 `[다시 도전]`(선택 초기화).

### 4.4 야간 퀴즈 모달 (단계: `intro → loading → playing → submitting → result`, 오류 시 `error`)
- intro: 규칙 안내(10초·정답 시 +₩200,000·보상은 하루 3회) + `[시작]`.
- playing: `QuizMiniChart`(lightweight-charts, 시간축 = 순번 1..N을 UTCTimestamp로, 가격축은 정규화 값, 시간축 라벨·크로스헤어 라벨 숨김) + 남은 초 카운트다운(`quizSecondsLeft`, 200ms 간격 갱신) + `[오를까? 📈]` `[내릴까? 📉]`.
- **0초 도달 시(미선택)**: 선택이 없으면 제출할 수 없으므로 서버에 제출하지 않고 로컬 `result`(시간 초과, 정답 미공개)로 전환해 `[다음 문제]`를 제공한다. 선택은 0초 전까지만 가능하며, 선택 즉시 제출한다(유예 3초는 네트워크 지연 흡수용).
- result(제출 응답): 정답/오답 큰 표기, `실제 5일 등락 +3.2%`, 패턴명, 해설, 공개 정보 `종목 005930 · 기준일 2026-03-14`, 보상 표기(`+₩200,000 지급` / `timed_out` → "시간 초과로 보상 없음" / 정답이나 `rewarded=false` → "오늘 보상 한도(3회)를 채웠어요"), 응답 `streak`이 있으면 스토어 반영. `[다음 문제]` `[닫기]`. 보상 지급 시 `refreshTrading()`.
- 오류: 404 `NO_QUIZ_AVAILABLE` → "준비된 문제를 모두 풀었어요"; 503 `FEATURE_DISABLED` → `markQuizDisabled()` + 모달 닫기 + 토스트; 그 외 `gameErrorMessage`.
- 언마운트/닫기 시 타이머 정리.

### 4.5 Streak
- `loadPrivate`에 `getMyStreak` 추가(실패 무시). 주문 성공 후 `refreshStreak()`(서버가 주문 시 touch). 퀴즈 제출 응답의 `streak`으로 갱신. 칩 `🔥 3일 연속`(title: `최고 기록 n일`).

## 5. 오류 문구 매핑 (`gameErrorMessage`)

| code | 문구 |
|---|---|
| `NO_QUIZ_AVAILABLE` | 준비된 문제를 모두 풀었어요 |
| `FEATURE_DISABLED` | 지금은 운영하지 않는 기능이에요 |
| `QUIZ_NOT_SERVED` · `ALREADY_SUBMITTED` | 이미 제출했거나 만료된 문제예요 |
| `QUEST_NOT_COMPLETED` | 아직 완료하지 않은 퀘스트예요 |
| `ALREADY_CLAIMED` | 이미 받은 보상이에요 |
| `NO_ACTIVE_SEASON` | 진행 중인 시즌이 없어요 |
| `PRICE_UNAVAILABLE` | 시세를 확인할 수 없어요. 잠시 후 다시 시도해 주세요 |
| `LEVERAGE_LOCKED` | 5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요(6a 그대로) |
| 기타 객체 detail | `detail.message`(문자열일 때) |
| 문자열 detail(403/404/409/422) | 그대로(6a 동작 유지) |

`orderErrorMessage`는 `gameErrorMessage`에 위임하되 6a의 문구·동작(401·422·네트워크)은 유지한다.

## 6. 검증

1. `npx tsc --noEmit` + `VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build`(GamePage 지연 청크 유지, 메인 청크 크기 증가 없음) + 번들 `localhost:800` 없음.
2. 순수 함수(`isQuizPrimeTime`·`quizSecondsLeft`·`gameErrorMessage`) 경계값 실행 확인(tsc 컴파일 후 node).
3. 브라우저 스모크(로컬 전용 스모크 DB·Redis DB 9, `TRADING_WINDOWS=00:00-23:59`):
   1. 랭킹: 비로그인 열람, 주문 후 내 행 강조, 명예의 전당(DB 행 삽입) MBTI 칩
   2. 퀘스트: Q1(손절 지정 주문 — UI에 손절 없음 → API 직접 호출로 완료) → `보상 받기` → 자본금 증가·상태 갱신
   3. 아카데미: 오답 제출 → 재도전, 정답 제출 → 5x 🔓 즉시 해금, 5x 주문 성공
   4. 퀴즈: 문제 DB 삽입(ClickHouse 터널 불가 시) → 결과·보상·Streak 칩, 시간 초과 경로, 문제 소진 문구
   5. 관리자 플래그 QUIZ 끄기 → 퀴즈 503 → 배너·버튼 숨김
   6. 장 마감 후/주말 배너(브라우저 시간 의존 — 순수 함수 확인으로 대체 가능)
   7. ESC/바깥 클릭 닫기, 모바일 폭, 콘솔 에러 없음

## 7. 산출물 / 문서

- web_client: §4 파일. README 게임 탭 설명에 모달 4종 한 줄 추가. ROADMAP 6b 체크.
