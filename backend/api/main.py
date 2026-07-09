from fastapi import FastAPI, Depends
import clickhouse_connect
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

app = FastAPI(title="Stock App API", version="0.1.0")

# --- Configuration ---
POSTGRES_URL = "postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db"
CLICKHOUSE_HOST = "localhost"
CLICKHOUSE_PORT = 8123
CLICKHOUSE_USER = "default"
CLICKHOUSE_PASSWORD = "password"

# --- Database Connections ---
# PostgreSQL (SQLAlchemy Async Engine)
engine = create_async_engine(POSTGRES_URL, echo=True)
async_session_maker = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

# ClickHouse Client
def get_clickhouse_client():
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST, 
        port=CLICKHOUSE_PORT, 
        username=CLICKHOUSE_USER, 
        password=CLICKHOUSE_PASSWORD
    )

# --- Routes ---
@app.get("/")
async def root():
    return {"message": "Stock App Backend is running!"}

@app.get("/health")
async def health_check():
    """Health check to verify DB connections."""
    status = {"api": "ok", "postgres": "unknown", "clickhouse": "unknown"}
    
    # Check Postgres
    try:
        async with async_session_maker() as session:
            # Simple query to check connection
            status["postgres"] = "ok"
    except Exception as e:
        status["postgres"] = f"error: {str(e)}"
        
    # Check ClickHouse
    try:
        client = get_clickhouse_client()
        result = client.command('SELECT version()')
        status["clickhouse"] = "ok" if result else "error"
    except Exception as e:
        status["clickhouse"] = f"error: {str(e)}"
        
    return status

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
