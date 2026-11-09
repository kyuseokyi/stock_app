import { useEffect, useState } from 'react'
import { getAdConfig, type AdConfig } from '../api/ads'

// 광고 원격 설정 — 광고 자리가 있는 화면이 들어올 때마다 다시 받는다(관리자 긴급 끄기가 다음 화면 이동부터 반영).
// useScreenerFeatures 와 달리 페이지 수명 캐시를 두지 않는다. 같은 순간 여러 곳이 부르면 요청 하나를 나눠 쓴다.
// null = 아직 모름 또는 실패 — 광고는 숨긴다(꺼짐 쪽이 안전, 실패해도 화면 나머지는 그대로).
let inflight: Promise<AdConfig | null> | null = null

function load(): Promise<AdConfig | null> {
  if (!inflight) {
    inflight = getAdConfig()
      .catch(() => null)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useAdConfig(): AdConfig | null {
  const [config, setConfig] = useState<AdConfig | null>(null)
  useEffect(() => {
    let alive = true
    void load().then((c) => {
      if (alive) setConfig(c)
    })
    return () => {
      alive = false
    }
  }, [])
  return config
}
