# 인수인계 학습 가이드 (초보자용)

이 폴더는 **서버·파이썬·DB를 잘 모르는 사람**이 stock_app 을 처음부터 이해하고 운영할 수 있도록, 순서대로 읽는 학습 문서다.
루트 [`README.md`](../../README.md) 는 "이미 아는 사람용 상세 레퍼런스"이고, 여기는 "왜 그렇게 되어 있는지"를 차근차근 설명한다.

> 읽는 법: 1번부터 순서대로. 각 문서 끝의 **직접 해보기**를 실제로 따라 하면 이해가 훨씬 빠르다.
> 모르는 단어가 나오면 [11. 용어집·FAQ](./11-glossary-faq.md) 를 먼저 펼쳐 둔다.

## 학습 순서

| 단계 | 문서 | 이것만 알면 된다 | 예상 시간 |
|---|---|---|---|
| 1 | [전체 그림](./01-big-picture.md) | 어떤 프로그램들이 있고, 서로 어떻게 대화하는가 | 30분 |
| 2 | [내 컴퓨터에서 띄워 보기](./02-local-setup.md) | DB·서버·웹을 순서대로 켜고 화면을 본다 | 1~2시간 |
| 3 | [파이썬 기초 (이 프로젝트에 나오는 문법만)](./03-python-basics.md) | `async`, 타입힌트, 데코레이터, `Depends`, pydantic | 1~2시간 |
| 4 | [서버(FastAPI) 구조](./04-server-fastapi.md) | 요청 하나가 서버 안에서 어떻게 처리되는가 | 1~2시간 |
| 5 | [데이터베이스](./05-database.md) | PostgreSQL · ClickHouse · Redis 가 각각 무엇을 저장하나, 테이블을 바꾸는 법 | 2시간 |
| 6 | [API (REST · GraphQL · 실시간)](./06-api.md) | 클라이언트가 서버를 부르는 방법, 로그인 토큰(JWT) | 1~2시간 |
| 6.5 | 🛠 **[실습: API 하나를 DB 까지 직접 만들기](./api-tutorial/README.md)** (11단계) | 설계 → 테이블 → 모델 → 마이그레이션 → 스키마 → Repository → Service → Router → 확인 → 테스트 | 반나절~하루 |
| 7 | [배치 작업 (Celery · 데이터 수집)](./07-batch-celery.md) | 매일 밤 주식 데이터를 모으고 계산하는 일 | 1시간 |
| 8 | [웹 (web_client · admin_web)](./08-web.md) | React 화면이 API 를 부르는 구조 | 1~2시간 |
| 9 | [모바일 앱 (Expo)](./09-mobile.md) | 앱 폴더 구조, 실행, 빌드, OTA 업데이트 | 1~2시간 |
| 10 | [배포·운영](./10-deploy-ops.md) | 코드가 서버에 올라가는 길, 장애 났을 때 보는 순서 | 1시간 |
| 11 | [용어집·FAQ](./11-glossary-faq.md) | 자주 나오는 단어와 자주 겪는 문제 | 수시로 |

## 하나의 기능을 끝까지 따라가 보기

문서 4·5·6·8·9 는 모두 **"댓글 달기"** 라는 같은 기능을 예로 든다. 화면에서 버튼을 누르면 → API 호출 → 서버 라우터 → DB 저장까지 같은 기능을 층마다 보면, 전체가 한 줄로 연결된다.

```
[웹/앱 화면] 댓글 입력 → POST /api/v1/blogs/{id}/comments
     → blog 서버 routers/comments.py → crud.py → PostgreSQL blog_comments 테이블
```

## 이 문서 다음에 볼 것

| 알고 싶은 것 | 문서 |
|---|---|
| 모든 환경변수·실행 명령 상세 | [`README.md`](../../README.md) |
| 매일 쓰는 실행·배포 명령 요약 | [`docs/run_and_deploy.md`](../run_and_deploy.md) |
| Git 브랜치 규칙 (feature → dev → main) | [`docs/git_workflow.md`](../git_workflow.md) |
| DB 에 GUI 툴로 붙기 | [`docs/db_access.md`](../db_access.md) |
| 서버(미니PC) 처음 세팅 | [`docs/server_setup.md`](../server_setup.md) |
| 상용 서버 릴리스 | [`docs/deploy/prod-release.md`](../deploy/prod-release.md) |
| 앞으로 할 일 | [`docs/ROADMAP.md`](../ROADMAP.md) |
| 기능별 설계·계획 기록 | `docs/superpowers/specs/`, `docs/superpowers/plans/` |

> 이 가이드는 2026-11-05 `dev` 브랜치 코드를 기준으로 썼다. 코드가 바뀌면 파일 경로·포트가 달라질 수 있으니, 이상하면 실제 파일을 열어 확인하고 이 문서도 같이 고친다.
