# 트레이딩 게임 서브페이즈 6a — web_client 트레이딩 코어 화면 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨 · 단계 프롬프트: `docs/prompts/trading_game/06_phase6_frontend_ui.md`
> 서브페이즈 6 분할(사용자 승인): **6a** web 트레이딩 코어 → **6b** web 모달(랭킹/명예의전당·퀘스트·아카데미·야간 퀴즈·Streak) → **6c** 모바일 동일 기능. 지인 리그는 백엔드 부재로 백로그.
> 선행: 백엔드 Phase 1~5b(trading_game 8003), web_client strict TS 전환(2026-10-13).

## 1. 목표 / 범위

`web_client`의 `/game`("시즌 준비 중" 스켈레톤)을 실시간 트레이딩 화면으로 교체한다. 와이어프레임(`06_phase6_frontend_ui.md` §1)의 위→아래 순서:

1. **헤더**: `[시즌 N기] 종목명 (티커) | 종료 D-n` · 내 순위 `n위 / ±x.x%` · 자본금(total_asset)
2. **오늘의 코치 배너**: `summary_nudge` 한 줄 + 펼치면 `title`·`content_md`(텍스트로 표시, 마크다운 렌더 없음)
3. **시장 심리 바**: `🔴 Long x% | 🔵 Short y%`(둘 다 0이면 "아직 포지션이 없어요")
4. **실시간 차트**: 일봉 + 오늘 캔들 실시간 갱신, 지지/저항/진입가 라인
5. **포지션 카드**(보유 시): `LONG/SHORT xN배` · 평가손익(₩, %) · 진입가/현재가 · `[즉시 전액 청산하기]`
6. **주문 패널**: 비중 칩 25/50/100% · 배율 칩 1x/2x/5x(미해금 시 🔒) · `[🔴 BUY (상승 베팅)]` `[🔵 SELL (하락 베팅)]`
7. **넛지 토스트**: 주문/청산 응답의 `nudges` + WS `nudge`

**6a 범위 밖(자리만)**: 헤더의 `[🏆 랭킹] [🎯 퀘스트]` 버튼은 렌더하되 비활성("곧 열려요" title) — 6b에서 연결. 지인리그 버튼은 넣지 않음. 5x 🔒 클릭 시 6a는 안내 토스트만(아카데미 모달은 6b). 야간 퀴즈 배너는 6b.

**불변**: 커뮤니티(게시판/댓글/알림) 동작·레이아웃 무변경. `/game` 외 라우트 무변경.

## 2. 백엔드 추가 (최소)

- `GET /api/game/seasons/active` (공개, 인증 불필요) → `SeasonOption | null`
  - 필드: `id, season_number, ticker, stock_name, status, start_at, end_at`(기존 `SeasonOption` DTO 재사용).
  - 기준: `account_service.get_active_season(db)`(기존 함수). 없으면 `null`(200).
- 테스트: 활성 시즌 있음/없음 2케이스(`backend/tests/`). 그 외 백엔드 변경 없음.

## 3. 백엔드 계약 요약 (프론트 타입의 출처)

| 용도 | 엔드포인트 | 인증 | 비고 |
|---|---|---|---|
| 활성 시즌 | `GET /api/game/seasons/active` | ✗ | §2 신규 |
| 계좌 | `GET /api/game/accounts/me?season_id=` | ✓ | 미보유 시 초기자본 기본값 |
| 보유 포지션 | `GET /api/game/positions/active?season_id=` | ✓ | 최대 1개(ALREADY_OPEN 규칙) |
| 주문 | `POST /api/game/orders` | ✓ | body `{season_id, side: LONG\|SHORT, ratio: 0.25\|0.5\|1.0, leverage: 1\|2\|5}` → `OrderResultResponse`(+`nudges`) |
| 청산 | `POST /api/game/positions/{id}/close` | ✓ | `OrderResultResponse`(+`nudges`) |
| 내 순위 | `GET /api/game/seasons/{id}/my-rank` | ✓ | `{rank, roi_pct, percentile, total}`(rank·roi_pct null 가능, 숫자) |
| 코치 | `GET /api/game/coach/today` | ✓ | `active`(evening 우선) 사용 |
| 아카데미 해금 | `GET /api/game/academy/quiz` | ✓ | `unlocked`만 사용(문항은 6b) |
| 일봉 | stock_api GraphQL `getChartData(symbol, startDate, endDate){ candles{date open high low close volume} }` | ✗ | 시작일 = 오늘−180일, 종료일 = 오늘 |
| 실시간 | `WS /ws/game/stream?token=<JWT>` | ✓ | 4401 = 인증 실패 |

