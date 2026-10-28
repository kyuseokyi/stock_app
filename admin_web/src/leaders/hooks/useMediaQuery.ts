// web_client/src/hooks/useMediaQuery.ts 복사본 — 원본과 같이 고칠 것
import { useEffect, useState } from 'react'

/** CSS 미디어 쿼리 일치 여부(창 크기 변화 반영). 스플릿 뷰/펼침 중 하나만 그려 같은 요청이 두 번 가지 않게 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
