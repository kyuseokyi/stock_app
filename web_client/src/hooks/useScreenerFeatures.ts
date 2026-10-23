import { useEffect, useState } from 'react'
import { getScreenerFeatures, type ScreenerFeatures } from '../api/screenerFeatures'

// 관리자가 켜고 끄는 스크리너 탭(조건검색·차트 패턴). 페이지 수명 동안 1회 요청을 메뉴·라우트가 함께 쓴다(useGameRules 와 같은 방식).
// 실패하면 모두 꺼진 것으로 본다 — 다듬는 중인 탭이 실수로 열리지 않게. 실패는 캐시하지 않아 다음 새로고침에 다시 묻는다.
const HIDDEN: ScreenerFeatures = { finder: false, patterns: false }
let cached: ScreenerFeatures | null = null
let inflight: Promise<ScreenerFeatures> | null = null

function load(): Promise<ScreenerFeatures> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = getScreenerFeatures()
      .then((f) => {
        cached = { finder: f.finder === true, patterns: f.patterns === true }
        return cached
      })
      .catch(() => HIDDEN)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** null = 아직 모름(로딩) — 그동안 탭은 숨긴다 */
export function useScreenerFeatures(): ScreenerFeatures | null {
  const [features, setFeatures] = useState<ScreenerFeatures | null>(cached)
  useEffect(() => {
    if (cached) return
    let alive = true
    void load().then((f) => {
      if (alive) setFeatures(f)
    })
    return () => {
      alive = false
    }
  }, [])
  return features
}