- **금액 직렬화**: pydantic v2는 `Decimal`을 JSON **문자열**로 보낸다(`"12450000.00"`). `api/game.ts`에서 `Number()`로 변환해 UI는 number만 다룬다. `roi_pct`·`pnl_amount`·`stop_loss_price`·`take_profit_price`는 `null` 가능.
- **WS 메시지(서버→클라)**:
  - `tick {ticker, price, timestamp}` — 브로드캐스트
  - `position_pnl {position_id, roi_pct, pnl_amount}` — 개인(숫자)
  - `sentiment {long_pct, short_pct}` — 5초 주기 브로드캐스트
  - `nudge {position_id, nudge:{type, code, message}}` — 자동청산(손절/익절/마진콜) 시 개인
  - `coach {season_id, coach_type, target_date, title, summary_nudge, support_price, resistance_price}` — 발행 시(가격은 문자열|null)
  - 클라는 keep-alive로 주기적 텍스트 전송(서버는 수신 무시).

## 4. 프론트 구조 (UI ↔ 상태/통신 분리)

```
web_client/src/
  types/game.ts             # DTO(원시: 문자열 금액) + 변환 후 도메인 타입 + WS 메시지 판별 유니온
  api/gameClient.ts         # axios 인스턴스(GAME_API_URL, Bearer 인터셉터 — 기존 client.ts 패턴)
  api/game.ts               # REST 함수 + 문자열→number 변환
  api/stock.ts              # getDailyCandles(ticker) — GraphQL POST(axios, 신규 의존성 없음)
  lib/gameWs.ts             # WS 메시지 파싱(unknown → 판별 유니온, 알 수 없는 type은 null)
  lib/format.ts             # ₩ 금액·% 포맷, D-day 계산(순수 함수)
  lib/candles.ts            # 오늘 캔들 병합(순수 함수)
  store/tradingGame.ts      # zustand: season, account, position, lastPrice, sentiment, coach, myRank,
                            #          academyUnlocked, nudges(토스트 큐), status + 액션(loadAll, placeOrder, closePosition)
  hooks/useGameWebSocket.ts # 연결/재연결/keep-alive, 메시지 → store 반영
  components/game/
    GameHeader.tsx  CoachBanner.tsx  SentimentBar.tsx  TradingChart.tsx
    ActivePositionCard.tsx  OrderPanel.tsx  NudgeToaster.tsx
  pages/GamePage.tsx        # 조립 + 상태별 분기(미연결/시즌없음/로딩/정상)
```

### 4.1 차트 (`TradingChart.tsx`)
- 라이브러리: **`lightweight-charts`** v4(TradingView, 자체 TS 타입 동봉). 캔들 시리즈 1개.
- 데이터: 마운트 시 `getDailyCandles` → `setData`. 틱 수신 시 **오늘 캔들**(KST 날짜) `series.update()`:
  - 마지막 캔들이 오늘이 아님 → `{open=high=low=close=price}` 신규, 오늘이면 → `high=max, low=min, close=price`.
- 가격선(`createPriceLine`): 지지선(보라 `#8b5cf6`, 점선, 라벨 `지지`), 저항선(주황 `#f59e0b`, 점선, 라벨 `저항`), 진입가(LONG 빨강/SHORT 파랑, 실선, 라벨 `진입`). 값 변경 시 제거 후 재생성.
- 캔들 색: 상승=빨강(`#f04452`)/하락=파랑(`#3182f6`) — Tailwind 토큰과 동일. `autoSize: true`.
- 일봉 조회 실패/빈 응답 → 차트 영역에 "차트 데이터를 불러오지 못했어요"(주문 등 나머지는 동작).

### 4.2 WebSocket (`useGameWebSocket`)
- 로그인 토큰이 있을 때만 연결(`GAME_API_URL`의 `http`→`ws` 치환 + `/ws/game/stream?token=`).
- 재연결: 지수 백오프 1→2→4…최대 30초. 종료 코드 **4401이면 재연결 안 함**(토큰은 지우지 않음 — 다른 서비스와 공유. 재로그인 안내만).
- keep-alive: 25초마다 `"ping"` 전송. 언마운트/로그아웃 시 정리.
- `tick`(시즌 티커 일치 시) → lastPrice·차트 갱신. `position_pnl`(보유 포지션 id 일치) → 카드 갱신. `sentiment`·`coach`(현재 시즌) 반영. `nudge` → 토스트 + `positions/accounts/my-rank` 재조회(자동청산 반영).
- 비로그인: WS 미연결 → 틱·심리 없음. "로그인하면 실시간 시세와 주문이 열려요" 안내 + 차트(일봉)는 표시.

### 4.3 주문/청산 흐름
- 주문: 비중(기본 25%)·배율(기본 1x) 선택 → BUY=`LONG`, SELL=`SHORT`. 처리 중 버튼 비활성(중복 체결 방지). 성공 시 응답으로 position 설정 + 응답 `nudges` 토스트 + `accounts/me`·`my-rank` 재조회.
- 보유 포지션이 있으면 BUY/SELL 비활성("보유 포지션을 먼저 청산하세요").
- 5x 미해금(`academyUnlocked=false`): 🔒 표시, 클릭 시 선택되지 않고 안내 토스트(6b에서 모달로 교체).
- 청산: `[즉시 전액 청산하기]` → close API(확인 다이얼로그 없음 — 원클릭 컨셉) → position 해제 + nudges 토스트 + 재조회.
- 비로그인 상태에서 BUY/SELL 클릭 → 기존 `LoginModal` 오픈.

