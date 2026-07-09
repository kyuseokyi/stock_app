[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 클라이언트와 통신하는 순수 FastAPI REST API 라우터(`api/` 폴더)를 구현하는 것입니다.

## [실행 단계 - Step by Step]
1. **DB 모델 설정**: `backend/shared/models.py`를 생성하고 PostgreSQL `users`, `blog_posts`, `blog_comments`, `stock_meta` 테이블의 SQLAlchemy ORM 모델을 작성하세요.
2. **Auth API**: `/api/v1/auth` 엔드포인트를 만들고, 소셜 로그인 토큰(목업 처리 가능) 검증 후 JWT 토큰을 발급하는 로직을 작성하세요.
3. **Blog API**: `/api/v1/blogs` 엔드포인트를 만들고, `Role='admin'`만 접근 가능한 글쓰기(POST) 기능과 누구나 접근 가능한 조회(GET) 기능을 구현하세요.
4. **Push Task 위임**: 블로그 글 작성 성공 시, `send_push_notification.delay(post_id)`를 호출하여 Celery Worker로 푸시 알림 작업을 Offload(위임) 하세요.
5. **Screener API**: `/api/v1/stocks/screener` 엔드포인트를 만들고, `clickhouse-connect`를 사용하여 전달받은 JSON 조건(예: RSI < 30)에 맞춰 `daily_prices` 테이블을 조회해 결과를 반환하세요.
6. **서버 실행**: `uv run uvicorn api.main:app --reload` 로컬 실행 후 오류가 없는지 테스트하세요.
