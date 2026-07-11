# 07. 배치 스케줄 — 멀티마켓 야간 파이프라인

← [인덱스](00-index.md) · 관련: [03-overseas-stocks.md](03-overseas-stocks.md)

> AMS는 7개 시장을 각자 **로컬 타임존 기준**으로 수집·계산한다. stock_app이 국내만 하면 단순하지만, **해외를 지원하면 이 타임존 오케스트레이션이 필수**다.

## 1. 파이프라인 순서 (의존성 있는 사슬)

각 시장에서 로컬 시간 기준으로 순차 실행 — **앞 단계 완료가 뒤 단계의 전제**:

| 로컬 시각 | 작업 | 워커 |
|---|---|---|
| 22:00 | 종목 OHLCV 수집 | kis_worker |
| 22:01 | 지수(MarketIndex) 수집 | kis_worker |
| 23:00 | SMA 계산 | kis_worker |
| 00:01 | RS 계산 | kis_worker |
| 00:05 | 마켓데이터(시총/주식수) 수집 | kis_worker |
| 00:30 | TA 계산 | ta_worker |
| 01:00 | TA 캐시 refresh | ta_server |
| 03:00 (KR만) | 펀더멘털 수집 | kis_worker |

**핵심 = 수집 → 기본지표(SMA) → 상대강도(RS) → 종합 TA → 캐시**의 순차 의존 파이프라인.

> ⚠️ 순서 함정(AMS가 실제로 겪음): 마켓데이터(시총)는 원래 01:00이었는데 TA 싱크(00:30)보다 늦고 캐시 refresh(01:00)와 겹쳐, 두 소비자가 당일 시총을 못 읽거나 경합했다. → **RS(00:01)와 TA(00:30) 사이인 00:05로 이동**. 교훈: **소비자보다 생산자를 먼저** 스케줄.

## 2. 시장별 로컬 타임존 cron

각 거래소를 자기 로컬 타임존에 스케줄:
```python
CronTrigger(hour=22, minute=0, timezone=timezone(exchange.local_timezone))  # 잡 id: f'{exchange.code}_OHLCV'
```
`Exchange` 마스터의 `local_timezone`/`close_time`이 스케줄 소스. 지원 시장: KRX, 미국(NYSE/NASDAQ), 일본(TSE), 홍콩(HKEX), 중국(SSE), 베트남(HOSE/HNX).

## 3. 미국 서머타임(DST) — KST 환산 변동

미국 로컬 22:00 수집이 KST로는 DST에 따라 달라진다:
- **EDT(서머타임)**: 22:00 EDT = **11:00 KST**(다음날)
- **EST(해제)**: 22:00 EST = **12:00 KST**(다음날)

RS/TA/캐시도 각각 +1/+1.5/+2시간씩 밀려 EDT 13:01/13:30/14:00, EST 14:01/14:30/15:00 KST. → 타임존 라이브러리(`pytz`/`zoneinfo`)로 로컬 기준 cron을 걸면 DST가 자동 처리됨(KST 하드코딩 금지).

## 4. 겹칠 때 우선순위
동시각이면: ① RS 계산(고객 요구로 로컬 00:01 엄수) → ② 종목 OHLCV → ③ 지수 OHLCV → ④ SMA 등 indicator.

## 5. stock_app 적용

**국내만이면(현재)**: 단일 파이프라인이면 충분. 현재 beat는 `16:00 단일 수집`뿐인데, 지표를 붙이면 **수집 → SMA → (RS) → TA**의 순차 체이닝이 필요.
- Celery **chain/chord**로 "수집 완료 → 지표 계산 트리거" 구성 (또는 단계별 beat + 완료 신호)
- 각 단계는 앞 단계 완료 전제 → **단계 간 완료 신호 + 실패 격리** 필수
- 국내는 16:00(장 종료 후) 시작으로 위 순서를 압축 실행 가능

**해외까지 확장하면**: [03](03-overseas-stocks.md)의 `Exchange.local_timezone` 기반 **거래소별 cron**으로 전환. 미국 DST는 타임존 인식 cron으로 자동 처리. 단, AMS의 "국가별 타임존 스케줄" 복잡도가 그대로 들어오므로, **거래소를 데이터(Exchange 테이블)로 다루고 스케줄을 동적 생성**하는 구조가 핵심.

> stock_app 단순화 여지: AMS는 프로세스가 5개(kis_worker/ta_worker/ta_server…)라 단계마다 다른 워커가 붙지만, stock_app은 **Celery 하나**로 통합하고 단계는 태스크 체인으로 표현하면 운영이 훨씬 단순하다. ([01](01-architecture.md))
