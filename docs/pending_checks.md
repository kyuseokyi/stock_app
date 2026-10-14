# 확인해야 할 것 · 주의할 점

> 2026-10-13 기준. 확인을 마치면 `[x]` 로 바꾸고, 문제가 있으면 옆에 메모를 남긴다.

## 1. 장중에 실제 시세로 확인 (개발 서버 `game_ws`)
- [ ] 모의투자(`KIS_MODE=vps`)에서 통합 실시간 시세(`H0UNCNT0`) 구독이 되는지 — 로그에 `tr_id=H0UNCNT0`
- [ ] 16:00–20:00 애프터마켓에도 틱이 들어오고 주문이 체결되는지
- [ ] NXT 미상장 종목(예: 293490)이 `listed=False` → `H0STCNT0` 로 폴백되는지, `H0UNCNT0` 로 직접 구독 시 KIS 응답(무응답/오류) 기록
- [ ] 20:00 이후 게임 마지막 가격이 DB 통합(UN) 일봉 종가와 같은지
- [ ] 틱 묶기·공개 채널: 비로그인 web/모바일에서 차트가 실시간 갱신되는지(DevTools WS `tick` ~4회/초), 손절가 통과 틱에서 자동청산·넛지가 즉시 오는지, trading_game 로그에 `포지션 캐시 적재 실패` 없는지
- 문제 시 즉시 되돌리기: `.env.production` 에 `GAME_WS_TR_ID=H0STCNT0` → `game_ws` 재생성

## 2. 브라우저·기기로 아직 확인하지 않은 화면
### web_client (`app.haezean.com/game`)
- [ ] 연속 출석 보상 모달(🔥 칩 → 보상 받기 → 자본금 증가)
- [ ] 주문 패널: 비중 ▾ 드롭다운(Chrome·Safari 모양), 손절·익절 선택, 레버리지 바꿀 때 안내 문구 변화
- [ ] 비중 30% + 손절 -5% 주문 → 포지션 카드 "손절 X원", 차트 회색 점선 손절선 → 퀘스트 Q1 보상 받기 가능
### admin_web (`admin.haezean.com`)
- [ ] 🎓 아카데미 문항: 초기 3문항 표시, 문항 추가 → 웹 아카데미 모달에 반영, 전부 비활성 시 경고
- [ ] 🧩 퀴즈 관리: 필터·페이지, 상세 차트(기준일 이후 5일 다른 색), 해설 저장, 비활성 → 출제 제외, 자동 생성, 직접 출제(삼성전자·한 달 전 거래일)
- [ ] 블로그 에디터의 `prose` 스타일(제목·목록) — 코치 미리보기만 확인됨
### mobile (dev build)
- [ ] 게임 탭 전체(시트 열기/닫기, Android 뒤로가기로 시트 닫힘, iOS 시트 쓸어 닫기)
- [ ] 앱 백그라운드 → 복귀 시 WS 재연결·계좌 재조회
- [ ] Android edge-to-edge 에서 시트 상단 여백·시트 안 토스트 위치
- [ ] 주문 패널 ▾ 선택 목록(바깥 탭·뒤로가기로 닫힘), iOS 점선 표시, 좁은 화면 줄바꿈
- [ ] 간편 로그인 인앱 브라우저 → `stockapp-dev://auth` 복귀("Unmatched route" 없음)
- [x] 랭킹 시트 주간 탭·지난주 Top 3·주간 보상 토스트 — Android 에뮬레이터(로컬 일회용 DB) 확인 2026-10-13
### web 주간 랭킹
- [ ] 랭킹 모달 주간 탭·지난주 Top 3·보상 토스트(브라우저 미확인, tsc/build 만 통과)

