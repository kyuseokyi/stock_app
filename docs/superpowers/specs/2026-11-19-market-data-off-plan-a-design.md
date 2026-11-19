# A안 — 시세 비노출 무료 운영 전환 설계 (2026-11-19)

> 결정: 유료 시세 라이선스는 사지 않는다. **데이터 비용 0원 + 광고 유지(상업)**. 근거·출처별 가능 범위는 [`../../deploy/market-data-licensing.md`](../../deploy/market-data-licensing.md) 0·0-1절, 네이버 약관은 [`../../naver-search-api-terms-issue.md`](../../naver-search-api-terms-issue.md).
> 이 문서가 A안 작업의 **단일 목록**이다(ROADMAP·라이선스 문서는 여기를 가리킨다).
> 조사 기준 커밋: dev `5c18ebc`. 파일 경로는 저장소 루트 기준.

## 1. 목표와 원칙

1. **서버에서 막는다.** 시세 엔드포인트는 모두 인증 없는 공개 API다(GraphQL 전체, `/api/v1/market/*`, `/api/v1/ai/*`, `/api/v1/stocks/*/lending`, `/api/game/candles*`, `/api/game/market-status`, `/ws/game/stream`). 화면에서 숨겨도 API 가 KIS 데이터를 내주면 재배포다.
2. **기본은 닫힘(fail-closed).** 서버: 스위치 행이 없거나 DB 오류면 OFF. 클라이언트: 스위치 조회가 실패하면 숨김.
3. **지우지 않고 숨긴다.** 수집·계산·관리자 화면은 그대로(운영자 본인 이용). 나중에 라이선스를 사면 스위치만 켠다.
4. **개발 서버도 같다.** 개발 서버(haezean)·개발 APK·상용 테스트(preview) APK·Play 비공개 테스터는 모두 제3자다 → **개발·상용 모두 OFF**.
5. **일정: P1 을 Play 비공개 테스트(14일) 시작 전에 배포한다.** 테스트 빌드 자체가 위반이 되지 않게.

## 2. 스위치 설계

### 2-1. stock_api: `screener_features` 에 `market_data` 키 추가
기존 체계를 넓힌다(테이블 `screener_features`·서비스 `backend/apps/stock_api/services/screener_features.py` `KNOWN`·30초 캐시·관리자 `PUT /api/v1/admin/screener/features/{key}`·admin `ScreenerSettings.tsx`). 이미 웹·앱이 앱 시작 때 `screenerFeatures` 를 읽는다.

- `KNOWN` 에 `market_data` 추가, GraphQL `ScreenerFeatures` 타입(`backend/apps/stock_api/graphql/types.py`)에 `marketData: Boolean!`.
- 의미: **ON = 일반 사용자에게 시세 공개**, OFF(기본) = 비공개. 행 없음·오류 = OFF(기존 의미와 같음).
- 관리자 UI 문구: "사용자 시세 노출 — 켜려면 KRX/코스콤 라이선스 필요".
- 스크리너 탭 키(`stock_finder`·`finder`·`patterns`)는 별개로 두되, `market_data` OFF 면 서버가 스크리너 쿼리도 막으므로 탭도 숨긴다(클라이언트에서 `marketData && 탭키`).

### 2-2. 관리자 우회 (P1 필수)
`admin_web/src/api/stockClient.ts` 는 토큰을 보내지 않는다 → 막는 순간 **블로그 차트 삽입(`ChartSnapshotModal`)·퀴즈 관리(`TradingGameQuizzes`)·관리자 스크리너**가 깨진다.
- admin_web 의 stock GraphQL·REST 호출에 `Authorization: Bearer <관리자 토큰>` 추가.
- stock_api 에 "선택적 관리자 판별" 의존성(토큰이 있고 관리자면 통과, 없으면 일반 사용자) — 기존 `require_admin` 검증 로직 재사용.
- 판정: `market_data ON` **또는** 관리자 → 정상 응답. 그 외 → 차단 응답(2-3).

