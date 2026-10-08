[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `docs/prompts/00_master_prompt.md`, `CLAUDE.md`, `docs/trading_game_plan.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 Redis Sorted Set(ZSET)을 활용한 **초고속 실시간 랭킹 시스템(Top 100)**과 매월 말 장 마감 시 동작하는 **시즌 정산(Settlement) 및 명예의 전당 / Trading MBTI 리포트 생성 스케줄러**를 구축하는 것입니다.

---

## 1. 기술 요구사항 및 스펙

### 1) Redis Sorted Set (ZSET) 실시간 랭킹
- **Redis 키 구조**: `game:season:{season_id}:ranking`
  - Member: `user_id` (UUID 문자열)
  - Score: `current_roi` (수익률 %, 소수점 4자리 반영 가능한 부동소수점)
- **점수 갱신 타이밍**:
  - 유저 포지션 청산 완료 시 (`order_engine.py`에서 `ZADD` 호출)
  - 주기적인 보유 포지션 평가자산 재산정 시
- **랭킹 조회 연산**:
  - Top 100: `ZREVRANGE game:season:{season_id}:ranking 0 99 WITHSCORES`
  - 내 순위: `ZREVRANK game:season:{season_id}:ranking {user_id}` (0-indexed이므로 +1)

### 2) 랭킹 및 명예의 전당 API 엔드포인트
- `GET /api/game/seasons/{season_id}/leaderboard`: Top 100 유저 목록 (순위, 닉네임, ROI %, 총자산, 승률) 반환
- `GET /api/game/seasons/{season_id}/my-rank`: 로그인한 유저의 현재 순위 및 수익률
- `GET /api/game/hall-of-fame`: 역대 마감된 시즌들의 Top 랭커 기록 아카이브 조회
- `GET /api/game/leagues/{league_id}/leaderboard`: 지인 리그 참여 멤버들만의 순위표

### 3) 시즌 마감 및 정산 스케줄러 (`Celery Task`)
- **실행 주기**: 매월 말일 15:30 (장 마감 직후)
- **정산 파이프라인 (Step-by-Step)**:
  1. **전액 자동 청산**: 해당 시즌의 모든 `status='OPEN'` 포지션을 최종 체결가로 강제 청산 (`closed_reason='SEASON_END'`).
  2. **최종 ROI 확정**: 모든 계좌의 최종 총자산(`total_asset`) 및 최종 수익률(`current_roi`) 계산 및 DB 업데이트.
  3. **명예의 전당 적재**: 최종 ROI 기준 상위 1위~100위 유저를 `hall_of_fame` 테이블에 영구 저장.
  4. **개인화 매매 MBTI 분석**:
     - 각 유저의 `game_trades` 기록을 분석하여 매매 성향 산출:
       - `냉철한 원칙주의자`: 손절선(SL) 설정 거래 비율 70% 이상
       - `불나방 트레이더`: 100% 몰빵 진입 비율이 높고 짧은 보유 시간
       - `빅쇼트의 후예`: 하락(SHORT) 포지션 수익 비중 60% 이상
       - `황소 저격수`: 상승(LONG) 포지션 승률 60% 이상
     - 결과를 리포트 테이블 또는 계좌 메타데이터에 기록.
  5. **시즌 상태 변경**: 현재 시즌 `status = 'FINISHED'`.
  6. **차기 시즌 자동 생성**: 다음 달 1일 09:00 시작하는 신규 시즌(`status = 'READY'` 또는 `ACTIVE`, 초기 자본금 10,000,000원) 생성.

---

## 2. 작업 순서 (Step by Step)

1. **랭킹 서비스 구현 (`backend/apps/trading_game/services/ranking_service.py`)**:
   - `update_user_rank(season_id, user_id, roi)`: Redis ZADD
   - `get_top_leaderboard(season_id, limit=100)`: Redis ZREVRANGE 및 DB User 정보(닉네임) 결합
   - `get_user_rank(season_id, user_id)`: 내 순위, 백분위 계산
2. **REST API 라우터 구현 (`backend/apps/trading_game/routers/leaderboard.py`)**:
   - `/leaderboard`, `/my-rank`, `/hall-of-fame`, `/leagues/{id}/leaderboard`
3. **지인 리그(Private League) 관리 기능**:
   - `POST /api/game/leagues`: 지인 리그 생성 (초대코드 6자리 자동 생성)
   - `POST /api/game/leagues/join`: 초대코드로 리그 참가
4. **시즌 정산 Celery 태스크 구현 (`backend/apps/collector/tasks/settle_season.py`)**:
   - Celery 태스크 `@celery_app.task(name="settle_trading_season")` 정의
   - 트레이딩 MBTI 분류 함수 작성 (`services/mbti_analyzer.py`)
   - Celery Beat 스케줄 등록 (`apps/collector/celery_app.py`)
5. **검증 및 단위 테스트 작성 (`backend/tests/test_ranking_and_settlement.py`)**:
   - 다수 유저의 ROI에 따른 Redis ZSET 랭킹 정렬 검증
   - 시즌 정산 시 미청산 포지션 강제 청산 및 `hall_of_fame` 정상 적재 테스트
   - `uv run pytest tests/test_ranking_and_settlement.py -v` 실행 검증
