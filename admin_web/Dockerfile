# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* 는 빌드타임에 정적 파일로 인라인된다 → docker build args 로 주입.
ARG VITE_API_BASE_URL
ARG VITE_AUTH_BASE_URL
ARG VITE_STOCK_API_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL \
    VITE_STOCK_API_URL=$VITE_STOCK_API_URL
RUN npm run build

# ---- serve stage (정적 SPA 서버 — nginx 미사용) ----
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