### 4.4 오류 → 사용자 문구 (토스트)
| 응답 | 문구 |
|---|---|
| 403 `detail.code=LEVERAGE_LOCKED` | 5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요 |
| 409 | 서버 `detail` 문자열 그대로(이미 한국어: 거래 시간 아님/시세 중단/이미 보유/시즌 아님 등) |
| 422 | detail이 문자열이면 그대로, 아니면 "주문 조건이 올바르지 않아요" |
| 401 | 로그인이 만료되었어요. 다시 로그인해 주세요 |
| 503·네트워크 | 게임 서버에 연결할 수 없어요 |

### 4.5 화면 상태
1. `GAME_API_URL` 미설정(운영 빌드) → "시즌을 준비하고 있어요" EmptyState(기존 스켈레톤 문구 그대로).
2. 서버 연결 실패 → "게임 서버에 연결할 수 없어요" + 다시 시도 버튼.
3. 활성 시즌 `null` → 기존 "시즌을 준비하고 있어요" EmptyState.
4. 정상 → 트레이딩 화면.

## 5. 환경 변수 / 설정

- `VITE_GAME_API_URL`(trading_game), `VITE_STOCK_API_URL`(stock_api GraphQL)은 **선택 변수**. `config.ts`에서 dev(serve)는 `http://localhost:8003`·`http://localhost:8002/graphql`로 폴백, 배포 빌드에서 미설정이면 `undefined`(빌드 실패시키지 않음 — trading_game 운영 배포 전이므로 `vite.config.js` REQUIRED에 넣지 않는다. admin_web의 `GAME_API_URL`과 동일 정책).
- `STOCK_API_URL` 미설정 시 차트만 "차트 데이터를 불러오지 못했어요".
- `vite-env.d.ts`에 두 키 추가. README 환경변수 표에 추가.
- 신규 의존성: `lightweight-charts`(dependencies, v4 고정 범위). `package-lock.json` 함께 커밋.

## 6. 레이아웃 / 디자인

- 토스 라이트 스타일, 기존 토큰(`brand/up/down/ink/surface/line`, `rounded-card/btn/field`)과 `components/ui`(Card·Button·Chip) 재사용.
- `Layout`의 `max-w-3xl` 컨테이너 안에서 세로 스택. 모바일 폭(390px)에서 가로 스크롤 없음. 차트 높이 320px(sm 미만 260px).
- 손익 색: 양수 `text-up`(빨강), 음수 `text-down`(파랑), 0 `text-ink`. 틱마다 숫자 갱신(CSS transition 수준, 애니메이션 라이브러리 없음).

## 7. 검증

1. **백엔드**: 신규 엔드포인트 테스트 + 전체 `pytest` 통과(기존 226개 회귀 없음).
2. **web_client**: `npx tsc --noEmit` + `VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build`(게임/주식 URL 미설정 빌드도 성공해야 함) + 번들에 `localhost:800` 없음.
3. **순수 함수**: `lib/gameWs.ts`·`lib/format.ts`·`lib/candles.ts`는 순수 함수로 분리(테스트 러너 미도입 — 리뷰에서 경계값 점검).
4. **브라우저 스모크**(로컬): auth(8001)·blog(8000)·stock_api(8002)·trading_game(8003) + 로컬 docker PG(마이그레이션 최신화한 별도 스모크 DB)/Redis. 시즌 시드 후 Redis `stock:tick:<ticker>` 틱 발행 + 최신가 키 갱신으로 시세 시뮬레이션. 체크:
   1. 시즌 없음 → 준비 중 화면 / 시즌 있음 → 헤더(시즌·D-day·자본금)
   2. 일봉 차트 렌더 + 틱 발행 시 오늘 캔들 갱신
   3. 코치 발행 → 배너 + 지지/저항 라인
   4. 심리 바 갱신
   5. BUY 25% 1x → 포지션 카드·진입가 라인·넛지 토스트 → 틱에 따라 손익 갱신 → 청산
   6. 5x 🔒 안내, 비로그인 주문 → 로그인 모달
   7. 모바일 폭 레이아웃, 콘솔 에러 없음
   - 거래 시간 창(`market_clock`) 밖이면 주문이 409이므로, 스모크 방법(창 설정 env 또는 장중 수행)은 계획에서 확정한다.

## 8. 산출물 / 문서

- 백엔드: 시즌 엔드포인트 + 테스트.
- web_client: §4 파일들, `config.ts`·`vite-env.d.ts`·`package.json`/lock 수정, `GamePage.tsx` 교체.
- README: web_client 게임 화면 실행법(필요 서비스 8000/8001/8002/8003), 신규 VITE 변수.
- ROADMAP: 서브페이즈 6을 6a/6b/6c로 분할 기록, 6a 완료 체크. 백로그에 "지인 리그(백엔드+UI)" 추가.

## 9. 이후

6b(web 모달) → 6c(모바일). trading_game 운영 배포(포트 재배정)는 별도 백로그 유지.
