# 2. 블로그 마이크로서비스 및 어드민 웹 (Blog API & Admin Web)

당신의 임무는 블로그(커뮤니티) 게시판 관리와 실시간 알림 기능이 포함된 풀스택 어플리케이션을 개발하는 것입니다. 다음 작업들을 순차적으로 수행해 줘.

### 🟢 1단계: Backend Blog API 및 SSE 알림 구현 (FastAPI + Strawberry)
1. `backend/apps/blog/` 디렉토리에 블로그 전용 독립 서버를 구축해 줘. (`main.py`, `routers/`, `schemas.py`, `graphql/`, `crud.py`)
2. `backend/shared/models.py`에 게시판(`boards`)과 블로그 게시글(`blog_posts`)을 위한 SQLAlchemy 모델을 정의해 줘.
3. **[REST & GraphQL 하이브리드]** 
   - **조회(Query)**: 어드민 및 웹 클라이언트에서 복잡한 구조(게시글, 작성자, 댓글 목록 등)를 한 번에 조회할 수 있도록 **`Strawberry`** 라이브러리를 이용하여 GraphQL 쿼리(`graphql/schema.py`, `graphql/resolvers.py`)로 구현해 줘.
   - **작성/수정/삭제(Mutation)**: 상태 변경 및 파일 업로드가 포함될 수 있는 생성/수정 로직은 일반적인 REST API (`/api/v1/blogs`) 라우터로 구현해 줘.
4. **[중요]** 프론트엔드 웹 클라이언트를 위한 **SSE(Server-Sent Events)** 알림 엔드포인트(`/api/v1/notifications/stream`)를 구현해 줘. 관리자가 새 글을 쓰거나 알림 발송을 요청하면 이 스트림을 통해 클라이언트(웹)로 즉시 데이터가 푸시되도록 비동기 제너레이터를 작성해야 해. (모바일용 FCM 푸시 발송 로직은 지금 당장 제외해도 됨)
5. 프론트엔드에서 API를 호출하고 SSE를 수신할 수 있도록 `main.py`에 CORS 설정(localhost 허용)을 반드시 추가해 줘.

### 🔵 2단계: 웹 클라이언트 및 관리자 페이지 구현 (React + Vite)
1. `admin_web/` 디렉토리 내에 블로그 관리를 위한 UI(게시판 관리, 게시글 리스트, 작성/수정 폼)를 구현해 줘.
2. API 연동을 모듈화하고 관리자 UI를 완성해 줘.
3. **[중요]** 프론트엔드 UI를 작업할 때는 **반응형 웹(Responsive UI)**이 필수야. 데스크톱뿐만 아니라 태블릿과 스마트폰 해상도에서도 뷰가 깨지지 않고 자연스럽게 스택(Stack)되도록 TailwindCSS의 반응형 유틸리티 클래스(`sm:`, `md:`, `lg:`)를 적극적으로 사용해 줘.
4. 프론트엔드 단에 SSE 수신 로직(EventSource)을 연동해서, 서버에서 알림 이벤트가 넘어오면 화면 우측 하단에 토스트(Toast) 메시지로 띄워주는 기능을 추가해 줘.