## 3. 개발 서버에서 해야 할 작업
- [ ] ⑤-2 까지 push 후 배포 확인(마이그레이션 2개 자동 적용: `streak_reward_claims`, `academy_questions`/`chart_quiz_pool.is_active`)
- [x] 시즌 1기 종료일 backfill — 서버에서 `docker exec stock_trading_game python -m scripts.seed_trading_game` → `end_at_backfilled=True`, API `end_at=2026-10-31T11:00:00Z` 확인(2026-10-14). 이때 오늘 코치 브리핑이 예시 값으로 생성됨 → 아래 코치 항목 처리 필요
- [ ] 주간 랭킹 push 후: 마이그레이션 `c9d0e1f2a3b4` 자동 적용 확인, celery beat 재시작으로 `close-trading-week` 등록, 첫 월요일 08:50 이후 `weekly_ranking_results` 행·보상 지급·토스트 확인
- [ ] admin → 데일리 코치에서 오늘 브리핑을 **실제 지지선·저항선**으로 수정·재발행(시드 값 71,000/73,500 은 예시라 차트 축척이 깨짐)

- [ ] 시즌 기간·월간 랭킹 push 후: 마이그레이션 `e1f2a3b4c5d6` 자동 적용, celery beat 재시작으로 `close-trading-month` 등록, admin 게임 설정 화면 로드·저장 확인
- [ ] 10/31(토) 시즌 1기 정산이 10/30(금) 종가로 20:40 에 실행되는지(로그 `시즌 1 정산 완료`), 11월 시즌이 admin 설정 기간으로 생성됐는지
- [ ] 분기 선택은 **web·모바일 새 버전 배포 후**(구 버전은 월간 보상 토스트를 주간 문구로 표시)

## 4. 외부 준비가 필요한 것
- [ ] **간편 로그인 키 발급**: 카카오 REST 키, 네이버 Client ID/Secret(+검수, 검수 전엔 테스트 계정만), Redirect URI 등록(README 목록), `SOCIAL_STATE_SECRET` 설정
- [ ] **모바일 dev build 재생성**: 개발 앱 스킴이 `stockapp-dev` 로 바뀜(`npm run prebuild:dev` 후 재설치)
- [ ] 에뮬레이터 사용 시 `adb reverse tcp:8003 tcp:8003` 추가

## 5. 주의할 점 (운영 규칙)
- **게스트 로그인**: 개발 서버는 `AUTH_GUEST_ENABLED=true` 로 켜 둠(웹 빌드 `VITE_ENABLE_GUEST_LOGIN=true` 와 짝). **product 전환 시 둘 다 false**.
- **가짜 공급자 모드**(`SOCIAL_FAKE_PROVIDER`)는 `APP_ENV` 가 development/test 일 때만 켜짐 — 운영 `.env` 에 넣지 않는다.
- **장외 테스트용 Mock 틱**(`MOCK_TICK_STREAM=true`)은 테스트 후 반드시 제거.
- **KIS 실시간 세션은 앱키당 제한** — 서버 `game_ws` 가 도는 동안 로컬에서 같은 키로 `run_game_ws` 를 띄우지 않는다.
- **퀴즈 자동 생성 개수**: admin "N개 자동 생성"을 200개로 돌리면 Cloudflare 약 100초 제한에 걸릴 수 있음 → 50개 단위 권장.
- **손절·익절 % 는 주가 기준**(레버리지 미반영). 5x 에서 손절 -20% 는 강제청산(-80%)이 먼저라 발동하지 않음. SHORT 의 "손절 -5%" 는 주가 **상승** 5%.
- **TradingView 로고**: lightweight-charts 출처 표시 의무 — 로고 유지(결정됨).
- **시즌 운영**: 시즌은 월간(1일 09:00 ~ 말일 20:00) 또는 분기(~ 분기 마지막 달 말일 20:00). admin 게임 설정의 '다음 시즌 기간'은 **다음 시즌부터** 적용. 20:40 정산이 다음 시즌을 자동 생성하고(종료일이 주말·휴장이면 직전 거래일 종가), `game_ws` 는 60초 안에 새 종목으로 자동 전환(재시작 불필요).
- **주간 랭킹 기준값은 Redis 에만 있음**: 그 주 첫 랭킹 갱신 때 기록되므로 Redis 를 비우면 그 주 주간 순위가 초기화된다. 시즌 마지막 주 기록이 정산 중 실패하면 로그(`season=… week_start=…`)를 보고 `weekly_service.close_week(..., with_reward=False)` 로 수동 기록(주간 ZSET TTL 21일).
- **DB 작업**: 마이그레이션 검증은 로컬 docker PG 일회용 DB 에서만. dev 터널(15432) DB 에 직접 실행 금지(배포 워크플로가 자동 적용).
