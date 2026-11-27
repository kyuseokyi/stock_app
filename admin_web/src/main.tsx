import { QueryClientProvider } from '@tanstack/react-query'
import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { installChunkReload } from './lib/chunkReload'
import { getQueryClient } from './lib/queryClient'

// TanStack Query 개발 도구 — 개발 모드에서만 동적으로 불러온다(운영 번들에 들어가지 않음)
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null

// 배포 전 index.html 을 들고 있던 탭이 옛 화면 조각을 못 받으면 한 번 새로고침
installChunkReload()

// index.html 에 #root 가 항상 존재
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={getQueryClient()}>
      <BrowserRouter>
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
