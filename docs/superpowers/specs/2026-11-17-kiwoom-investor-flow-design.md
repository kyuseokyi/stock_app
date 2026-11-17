# 시황 수급 전광판에 키움 투자자별 순매수 단면 추가 (ka10058, 2026-11-17)

키움 연동 ④-3. 대상: `backend/apps/collector/investor_flow.py`(시황 탭 "돈의 흐름" — 외국인·기관·연기금 순매수 상위 10). 지금 순서: pykrx(KRX 로그인) → KIS `investor_daily`(연기금 없음, 기준일이 전 거래일일 수 있음).

## 변경
- 출처 순서를 **키움(설정 시) → pykrx → KIS** 로. 결과 구조(`{ticker, name, net_amount}` 상위 `TOP_N`, `source`, `date`)는 그대로, `source` 값에 `"kiwoom"` 추가. 화면·API 무변경(출처 문구가 있으면 '키움' 라벨만).
- `KiwoomClient.investor_daily_top(investor, start, end, market)` — `ka10058` 투자자별일별매매종목(`/api/dostk/stkinfo`), `invsr_tp`(외국인·기관계·연기금 코드), `trde_tp`(순매수), `mrkt_tp`(코스피·코스닥), `stex_tp`(통합 가능하면 3), 기간 = 기준일 하루. 경로·body·응답 키·필드·**금액 단위**는 명세에서 확인, 원 단위로 환산. 코스피·코스닥 합쳐 순매수 금액 내림차순 상위.
- 한 투자자라도 키움이 실패·빈 결과면 그 투자자만 다음 출처로(혼합 허용, 투자자별 `source` 기록) — 구현이 복잡하면 전체를 다음 출처로 넘기고 보고.
- 종목코드 접미사(`_AL` 등) 제거, 우선주·ETF가 섞이면 기존 출처와 같은 기준으로 거른다(기존 필터 재사용).

## 소량 실측
- `probe --investors`: 기준일(기본 직전 거래일) 외국인·기관계·연기금 각 상위 5종목(이름·순매수 금액·원시 단위 값), 응답 행 수·`cont-yn`·오류 코드. 키·토큰 미출력. 숨은 조건(시간 제한·미확정 0 행·상위 N 제한) 확인.

## 테스트
body·투자자 코드 매핑, 단위 환산, 접미사 제거, 출처 폴백(키움 미설정 → pykrx, 키움 실패 → pykrx·KIS), 결과 구조 불변, source='kiwoom'.

## 반영
상용만 바뀐다(개발은 키움 키 없음 → 기존 순서). 배포 후: `probe --investors` → 다음 전광판 갱신 시각 이후 시황 탭 확인. 문서: `docs/data-collection.md`, `docs/kiwoom_setup_and_dev_spec.md`(④-3).
