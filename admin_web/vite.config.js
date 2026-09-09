import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 배포 빌드 시 반드시 주입돼야 하는 공개 설정(누락 시 빌드 실패 → 'green-but-broken' 차단)
const REQUIRED = ['VITE_API_BASE_URL', 'VITE_AUTH_BASE_URL', 'VITE_STOCK_API_URL']

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // .env.<mode> 파일 + docker build args(process.env) 양쪽에서 값 확인
  const fileEnv = loadEnv(mode, process.cwd(), '')
  if (command === 'build') {
    const missing = REQUIRED.filter((k) => !fileEnv[k] && !process.env[k])
    if (missing.length) {
      throw new Error(
        `[vite build] 필수 환경변수 누락: ${missing.join(', ')} (mode=${mode}). ` +
          `docker build args(VITE_*) 또는 .env.${mode} 를 확인하세요.`,
      )
    }
  }
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
    },
  }
})
