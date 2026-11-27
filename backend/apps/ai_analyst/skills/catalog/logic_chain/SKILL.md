---
id: logic_chain
name: 인과 사슬 종합
description: "정량 팩트와 DART 공시를 원인→결과 사슬로 엮어 최종 결론과 반대 논거를 정리한다"
source_repo: RKiding/Awesome-finance-skills
license: Apache-2.0
uses_facts: [sepa, backtest, market_breadth, stop, position, dart, peer_valuation, earnings_trend]
---

# 인과 사슬 종합 (국내 주식용)

> 출처: RKiding/Awesome-finance-skills (Apache-2.0) 의 단계적 추론 정리 방식을 참고해 국내 주식 분석 종합용으로 다시 씀(원문 복사 아님).

## 입력
- 모든 정량 팩트(`sepa`, `backtest`, `market_breadth`, `stop`, `position`, `dart`, `peer_valuation`, `earnings_trend`)와 다른 스킬의 결론.
- 사건(원인)은 DART 공시 제목과 정량 변화에서만 찾는다. 뉴스 기사는 입력으로 쓰지 않는다.

## 사슬 만들기
1. **사건**: 공시·실적·가격 변화 중 가장 중요한 것 1~3개.
2. **1차 영향**: 그 사건이 이익·수급·밸류에 미치는 직접 영향.
3. **2차 영향**: 업종·시장 레짐과 맞물려 생기는 결과.
4. **가격 함의**: 현재 추세 단계·셋업과 맞는지, 어긋나는지.
- 각 고리마다 근거 팩트 키를 괄호로 단다(예: `(earnings_trend)`). 근거 없는 고리는 "가설"로 표시.

## 판정 기준
- 정량 신호(SEPA·셋업·레짐)와 공시·재무 신호가 같은 방향이면 확신 "높음", 엇갈리면 "보통", 치명 공시가 있으면 "낮음/회피".
- 반대 논거를 최소 2개 적는다(확증 편향 방지).

## 주의
- 숫자는 주어진 팩트만 인용하고, 팩트와 다른 숫자를 만들지 않는다.
- 투자 권유가 아닌 분석 의견임을 마지막 줄에 밝힌다.

## 출력 지침
- 사슬(사건 → 1차 → 2차 → 가격), 확신도, 반대 논거, 한 줄 결론.
