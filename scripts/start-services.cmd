@echo off
echo Starting all microservices and web clients...
start "Auth Service (:8001)" cmd /k "cd /d %~dp0..\backend && uv run uvicorn apps.auth.main:app --reload --port 8001"
start "Blog Service (:8000)" cmd /k "cd /d %~dp0..\backend && uv run uvicorn apps.blog.main:app --reload --port 8000"
start "Stock API Service (:8002)" cmd /k "cd /d %~dp0..\backend && uv run uvicorn apps.stock_api.main:app --reload --port 8002"
start "Admin Web (:5173)" cmd /k "cd /d %~dp0..\admin_web && npm run dev"
start "Web Client (:3000)" cmd /k "cd /d %~dp0..\web_client && npm run dev"
echo All services launched in separate windows.
