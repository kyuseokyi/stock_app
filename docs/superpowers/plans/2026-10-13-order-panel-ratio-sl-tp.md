# 주문 패널 개선 구현 계획 — 비중 세분화 · 손절/익절

> 스펙: `docs/superpowers/specs/2026-10-13-order-panel-ratio-sl-tp-design.md` · 브랜치 `dev`

## 사전 확인 결과
- SL/TP 의미: `pricing.tp_sl_prices` 가 **진입가 대비 주가 %** 로 절대가를 만든다(LONG SL=entry×(1−pct), SHORT SL=entry×(1+pct)).
  레버리지 반영 수익률이 아님 → 수익률 영향은 약 `% × 배율`(수수료 별도). UI 문구는 "주가 기준"으로 표기.
- 청산 우선순위 MARGIN_CALL(ROI ≤ −80%) > STOP_LOSS > TAKE_PROFIT → 손절 % × 배율 ≥ 80% 이면 강제청산이 먼저 → 안내 문구.
- DB `entry_ratio` 는 `Numeric(5,4)`, CHECK 제약 없음 → 마이그레이션 불필요.
- Q3'(ratio ≤ 0.25)·넛지(ratio==1 & 5x)는 ratio 값만 사용 → 로직 변경 없음.

## 작업 단위(커밋)
1. **backend** (TDD)
   - 실패 테스트 먼저: 새 비중(0.1~0.9) 주문 201 / 이상값(0.15·0.35·0) 422 / ratio 0.3 + SL 5% + TP 10% → stop_loss_price 95, take_profit_price 110, Q1 완료.
   - 회귀: Q3' 는 0.1·0.2 집계, 0.3 미집계. 기존 0.25/0.5/1.0·SL/TP 없음 주문 그대로.
   - 구현: `OrderRequest.ratio` Literal 확장, Q3 상수 주석 정리.
2. **web_client**
   - `Ratio` 확장, `OrderRequest` 에 `stop_loss_pct?`/`take_profit_pct?`(null 이면 키 생략), `placeOrder(side, ratio, leverage, opts?)`.
   - `lib/orderOptions.ts`(선택지 상수·라벨·보조문구·포지션 SL/TP 한 줄), `OrderPanel` 칩+`<select>`(기타·손절·익절), `ActivePositionCard` 한 줄, `TradingChart` 손절(회색 점선)·익절(초록 점선).
3. **mobile**
   - jest 먼저: `features/game/lib/order-options.test.ts`(모듈 없음 → 실패 확인) → `order-options.ts` 구현.
   - `components/option-picker.tsx`(Pressable "▾" → 투명 Modal 리스트), `order-panel`·`position-card`·`candle-chart` 반영, store/api/types/`game.tsx` 전달.
4. **docs**: README 게임 섹션 한 줄.

## 검증
- `cd backend && uv run pytest -p no:warnings`
- `cd web_client && npx tsc --noEmit && npm run build`
- `cd mobile && npx tsc --noEmit && npm test`
