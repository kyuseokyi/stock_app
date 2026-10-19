import axios from 'axios'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { installChunkReload } from './lib/chunkReload'
import { installRetry } from './lib/retry'

// 기본 axios(stock_api GraphQL 조회 — api/stock·api/screener)도 배포 순간 공백을 짧게 재시도. mutation 은 제외.
installRetry(axios)
// 배포 전 index.html 을 들고 있는 인앱 브라우저(카카오톡 등)가 옛 화면 조각을 못 받으면 한 번 새로고침
installChunkReload()

// index.html 에 #root 가 항상 있다(타입상 HTMLElement | null). `!` 는 타입 표기용.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