### 2-3. 차단 응답 모양 (설치된 옛 앱 대비)
현장에 깔린 개발·preview APK 는 새 스위치를 모른다. 차단이 **빈 화면은 되어도 앱이 죽으면 안 된다.**
- GraphQL: 해당 필드·리졸버가 **빈 목록 또는 null**(오류 아님). 예: `marketGroups` → `[]`, `getChartData` → 빈 캔들, `canslimScreen` → 빈 목록.
- REST(`/api/v1/market/*`, `/api/v1/ai/screener-analysis/*`, `/api/v1/stocks/*/lending`): **403 `{"detail":"market_data_disabled"}`**.
- 검증 단계에 "지금 설치된 preview APK 가 각 화면에서 어떻게 보이는지"를 넣는다(빈 섹션 OK, 크래시·무한 재시도 NG).

### 2-4. `marketOverview` 는 필드 단위로 막는다
홈 시장 참고·시장 탭 거시 카드가 같은 리졸버를 쓴다. 통째로 막으면 합법인 FRED 거시까지 사라진다.
- OFF 일 때 응답: **FRED 거시 지표 + ECOS 원/달러**만 채우고, KIS 국내 지수·미국 지수·미국 대표 종목·장중 Redis 값(`intraday_indices`)은 null/빈 목록.
- ECOS 는 아직 코드가 없다 → 수집기 신규(5절). **"30초 갱신" 문구는 환율에서 제거**(731Y001 은 일별).

### 2-5. trading_game: `game_feature_flags` 에 `REAL_MARKET` 키 추가
게임은 별도 서비스라 기존 `KNOWN_FLAGS=("QUIZ","STREAK")`(`backend/apps/trading_game/services/feature_flag_service.py`, 관리자 `TradingGameSettings.tsx`) 패턴을 따른다.
- 기본값을 키별로 둔다: 기존 QUIZ·STREAK 는 "행 없음 = ON" 유지, **`REAL_MARKET` 만 "행 없음 = OFF"**.
- `REAL_MARKET` OFF: `/ws/game/stream` 이 틱·심리를 발행하지 않음(연결은 받되 `market_disabled` 상태 1회 후 종료), `/api/game/candles*`·`/api/game/market-status` 403, 주문 API 403.
- `/api/game/seasons/active` 의 `features` 에 `realMarket` 추가 → 앱·웹이 게임 탭을 숨긴다.
- **QUIZ 도 OFF**: 퀴즈는 정규화·익명이지만 제출 뒤 `ticker`·`base_date`·`actual_change` 를 공개하므로 KRX 파생이다. 가상 시세 퀴즈는 P2.

## 3. 화면별 처리표

### 3-1. 홈
| 화면 | 지금 | P1 |
|---|---|---|
| 오늘 시장 참고 `mobile/src/features/home/home-market-strip.tsx`, 웹 `web_client/src/components/home/HomeMarketReference.tsx` | KOSPI·KOSDAQ·미국 지수·원/달러(KIS, 30초) | **원/달러(ECOS 731Y001, 전일)** + FRED 거시 1~2개(미 10년물·기준금리). 지수 칸 숨김. 출처 "한국은행 ECOS"·"FRED" 표기 |
| 내 펀드 카드 | 펀드 기준가 | 유지 |
| 옛 시황 요약(`home-summary` 등) | 미사용 | 그대로 미사용 |

### 3-2. 시장 탭 (`mobile/src/app/(tabs)/market.tsx`, 웹 `web_client/src/pages/market/*`)
| 섹션 | P1 |
|---|---|
| 지수 카드·스파크라인(`index-card`, `index-chip-card`, 웹 `IndexCards`) | 숨김 |
| 거시 카드(MacroCard, FRED) | **유지** |
| AI 브리핑(`brief-card`, 웹 `BriefCard`) | **유지 — 텍스트 전용.** 입력은 4절대로 교체 |
| 급등락(`movers-board`, `/movers`) | **숨김·서버 차단** — 가격·등락률 + 네이버 기반 AI 원인 |
| 수급 전광판(`flow-board`, `/investor-flow`) | 숨김·차단 |
| 특징주(`featured-board`, `/featured`) | 숨김·차단 |
| 핫 키워드(`hot-keywords`) | 숨김 |
| 테마·업종 칩, 상세 `app/market/[kind]/[id].tsx`, 웹 `GroupTab` | 숨김·차단 |
| 일정(`calendar-section`, 웹 `CalendarTab`) | **경제지표(FRED) 유지, 공모주 행 숨김**(출처 KIS 예탁원 `ksdinfo/pub-offer`) — 서버에서 `source='kis'` 제외. DART 기반 공모 일정은 P2 |

