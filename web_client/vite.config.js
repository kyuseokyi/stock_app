import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 일반 유저 웹 — admin_web(5173)과 겹치지 않게 3000 사용 (백엔드 CORS 기본 허용)
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: true },
})
