import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FullScreenSheet } from './full-screen-sheet'

describe('FullScreenSheet', () => {
  it('제목으로 이름 붙은 대화상자, 처음 포커스는 [닫기], Esc·[닫기] 모두 onClose', async () => {
    const onClose = vi.fn()
    render(
      <FullScreenSheet title="상세" onClose={onClose}>
        <p>본문</p>
      </FullScreenSheet>,
    )
    const dlg = screen.getByRole('dialog', { name: '상세' })
    expect(dlg).toHaveTextContent('본문')
    // 뒤 화면 스크롤 잠금 — Radix 는 Overlay 가 있어야 건다(빼먹으면 잠기지 않음)
    await waitFor(() => expect(document.body).toHaveAttribute('data-scroll-locked'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '닫기' })))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
