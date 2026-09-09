# Claude AI System Context & Architectural Constraints

> **To Claude (or Claude Code CLI):** 
> Read this document to understand the deployment, infrastructure, and architectural constraints of the `stock_app` project before making code changes or suggesting architectural modifications.

---

## 1. Environment & Infrastructure
*   **Target Server:** Personal Home Server (Ubuntu 24.04 on Mini PC) behind a Double NAT.
*   **Ingress / Networking:** **Cloudflare Tunnel (Zero Trust)** is used exclusively. 
    *   *Do NOT* suggest or configure Nginx, Traefik, Let's Encrypt, or Port Forwarding. Cloudflare handles HTTPS and routing.
    *   Subdomains route directly to localhost Docker ports (`auth.haezean.com` -> 8001, `api.haezean.com` -> 8002, `blog.haezean.com` -> 8003).
*   **CI/CD:** **GitHub Actions (Self-hosted runner)**. Code is pulled directly to the home server via the runner, built, and executed via Docker Compose.

## 2. Docker & Service Orchestration
The production environment uses `docker-compose.prod.yml` at the project root.
When writing Dockerfiles or Compose files, respect the following service boundaries:

### Databases (Stateful)
1.  **PostgreSQL (5432):** Main RDBMS for users, auth, metadata.
2.  **ClickHouse (8123, 9000):** OLAP database for high-volume time-series stock data and fundamentals.
3.  **Redis (6379):** Cache and message broker for Celery.

### Backend Microservices (FastAPI - Python 3.12)
*All APIs are built from the `backend/Dockerfile` using `uv`.*
1.  **Auth API:** Port `8001` (uvicorn apps.auth.main:app)
2.  **Stock API:** Port `8002` (uvicorn apps.stock_api.main:app)
3.  **Blog API:** Port `8003` (uvicorn apps.blog.main:app)

### Background Workers (Celery)
1.  **Worker:** `celery -A apps.collector.celery_app worker` (Data scraping, heavy tasks)
2.  **Beat:** `celery -A apps.collector.celery_app beat` (Scheduler)

## 3. Development Guidelines & Constraints
1.  **Dependency Management:** The backend strictly uses **`uv`**. When updating dependencies, use `pyproject.toml` and `uv.lock`. Do not use `pip install` directly in instructions without `uv`.
2.  **Environment Variables:** Do not hardcode secrets. The production compose file relies on `backend/.env.production`. For local dev, rely on `backend/.env.development` or `.env.example`.
3.  **Inter-Service Communication:** Backend services should communicate via the database (Redis/Postgres) or internal Docker DNS (e.g., `http://auth_api:8001`) if direct HTTP calls are necessary, not via the public Cloudflare URLs.
4.  **Monorepo Structure:** Keep backend code inside `/backend`, React Native inside `/mobile`, and React Vite apps inside `/admin_web` and `/web_client`.

## 4. Current CI/CD Workflow (`.github/workflows/deploy.yml`)
*   **Trigger:** Push to `main`.
*   **Action:** Runs on `self-hosted` runner.
*   **Execution:** `docker compose -f docker-compose.prod.yml up -d --build`
*   *Note:* Ensure any changes to the build process are reflected in `docker-compose.prod.yml`.
