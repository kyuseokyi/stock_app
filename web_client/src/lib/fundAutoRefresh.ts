import { useEffect } from 'react'
import { createAutoRefresher, fetchReportHtml } from './fundCore'
import { deleteCache, loadFunds, localCache } from './fundStore'
import { useAuthStore } from '../store/auth'

// 웹 접속·탭 복귀 때 이 브라우저에 등록한 펀드를 모두 다시 가져온다(10분 이내 확인한 펀드는 건너뜀).
// 로직은 core createAutoRefresher(앱과 동일) — 여기선 localStorage 저장소·실행 시점만 연결. 웹은 히스토리 없음.
export const fundRefresher = createAutoRefresher({
  loadFunds: async () => loadFunds(),
  deps: { fetchHtml: (u) => fetchReportHtml(u), cache: localCache, now: Date.now },
  // 갱신 중에 목록에서 지운 펀드는 방금 쓴 캐시를 다시 지운다(리포트가 브라우저에 남지 않게)
  onRefreshed: (f) => {
    if (!loadFunds().some((x) => x.id === f.id)) deleteCache(f.id)
  },
})

/** Layout 에서 한 번 — 로그인 상태일 때 시작 1회 + 탭이 다시 보일 때마다 */
export function useFundAutoRefresh(): void {
  const loggedIn = useAuthStore((s) => s.user !== null)
  useEffect(() => {
    if (!loggedIn) return
    void fundRefresher.run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fundRefresher.run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loggedIn])
}
