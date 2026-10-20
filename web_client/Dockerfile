# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* 는 빌드타임에 정적 파일로 인라인된다 → docker build args 로 주입.
ARG VITE_API_BASE_URL
ARG VITE_AUTH_BASE_URL
# 게임 탭(선택): 비면 게임 탭은 "시즌을 준비하고 있어요"(빌드는 성공)
ARG VITE_GAME_API_URL
ARG VITE_STOCK_API_URL
# 닉네임(게스트) 로그인 노출(선택): 'true' 면 표시. 비우면 배포 빌드는 숨김
ARG VITE_ENABLE_GUEST_LOGIN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL \
    VITE_GAME_API_URL=$VITE_GAME_API_URL \
    VITE_STOCK_API_URL=$VITE_STOCK_API_URL \
    VITE_ENABLE_GUEST_LOGIN=$VITE_ENABLE_GUEST_LOGIN
RUN npm run build

# ---- serve stage (정적 SPA + 같은 도메인 API 프록시 — server.cjs) ----
# /_api/{blog,auth,stock,game}/* 는 백엔드 서비스로 넘기고, 나머지는 serve-handler(serve CLI 와 같은 엔진)가
# dist/serve.json 규칙(/assets/ 밖 경로만 index.html, 없는 /assets/ 는 404, index.html no-cache)으로 응답.
FROM node:20-alpine
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev serve-handler@6.1.7 http-proxy@1.18.1
COPY --from=build /app/dist ./dist
COPY server.cjs ./
EXPOSE 3000
CMD ["node", "server.cjs"]