OFF 일 때 시장 탭 = "브리핑 + 거시 + 경제 일정". 칩 구성·탭 이름은 9절 결정.

### 3-3. 스크리너 탭 (주도주·조건검색·패턴)
- 사용자 탭 숨김, 서버 차단(빈 목록). 관리자만.
- 모바일 `/api/v1/ai/screener-analysis/{ticker}`(종목 AI 분석) 차단 — 입력에 네이버 뉴스.

### 3-4. 종목 상세 `/stock/[ticker]` (모바일 `mobile/src/app/stock/[ticker].tsx`, 웹 `web_client/src/pages/StockDetailPage.tsx`)
- P1: 일봉 차트·52주 고가·CANSLIM 점수·대차잔고·패턴 숨김. 남는 것: 종목명·코드 + **"시세는 증권사 앱에서" 링크아웃** 버튼.
- `searchStocks` 응답에 가격 필드가 없는지 확인(있으면 OFF 일 때 제거).
- P2: **DART 기반 종목 화면** — 기업개황(업종·설립·상장일), 재무 요약(매출·영업이익·순이익, 연·분기), 최근 공시 목록, 최대주주·지분 변동.

### 3-5. 게임
- P1: 게임 탭 숨김(`realMarket` false), 서버 차단(2-5), QUIZ OFF.
- P2: **가상 종목 게임** — 합성 시세 생성기(무작위 보행 + 변동성 국면 + 패턴 템플릿), 가상 종목명, 기존 주문·랭킹·시즌 로직 재사용. 가상 시세 퀴즈.

### 3-6. 블로그
- 새 차트 삽입: `market_data` OFF 면 admin `ChartSnapshotModal` 비활성 + 안내 문구.
- **기존 글의 PNG 차트는 스위치로 못 끈다**(본문 HTML 에 `data:image/png` 로 박혀 있음) → 관리자 점검: 차트 포함 글 목록 조회 → 이미지 제거 또는 비공개.

## 4. 네이버 뉴스 약관 대응 (P1 — 광고가 있는 A안이라 필수)
네이버 검색 API(2026-09-07 개정)는 **AI 입력·요약·저장·광고 화면 노출**을 금지한다.

| 기능 | 파일 | P1 |
|---|---|---|
| 모닝 브리핑 | `backend/apps/ai_analyst/services/morning_brief.py` | 프롬프트에서 네이버 뉴스 제거. 대체 입력: **DART 주요 공시**(전일), **정책브리핑 보도자료 제목**(공공누리 1유형 — 가공 허용), **FRED·ECOS 지표**, KIS 지수 등락률(내부 입력 — 출력은 문장 인용 수준). 출력은 지금처럼 텍스트 전용, `sources` 는 DART·정책브리핑 링크 |
| 급등락 원인 | `backend/apps/ai_analyst/services/market_movers.py` | 화면이 없어지므로 **생성 중단**(스케줄 끔). 관리자용이 필요하면 뉴스 없이 |
| 종목 정성 분석 | `backend/apps/ai_analyst/services/stock_qualitative.py` | 사용자 노출 중단(3-3). 관리자용은 뉴스 입력 제거 |
| 참고 기사 목록(R3) | 브리핑·급등락 | P1 에서는 네이버 결과를 빼고 DART·정책브리핑 링크로 대체. 네이버 결과를 다시 쓰려면 **가공·저장 없이, 광고 없는 화면에서**, 네이버 BI 표시 |
| AI 결과 캐시 | `backend/apps/ai_analyst/cache.py` | 뉴스 원문 필드가 저장되는지 확인 → 있으면 제거 |

## 5. 새로 필요한 것

| 항목 | 내용 | 누가 |
|---|---|---|
| ECOS 인증키 | 무료 발급(ecos.bok.or.kr) → 서버 env `ECOS_API_KEY` | **사용자** |
| ECOS 수집기 | `backend/apps/collector/ecos.py`(신규): 731Y001 원/달러 매매기준율 일별 → OFF 일 때 노출하는 `FX:USDKRW` 를 ECOS 값으로. 출처 문구 "출처: 한국은행 경제통계시스템(ECOS)" | Claude |
| 정책브리핑 수집 | 보도자료 목록 주소 확인 필요(11-18 실측 때 RSS 404) → 제목·링크·부처·일시만 | Claude(P1 은 브리핑 입력용 최소 범위) |
| DART | 키 이미 있음(서버 등록 완료). 전일 주요 공시 조회 함수 | Claude |

