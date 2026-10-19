import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { installChunkReload } from './lib/chunkReload'

// 배포 전 index.html 을 들고 있던 탭이 옛 화면 조각을 못 받으면 한 번 새로고침
installChunkReload()

// index.html 에 #root 가 항상 존재
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
