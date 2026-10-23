import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import ScreenerNav from '../../components/screener/ScreenerNav'

// 스크리너 공통 틀 — 한 줄 탭(시장 · 종목 찾기 두 묶음) + 탭 화면. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.

export default function ScreenerLayout() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <ScreenerNav />
      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>
      <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
        <Outlet />
      </Suspense>
    </div>
  )
}