## 6. 작업 순서

### P1 — Play 비공개 테스트 전 필수
1. ✅ (2026-11-19, `feature/market-data-switch`) stock_api 스위치(`MARKET_DATA`)·관리자 우회·리졸버/라우터 차단·`marketOverview` 필드 단위 차단 + 테스트
   - **+ 회원별 시세 열람 권한**(사용자 요청 — 운영자 본인이 앱에서 보기): `users.market_data_access`(마이그레이션 `a7c9e1b3d5f8`),
     관리자 API `PATCH /api/v1/admin/users/{id}/market-data-access`(blog), admin 회원 관리 화면 토글·경고 문구. 관리자는 항상 허용.
   - 판정: `backend/apps/stock_api/services/market_access.py` — 스위치 ON **또는** 관리자 **또는** 열람 권한 회원. 토큰 만료·무효는 401 이 아니라 익명(차단).
   - `screenerFeatures.marketData` = **요청자 기준** 열람 가능 여부(5번 화면 숨김이 이 값을 쓴다. 로그인·로그아웃 뒤 다시 읽어야 함).
     전역 스위치 값은 관리자 REST `/api/v1/admin/screener/features` 로 본다.
   - 차단 범위 밖(남은 일): trading_game(3번), 화면 숨김(5번), ECOS(4번) — OFF 일 때 marketOverview 지수 칸은 ECOS 전까지 빈 목록.
   - web_client·mobile 도 로그인 상태면 stock GraphQL·시세 REST 에 토큰을 붙인다(권한 회원이 앱·웹에서 보도록).
2. ✅ admin_web 토큰 첨부(stockClient·REST), 관리자 UI 스위치 문구, 블로그 차트 모달 비활성(2026-11-19, `feature/game-real-market-flag`)
   - `RichTextEditor` "차트 삽입" 버튼: 전역 `MARKET_DATA`(관리자 REST `/api/v1/admin/screener/features`)가 꺼져 있거나 조회 실패면 비활성 + 안내.
     요청자 기준 `screenerFeatures.marketData` 는 관리자에게 항상 true 라 쓰지 않는다. 기존 글 차트는 7번.
3. ✅ (2026-11-19, `feature/game-real-market-flag`) trading_game `REAL_MARKET` 플래그·WS/캔들/상태/주문 차단 + 테스트, QUIZ OFF
   - 판정 공유: `backend/shared/market_viewer.py`(`user_can_view`·`load_viewer`) — stock_api `market_access` 와 같은 규칙.
     게임 판정 `backend/apps/trading_game/services/real_market.py`: 플래그 ON **또는** 관리자 **또는** `market_data_access` 회원. 토큰 선택, 실패 = 익명.
   - 기본값 키별(`feature_flag_service.DEFAULTS`): QUIZ·STREAK 행 없음 = ON 유지, REAL_MARKET 행 없음·조회 오류 = OFF. 마이그레이션 없음.
   - OFF+미허용: `/api/game/candles`·`/candles/session`·`/market-status` 403 `market_data_disabled`, `POST /orders`·`/positions/{id}/close` 403(로그인 401 이 먼저),
     `GET /positions/active` 는 수익률·손익을 비움(null), 퀴즈 `random`·`submit` 503 `FEATURE_DISABLED`(QUIZ OFF 와 같은 모양).
   - `seasons/active` 의 `features.real_market`(게임 API 는 snake_case — 설계의 `realMarket`) = 요청자 기준, `features.quiz` 도 같은 판정을 통과해야 true.
   - WS: 구독 등록 없이 `{"type":"market_disabled"}` 1회 → `GAME_WS_DISABLED_HOLD_SEC`(600초) 유휴 → 4429 `MARKET_DISABLED`.
     **바로 닫지 않는 이유**: 설치된 앱은 연결이 열리면 재연결 간격을 1초로 되돌리고 캔들·계좌를 재조회 → 즉시 종료면 1초 무한 재연결. 4429 는 긴 간격 재시도 코드.
     무효·만료 토큰은 지금처럼 4401. 플래그를 끈 순간 이미 붙어 있던 스트림은 재연결 전까지 계속 받는다.
   - 관리자 UI: admin `TradingGameSettings` 에 "📈 실제 시세 게임 공개"(켜려면 KRX/코스콤 라이선스 필요, 켤 때 확인창).
   - 남은 위험(범위 밖): `coach/today` 지지·저항 가격, `accounts/me` 총자산(손익 반영), 리더보드·내 순위 ROI(가격 움직임 간접 노출) — 5번 화면 숨김 때 함께 판단.
   - 배포 주의: OFF 동안 일반 회원은 보유 포지션을 **수동 청산할 수 없다**(자동청산·시즌 정산으로만 닫힘). 5번 전에 배포하면 설치된 앱은 게임 탭이 보인 채 빈 차트·주문 오류.
