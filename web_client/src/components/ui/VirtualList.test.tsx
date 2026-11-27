// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import VirtualList, { VIRTUAL_THRESHOLD } from './VirtualList'

beforeAll(() => {
  // jsdom 에는 ResizeObserver 가 없다 — 가상 스크롤이 상자 크기를 지켜볼 때 쓴다.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `사용자${i + 1}` }))

function List({ n, threshold }: { n: number; threshold?: number }) {
  return (
    <VirtualList
      as="ol"
      items={rows(n)}
      getKey={(r) => r.id}
      estimateSize={40}
      threshold={threshold}
      className="space-y-1"
      virtualClassName="flex flex-col"
      gap={4}
      itemClassName={(r) => (r.id === 3 ? 'mine' : undefined)}
      renderItem={(r) => <span>{r.name}</span>}
    />
  )
}

describe('VirtualList', () => {
  it('기준 미만이면 가상 스크롤 없이 전부 그리고 기존 클래스를 그대로 쓴다', () => {
    render(<List n={VIRTUAL_THRESHOLD - 1} />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(list.className).toBe('space-y-1')
    expect(screen.getAllByRole('listitem')).toHaveLength(VIRTUAL_THRESHOLD - 1)
    expect(screen.getByText('사용자3').closest('li')?.className).toBe('mine')
  })

  it('기준 이상이면 보이는 줄과 앞뒤 여유만 그린다(창 스크롤)', () => {
    render(<List n={500} />)
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(100)
    expect(screen.getByText('사용자1')).toBeTruthy()
    expect(screen.queryByText('사용자500')).toBeNull()
    const list = screen.getByRole('list')
    expect(list.className).toBe('flex flex-col')
    // 계산에 쓴 gap 이 화면 간격으로도 걸린다(클래스에 gap-* 를 빠뜨려도 끝에 빈 공간이 안 생김)
    expect(list.style.rowGap).toBe('4px')
  })

  it('가상 모드에서는 일반 모드 className(space-y 등 margin)을 대신 쓰지 않는다', () => {
    render(
      <VirtualList
        items={rows(200)}
        getKey={(r) => r.id}
        estimateSize={40}
        className="space-y-1"
        renderItem={(r) => <span>{r.name}</span>}
      />,
    )
    expect(screen.getByRole('list').className).toBe('')
  })

  it('가장 가까운 스크롤 상자 안에서도 일부만 그린다(모달 본문)', () => {
    // jsdom 은 배치 계산을 안 해서 clientHeight 가 늘 0 — 인라인 height 를 돌려주게 해 실제 상자를 흉내 낸다.
    // clientHeight 는 Element.prototype 에 있다 — HTMLElement.prototype 에 덮어 두고 끝나면 지운다.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return parseInt(this.style.height, 10) || 0
      },
    })
    onTestFinished(() => {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    })
    render(
      <div style={{ overflowY: 'auto', height: 400 }}>
        <List n={300} />
      </div>,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(100)
    expect(screen.queryByText('사용자300')).toBeNull()
  })

  it('가상 모드에서도 줄마다 itemClassName 이 붙는다', () => {
    render(<List n={200} />)
    expect(screen.getByText('사용자3').closest('li')?.className).toBe('mine')
    expect(screen.getByText('사용자1').closest('li')?.className ?? '').toBe('')
  })
})
