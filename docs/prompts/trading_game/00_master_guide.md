# [Trading Game] Claude Code Master Guide

이 문서는 **실시간 가상 트레이딩 게임(Trading Game)** 시스템을 Claude Code CLI를 통해 단계별(Phase 1 ~ Phase 6)로 구축하기 위한 전체 실행 마스터 가이드입니다.

---

## 1. 프로젝트 개요 & 핵심 철학

- **기획 문서**: [`docs/trading_game_plan.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/trading_game_plan.md)
- **컨셉**: "게임 80% + 교육 20%"의 마이크로 러닝 가상 트레이딩 플랫폼
- **특징**:
  1. **원클릭 즉시 체결 (No Waiting)**: 호가창 대기 없이 한국투자증권 실시간 체결 틱 기반 즉시 체결
  2. **1종목 시즌제 (Fair Play)**: 매월 1일~말일, 전 유저가 단 1개의 지정 종목(예: 삼성전자)으로 공정하게 경쟁
  3. **양방향 베팅 & 레버리지**: Long / Short 선택 가능, 1x/2x/5x 레버리지 지원 (5x는 아카데미 수료 시 해금)
  4. **24시간 에듀테인먼트**: 장중 라이브 배틀 + 장후/야간 10초 차트 퀴즈 + 관리자 데일리 코칭(지지/저항선 오버레이) + Streak(연속 출석)

---

## 2. Phase별 프롬프트 인덱스

Claude Code에서 작업할 때 아래 순서대로 해당 프롬프트 문서를 복사하거나 참조하여 실행하세요.

| Phase | 프롬프트 파일 | 주요 담당 영역 | 대상 디렉토리 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | [`01_phase1_db_schema.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/01_phase1_db_schema.md) | PostgreSQL DB 모델링 (SQLAlchemy), Alembic 마이그레이션, 초기 시드 스크립트 | `backend/` |
| **Phase 2** | [`02_phase2_kis_ws_collector.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/02_phase2_kis_ws_collector.md) | 한투 실시간 WebSocket 수집기 (`H0STCNT0`), 단일 세션 유지 데몬, Redis Pub/Sub 발행 | `backend/` |
| **Phase 3** | [`03_phase3_order_engine_gateway.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/03_phase3_order_engine_gateway.md) | 가상 체결 엔진, TP/SL 감시, 마진콜 강제청산, FastAPI WebSocket Gateway | `backend/` |
| **Phase 4** | [`04_phase4_ranking_season_settlement.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/04_phase4_ranking_season_settlement.md) | Redis ZSET 실시간 랭킹 Top 100, 시즌 말 정산 스케줄러, 명예의 전당, Trading MBTI 리포트 | `backend/` |
| **Phase 5** | [`05_phase5_coach_quest_admin.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/05_phase5_coach_quest_admin.md) | 스마트 코치 API & admin_web 발행 UI, 실시간 넛지 룰 엔진, 퀘스트/Streak/차트 퀴즈 API | `backend/`, `admin_web/` |
| **Phase 6** | [`06_phase6_frontend_ui.md`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/docs/prompts/trading_game/06_phase6_frontend_ui.md) | 트레이딩 게임 플레이 화면 (실시간 캔들, 원클릭 주문창, 지지/저항선, 심리 미터기, 지인 리그) | `web_client/`, `mobile/` |

---

## 3. Claude Code 작업 시 핵심 준수 사항

1. **기존 기능 보존 (Regression Prevention)**:
   - 기존 `apps/auth`, `apps/blog`, `apps/collector`, `apps/stock_api` 및 기존 DB 테이블(`users`, `boards`, `blog_posts` 등)의 스키마와 API 계약을 절대 파괴하지 마세요.
   - 트레이딩 게임 관련 코드는 가급적 신규 모듈/서비스로 독립하여 격리합니다. (예: `backend/apps/trading_game/` 또는 `backend/apps/stock_api/game/`)
2. **패키지 관리**:
   - Python 작업 시 무조건 `uv`를 사용하세요 (`uv run`, `uv add`).
   - 환경은 `conda activate stock_app` 또는 `.venv` 기준.
3. **클린 아키텍처 (Clean Architecture)**:
   - Router -> Service(UseCase) -> Repository 계층 분리를 엄수합니다.
   - DB 세션 및 Redis 커넥션 관리는 `backend/shared/`의 공통 인프라를 활용합니다.
4. **마이크로 스텝 (Micro-Step Development)**:
   - 토큰 한도를 고려하여 각 Phase별 지시서의 단계를 하나씩 점진적으로 실행하고 테스트하세요.