4. ECOS 수집기 + 홈 시장 참고 교체(모바일·웹)
5. ✅ (2026-11-19, `feature/market-ui-hide`) 앱·웹 화면 숨김(시장 탭·스크리너·종목 상세·게임 탭·일정 공모주) + 종목 상세 링크아웃, `searchStocks` 가격 필드 확인
   - **원칙(사용자 요청)**: 권한이 없으면 빈 칸·빈 차트가 아니라 **섹션·탭 자체를 그리지 않는다**. 권한 있는 사용자(관리자·열람 권한 회원·스위치 ON)는 지금과 같다. 컴포넌트·파일은 지우지 않고 렌더 조건만.
   - **국내 지수 공개 스위치 `MARKET_INDEX_KR`**(사용자 요청 "한국 것도 같이"): `screener_features` 새 키, 기본 OFF(행 없음·DB 오류 = OFF), 마이그레이션 없음.
     ON 이면 `MARKET_DATA` 가 꺼져 있어도 익명·일반 회원에게 `marketOverview` 의 **코스피·코스닥(`KR:0001`·`KR:1001`, 장중 값 포함)만** 준다. 코스피200·미국 지수·원/달러·개별 종목·업종·테마는 계속 막힌다.
     판정 `shared/market_viewer.kr_index_visible`·`KR_PUBLIC_INDEX_CODES`, `market_access.context_kr_index_allowed`. GraphQL `screenerFeatures.marketIndexKr`(요청자 기준).
     관리자 화면: 스크리너 설정의 시세 스위치 아래 "국내 지수 공개(코스피·코스닥)" + 경고·확인창.
   - **클라이언트 판단값**: `screenerFeatures { marketData marketIndexKr }`(웹 `useScreenerFeatures`, 앱 `useScreenerFeaturesState`)와 게임 `seasons/active` 의 `features.real_market`(웹 `hooks/useGameAccess`, 앱 `features/market-access/use-game-access`).
     로그인 사용자(웹은 토큰, 앱은 user id)가 바뀌면 이전 값을 먼저 버리고 다시 묻는다(관리자 true 가 로그아웃 뒤 남지 않게). 모름·실패·시즌 없음 = 숨김. 순수 판정은 웹 `lib/marketAccess.ts`·앱 `features/market-access/access.ts`(+ 테스트).
   - 화면별 결과:
     - 홈 오늘 시장 참고: 시세 열람이면 지금과 같고, 아니면 국내 지수 공개일 때 코스피·코스닥만. 볼 지수가 없으면 섹션째 숨김(요청도 안 함). 홈 게임 교육 카드도 게임 판단값으로 숨김.
       미국 거시(FRED)·ECOS 환율 카드는 4번에서 홈에 추가한다(지금 홈에는 지수만 있었다).
     - 시장 탭: 테마·업종 칩/탭 숨김(직접 진입 시 웹은 개요로, 앱 상세 딥링크는 안내), 개요의 급등락·수급 전광판·특징주는 **요청 없이**(웹 `useMarketSection` enabled, 앱 `useRestResource` enabled) 섹션째 숨김, 핫 키워드·주도 테마 숨김.
       남는 것 = AI 브리핑(텍스트) · 지수(국내 지수 공개 시 코스피·코스닥) · 미국 거시(돈의 흐름 금리·미국 경제지표, FRED) · 다가오는 일정(공모주는 서버가 뺌). 탭 이름·구성은 9절 결정 전이라 그대로.
     - 스크리너 탭: `stockFinder && marketData` 일 때만(직접 진입은 시장으로).
     - 종목 상세: 시세 열람 불가면 차트·종가·52주·패턴·대차를 요청하지 않고 종목명·코드 + "시세는 증권사 앱에서 ↗" 링크아웃(네이버 증권 모바일 종목 화면 `m.stock.naver.com/domestic/stock/{코드}/total` — 링크만, 내용 수집 없음).
     - 게임: `real_market` 거짓이면 앱 하단 탭·웹 메뉴·내정보 게임 줄 숨김. 직접 진입하면 안내 카드 — 게임 화면을 마운트하지 않아 WS·403 요청이 생기지 않는다.
       활성 시즌이 없으면 판단값이 없어 관리자에게도 게임 탭이 숨는다(fail-closed, 이전에는 "시즌 준비 중" 탭이 보였음).
   - `searchStocks` 응답 필드는 `symbol·name·market·country·currency` — 가격 필드 없음(변경 불필요).
   - 3번의 남은 위험(`coach/today` 지지·저항, `accounts/me` 총자산, 리더보드·순위 ROI): 이 API 들은 게임 화면 안에서만 부른다 → 게임 화면을 마운트하지 않으므로
     클라이언트 노출 없음. 서버 응답 자체는 그대로(범위 밖 — 직접 호출하면 받을 수 있음).
   - 지수 카드(홈·시장 탭)는 눌러도 차트로 가지 않는다(홈은 시장 탭으로, 시장 탭 카드는 이동 없음) → 국내 지수 공개 때 빈 차트 경로 없음.
   - 배포 순서: **백엔드 먼저**. 새 웹·앱이 옛 서버에 붙으면 `marketIndexKr` 를 모르는 스키마라 `screenerFeatures` 쿼리 전체가 실패 → fail-closed 로 관리자에게도 시세 화면이 숨는다.
   - 확인 체크(**Play 비공개 테스트 전 필수**):
     - [ ] 관리자 스크리너 설정에서 `MARKET_INDEX_KR`(국내 지수 공개) **OFF** 확인
     - [ ] 관리자 스크리너 설정에서 `MARKET_DATA`(사용자 시세 노출) **OFF** 확인
     - [ ] 관리자 게임 설정에서 `REAL_MARKET`(실제 시세 게임 공개) **OFF** 확인
     - [ ] 익명(비로그인)으로 웹·앱: 홈 시장 참고 섹션 없음, 시장 탭 = 브리핑·거시·일정만, 스크리너·게임 탭 없음, 종목 상세 = 이름·코드·링크아웃
     - [ ] 시세 열람 권한 계정으로 로그인: 지금과 같이 전부 보임 → 로그아웃 시 다시 숨김
