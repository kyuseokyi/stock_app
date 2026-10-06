@echo off
echo [Infra] Starting Docker containers (PostgreSQL, ClickHouse, Redis)...
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps
