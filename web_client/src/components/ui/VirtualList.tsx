import { useLayoutEffect, useRef, useState, type Key, type ReactNode, type RefObject } from 'react'
import {
  measureElement,
  useVirtualizer,
  useWindowVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual'

/** 이 개수 미만이면 가상 스크롤 없이 전부 그린다 — 짧은 목록은 모양·Ctrl+F·테스트가 그대로다. */
export const VIRTUAL_THRESHOLD = 60
const OVERSCAN = 8

export interface VirtualListProps<T> {
  items: T[]
  getKey: (item: T) => Key
  /** <li> 안쪽 내용 */
  renderItem: (item: T, index: number) => ReactNode
  itemClassName?: (item: T, index: number) => string | undefined
  /** 한 줄 예상 높이(px) — 실제 높이는 그린 뒤 잰다 */
  estimateSize: number
  /** 가상 모드 줄 간격(px). space-y 는 margin 이라 실측에 안 잡혀서, 주면 부품이 flex column + row-gap 을 직접 건다 */
  gap?: number
  as?: 'ul' | 'ol'
  /** 일반 모드 ul/ol 클래스 */
  className?: string
  /** 가상 모드 ul/ol 클래스 — className 을 대신 쓰지 않는다(space-y 같은 margin 이 섞이면 높이 계산이 어긋남) */
  virtualClassName?: string
  /** 가상 모드 바깥 상자 클래스 — 그리드 자식 클래스(min-w-0, self-start 등)를 여기로 */
  wrapperClassName?: string
  threshold?: number
}

/** 페이징 없이 한 번에 그리는 긴 목록용. 가장 가까운 스크롤 상자(없으면 창)를 기준으로 보이는 줄만 그린다. */
export default function VirtualList<T>(props: VirtualListProps<T>) {
  const { items, threshold = VIRTUAL_THRESHOLD } = props
  if (items.length < threshold) return <PlainList {...props} />
  return <VirtualMode {...props} />
}

function PlainList<T>({ items, getKey, renderItem, itemClassName, as = 'ul', className }: VirtualListProps<T>) {
  const Tag = as
  return (
    <Tag className={className}>
      {items.map((item, i) => (
        <li key={getKey(item)} className={itemClassName?.(item, i)}>
          {renderItem(item, i)}
        </li>
      ))}
    </Tag>
  )
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node && node !== document.body && node !== document.documentElement) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll') return node
    node = node.parentElement
  }
  return null
}

function VirtualMode<T>(props: VirtualListProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null)
  // undefined = 아직 못 찾음, null = 창(window) 스크롤
  const [scroller, setScroller] = useState<HTMLElement | null | undefined>(undefined)
  // 부모가 다시 그릴 때마다 다시 찾는다 — React 가 같은 DOM 을 다른 자리에 재사용하면(조상 overflow 가 바뀜)
  // 처음 찾은 상자가 더는 스크롤 상자가 아니어서 전 줄을 그리게 된다. 스크롤 중 재렌더는 Body 안에서만 일어나 비용 없음.
  // 같은 상자면 prev 를 그대로 돌려줘 다시 그리지 않으므로 무한 갱신이 없다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const found = findScrollParent(hostRef.current)
    setScroller((prev) => (prev === found ? prev : found))
  })
  const margin = useScrollMargin(hostRef, scroller, props.items.length)

  return (
    <div ref={hostRef} className={props.wrapperClassName}>
      {scroller === undefined ? null : scroller ? (
        <ElementBody {...props} scroller={scroller} margin={margin} />
      ) : (
        <WindowBody {...props} margin={margin} />
      )}
    </div>
  )
}

/** 목록 윗변이 스크롤 내용 맨 위에서 떨어진 거리(px). 창 크기 변경·항목 수 변경 때 다시 잰다. */
function useScrollMargin(hostRef: RefObject<HTMLDivElement | null>, scroller: HTMLElement | null | undefined, count: number) {
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    if (scroller === undefined) return
    const measure = () => {
      const host = hostRef.current
      if (!host) return
      const top = host.getBoundingClientRect().top
      setMargin(
        scroller
          ? Math.round(top - scroller.getBoundingClientRect().top + scroller.scrollTop)
          : Math.round(top + window.scrollY),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hostRef, scroller, count])
  return margin
}

/** jsdom·숨김 상태에서는 높이가 0 으로 잡힌다 — 0 이면 예상 높이를 써서 전 줄이 한꺼번에 그려지는 것을 막는다. */
function measureOrEstimate<S extends Element | Window>(estimate: number) {
  return (el: Element, entry: ResizeObserverEntry | undefined, inst: Virtualizer<S, Element>) => {
    const size = measureElement(el, entry, inst)
    return size > 0 ? size : estimate
  }
}

type BodyProps<T> = VirtualListProps<T> & { margin: number }

function ElementBody<T>(props: BodyProps<T> & { scroller: HTMLElement }) {
  const v = useVirtualizer<HTMLElement, Element>({
    count: props.items.length,
    getScrollElement: () => props.scroller,
    estimateSize: () => props.estimateSize,
    gap: props.gap,
    overscan: OVERSCAN,
    scrollMargin: props.margin,
    initialRect: { width: 0, height: 800 },
    measureElement: measureOrEstimate<HTMLElement>(props.estimateSize),
  })
  return <Rows {...props} v={v} />
}

function WindowBody<T>(props: BodyProps<T>) {
  const v = useWindowVirtualizer<Element>({
    count: props.items.length,
    estimateSize: () => props.estimateSize,
    gap: props.gap,
    overscan: OVERSCAN,
    scrollMargin: props.margin,
    initialRect: { width: 0, height: 800 },
    measureElement: measureOrEstimate<Window>(props.estimateSize),
  })
  return <Rows {...props} v={v} />
}

function Rows<T>({
  v,
  margin,
  items,
  getKey,
  renderItem,
  itemClassName,
  as = 'ul',
  virtualClassName,
  gap,
}: BodyProps<T> & { v: Virtualizer<HTMLElement, Element> | Virtualizer<Window, Element> }) {
  const Tag = as
  const vItems = v.getVirtualItems()
  const offset = (vItems[0]?.start ?? margin) - margin
  return (
    <div style={{ position: 'relative', height: v.getTotalSize() }}>
      <Tag
        className={virtualClassName}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${offset}px)`,
          // 계산에 쓴 gap 과 화면 간격을 반드시 일치시킨다 — 클래스로 맡기면 빠뜨렸을 때 끝에 빈 공간이 생긴다.
          ...(gap ? { display: 'flex', flexDirection: 'column', rowGap: gap } : null),
        }}
      >
        {vItems.map((vi) => {
          const item = items[vi.index]
          return (
            <li key={getKey(item)} data-index={vi.index} ref={v.measureElement} className={itemClassName?.(item, vi.index)}>
              {renderItem(item, vi.index)}
            </li>
          )
        })}
      </Tag>
    </div>
  )
}