6. ✅ (2026-11-19, `fix/naver-news-ai-input`) 네이버 뉴스 AI 입력 제거(브리핑 입력 교체, 급등락 생성 중단, 정성 분석 노출 중단)
   - 세 서비스(`morning_brief`·`market_movers`·`stock_qualitative`)에서 네이버 클라이언트 호출 경로를 끊었다. 프롬프트 빌더는 뉴스 인자를 받지 않는다.
     `clients/naver_news.py` 는 지우지 않고 재사용 조건(가공·저장 없이, 광고 없는 화면, 네이버 BI 표시) 주석만.
   - 모닝·주간 브리핑: 지수 등락·FRED 거시만 입력. 근거 기사(`sources`)는 저장·응답 모두 `[]`.
     DART 는 이번에 넣지 않았다 — `OpenDartClient` 는 종목(corp_code) 단위 조회만 있고, 전일 시장 전체 공시는 새 조회 메서드·"주요" 선정 기준·
     화면 라벨("참고 기사" → 공시) 변경이 필요해 범위 밖(P2 "브리핑 입력 고도화").
   - 급등락 원인·핫 키워드: **생성 중단**(기본 꺼짐 `MOVER_REASONS_ENABLED`·`HOT_KEYWORDS_ENABLED`). 등락률 순위 행에는 수급·테마 필드가 없어
     "수급·테마 기반 추정" 이라 적으면 사실이 아니고, 모델이 자기 지식으로 원인을 지어내게 된다. 순위 목록(2분)은 그대로.
     꺼져 있으면 옛 캐시의 원인·근거 기사·키워드도 응답에서 뺀다. 켜도 뉴스 없이 시세만 넣고 '추정'·신뢰도 하로 쓰게 프롬프트를 바꿔 두었다.
   - 종목 정성 분석: 뉴스 입력 제거(DART 공시·재무 추이·CANSLIM 만). `sources` `[]`, 옛 PG 행의 근거 기사도 응답에서 뺀다.
   - 화면: 참고 기사·핫 키워드는 빈 배열이면 이미 숨겨진다. 원인이 없을 때 급등락 제목을 "급등락" 으로(앱·웹), 웹 "AI 분석은 참고용" 안내도 숨김.
   - 배포 후 정리(운영 작업, 삭제는 사용자 확인 뒤): PG `ai_daily_briefings.sources`·`ai_stock_evaluations.sources` 에 옛 뉴스 제목·링크가 남아 있다(TTL 없음, 응답에서는 이미 뺌).
     Redis `ai:market:movers:reasons`(24시간)·`ai:market:keywords:today`(30분)·`ai:market:keywords:last`(4일)·`ai:market:movers:last`(4일, 2분마다 원인 없이 다시 쓰임)·`ai:market:movers:today`(5분)는 TTL 로 사라진다.
