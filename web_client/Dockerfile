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

# ---- serve stage (정적 SPA 서버 — nginx 미사용) ----
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14.2.6
COPY --from=build /app/dist ./dist
EXPOSE 3000
# SPA 폴백·캐시는 dist/serve.json(public/serve.json): /assets/ 밖 경로만 index.html, 없는 /assets/ 는 404, index.html no-cache
CMD ["serve", "dist", "-l", "3000"]
