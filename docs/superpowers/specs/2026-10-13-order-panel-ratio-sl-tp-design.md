# 주문 패널 개선 — 비중 세분화 드롭다운 · 손절/익절 설정 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨(사용자: "칩 + 드롭다운 혼합")
> 배경: 퀘스트 Q1 "첫 손절선 걸고 거래하기"가 UI 로 달성 불가(손절 입력 없음), 비중이 25/50/100% 고정.

## 1. 백엔드 (trading_game)
- `OrderRequest.ratio` 허용값 확장: **0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0** (그 외 422). 기존 0.25/0.5/1.0 요청은 그대로 동작(하위 호환).
- `stop_loss_pct`·`take_profit_pct` 는 기존 그대로(0 < x ≤ 1). **의미(주가 기준 % 인지, 레버리지 반영 수익률 % 인지)는 `order_engine.open_position` 구현을 읽고 그대로 따른다** — UI 문구를 그 의미에 맞춘다.
- 넛지·퀘스트(Q3' ratio ≤ 0.25) 로직은 ratio 값만 쓰므로 변경 없음 — 회귀 테스트로 확인(0.1·0.2 는 Q3' 진행에 집계, 0.3 은 미집계).
- 테스트(TDD): 새 비중 허용·이상값 422, SL/TP 와 함께 주문 시 stop_loss_price/take_profit_price 설정.

## 2. web_client
- 타입 `Ratio` 확장, `placeOrder(side, ratio, leverage, { stopLossPct, takeProfitPct })`(선택 인자 — 기존 호출 하위 호환), `api/game.ts` 요청 바디에 `stop_loss_pct`/`take_profit_pct`(null 이면 생략).
- `OrderPanel`:
  - 비중: 칩 25/50/100% 유지 + **▾ 드롭다운**(`<select>`, 10·20·30·40·60·70·75·80·90%). 드롭다운 값이 선택되면 드롭다운이 강조되고, 칩을 누르면 드롭다운은 "기타"로 복귀.
  - 손절 드롭다운: 없음 · -3% · -5% · -10% · -15% · -20%. 익절 드롭다운: 없음 · +5% · +10% · +20% · +30% · +50%. 라벨은 §1 의미에 맞게 보조 문구 한 줄.
  - 드롭다운은 네이티브 `<select>` + 기존 토큰 스타일(접근성·모바일 웹 호환).
- `ActivePositionCard`: SL/TP 가격이 있으면 "손절 67,640원 · 익절 —" 한 줄. `TradingChart`: 손절(회색 점선, 라벨 `손절`)·익절(초록 점선, 라벨 `익절`) 가격선 추가.

## 3. mobile
- 같은 확장. RN 에 네이티브 select 가 없으므로 **`Pressable` "▾ 기타" → 경량 선택 리스트(Modal)** 컴포넌트 `option-picker.tsx` 로 비중 기타·손절·익절을 통일.
- `position-card` SL/TP 표시, `candle-chart` 가격선 추가(기존 extraPrices 경로).
- jest: 선택지 상수·라벨 포맷 순수 함수 테스트.

## 4. 검증
- backend pytest 전체, web tsc/build, mobile tsc/jest.
- 로컬 스모크: 비중 30% + 손절 -5% 로 주문 → 포지션 카드·차트 손절선 표시 → 퀘스트 Q1 완료(보상 받기 활성).
- 문서: README 게임 섹션 한 줄.
