// web_client/src/components/ui/ScrollRow.tsx 복사본 — 원본과 같이 고칠 것
import { useEffect, useRef, useState, type HTMLAttributes } from 'react'

interface ScrollRowProps extends HTMLAttributes<HTMLDivElement> {
  /** 끝 흐림 색 — 놓인 바탕과 같게(흰 카드 위 surface, 라벤더 바탕 위 canvas) */
  fade?: 'surface' | 'canvas'
}

const FADE = { surface: 'from-surface', canvas: 'from-canvas' } as const

// 가로로 넘기는 칩 줄 — 오른쪽에 더 있을 때만 끝을 흐리게 해 '옆으로 넘길 수 있다'를 알린다(모바일에서 잘린 칩이 안 보이던 문제).
export default function ScrollRow({ fade = 'surface', className = '', children, ...props }: ScrollRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="relative">
      <div ref={ref} className={`flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] ${className}`} {...props}>
        {children}
      </div>
      {more && (
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l ${FADE[fade]}`} />
      )}
    </div>
  )
}
