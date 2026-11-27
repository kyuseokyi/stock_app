import axios from 'axios'
import { QueryClientProvider } from '@tanstack/react-query'
import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ApiProgressBar from './components/ApiProgressBar'
import './index.css'
import { installChunkReload } from './lib/chunkReload'
import { installRetry } from './lib/retry'
import { installApiActivity } from './lib/apiActivity'
import { getQueryClient } from './lib/queryClient'

// TanStack Query 개발 도구 — 개발 모드에서만 동적으로 불러온다(운영 번들에 들어가지 않음)
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null

// 기본 axios(stock_api GraphQL 조회 — api/stock·api/screener)도 배포 순간 공백을 짧게 재시도. mutation 은 제외.
installRetry(axios)
installApiActivity(axios) // 상단 진행 표시줄(스크리너·차트 GraphQL)
// 배포 전 index.html 을 들고 있는 인앱 브라우저(카카오톡 등)가 옛 화면 조각을 못 받으면 한 번 새로고침
installChunkReload()

// index.html 에 #root 가 항상 있다(타입상 HTMLElement | null). `!` 는 타입 표기용.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={getQueryClient()}>
      <BrowserRouter>
        <ApiProgressBar />
        <App />
      </BrowserRouter>
      {Devtools && (
        <Suspense fallback={null}>
          <Devtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  </React.StrictMode>,
)
