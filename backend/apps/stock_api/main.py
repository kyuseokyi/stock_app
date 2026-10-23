"""주식 API 마이크로서비스 (FastAPI) — 스켈레톤.

역할: 스크리너 검색 결과, 차트 데이터 등 조회 전용(ClickHouse 주 통신).
아직 뼈대만 존재하며, 스크리너/차트 라우터는 후속 단계에서 추가한다.

실행:
    cd backend
    uv run uvicorn apps.stock_api.main:app --reload --port 8002
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from strawberry.fastapi import GraphQLRouter

from apps.stock_api.graphql.schema import schema
from apps.stock_api.routers import market_admin, screener_admin, themes_admin
from shared.cors import build_allowed_origins
from shared.health import add_health_routes

app = FastAPI(title="Stock App - Stock API Service", version="0.1.0")

# --- CORS --- (local/develop/product 공통 정책은 shared.cors 참조)
app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GraphQL: searchStocks / getChartData (어드민 차트 삽입 · 클라이언트 차트 조회)
graphql_app = GraphQLRouter(schema)
app.include_router(graphql_app, prefix="/graphql")

# 테마 관리자 보정(관리자 JWT) — KIS 테마 숨김·이름 수정, 관리자 테마, 종목 추가·제외
app.include_router(themes_admin.router)

# 관리자 시장 데이터(관리자 JWT) — 데이터 현황, KIS 를 호출하지 않는 계산 수동 실행
app.include_router(market_admin.router)

# 스크리너 탭 보이기 스위치(관리자 JWT) — 조건검색·차트 패턴 탭 켜고 끄기(공개 읽기는 GraphQL screenerFeatures)
app.include_router(screener_admin.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "stock_api"}


add_health_routes(app, "stock_api")  # /ready(DB — Redis 미사용)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.stock_api.main:app", host="0.0.0.0", port=8002, reload=True)