7. 블로그 기존 글 차트 점검(관리자 조회) — 정리는 사용자
8. 개발 배포 → 검증(7절) → OTA(dev·preview) → 상용 배포는 사용자 요청 시

### P2 — 출시 뒤 콘텐츠 보강
- DART 기반 종목 화면, DART 공모 일정, 정책 이슈 카드, 가상 종목 게임·퀴즈, 브리핑 입력 고도화

### P3 — 선택
- 사용자 본인 KIS 키(BYOK) 실험, 테마 분류를 운영자 자체 분류로 전환(KIS·키움 테마 원천 제거)

## 7. 테스트와 검증

**백엔드 테스트**(stock_api·trading_game 둘 다):
- 스위치 OFF + 토큰 없음 → GraphQL 빈 값 / REST 403 `market_data_disabled`
- 스위치 OFF + 관리자 토큰 → 정상
- 스위치 OFF + 일반 사용자 토큰 → 차단
- 스위치 ON → 정상
- `marketOverview` OFF: 거시·ECOS 환율만 채워지고 지수·미국 종목·장중 값은 비어 있음
- 스위치 행 없음·DB 오류 → OFF 로 동작
- `REAL_MARKET` OFF: WS 틱 미발행, candles·market-status·orders 403, `seasons/active.features.realMarket=false`

**배포 후 개발 서버 확인(curl 체크리스트)**: GraphQL `marketGroups`·`getChartData`·`canslimScreen` 빈 값, `/api/v1/market/movers`·`/investor-flow`·`/featured`·`/api/v1/stocks/005930/lending` 403, `/api/game/candles` 403, `screenerFeatures.marketData=false`, 관리자 토큰으로 같은 호출이 정상.

**설치된 앱 확인**: 지금 깔린 preview APK·개발 APK 가 각 화면에서 빈 섹션으로 보이는지(크래시·무한 로딩 없음) → 그다음 OTA 로 새 화면.

**사용자 단계**: ECOS 키 발급·등록, 배포 승인, 관리자 화면에서 스위치 OFF 확인(기본 OFF 라 행이 없으면 자동), QUIZ OFF, 블로그 차트 글 정리.

## 8. 이 설계가 바꾸지 않는 것
- 수집·계산 파이프라인(KIS·키움 수집, ClickHouse 적재, 주도주·패턴 계산, 장중 지수 Redis) — 운영자 본인 이용으로 계속
- 관리자 웹 전체 기능
- 내 펀드, 게시판·댓글, 인증, 광고 설정
- 스위치를 켜면 지금과 똑같이 돌아온다(라이선스 구매 시)

## 9. 남은 결정
- 시장 탭 OFF 상태의 이름·구성("시황" 한 화면으로 합칠지)
- 홈 시장 참고에 FRED 지표 몇 개를 둘지
- 개발 서버에서 게임 실측(장중 테스트)이 필요할 때 방법 — 관리자 계정으로만 WS 허용하는 옵션(P1 범위 밖, 필요 시 추가)
