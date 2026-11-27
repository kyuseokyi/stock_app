import { describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmHost, confirmAction } from './confirm'

describe('confirmAction (브라우저 confirm 대체)', () => {
  it('첫 줄은 제목, 나머지는 설명으로 띄우고 [확인]이면 true', async () => {
    render(<ConfirmHost />)
    let p!: Promise<boolean>
    act(() => {
      p = confirmAction('예약을 취소할까요?\n보낸 알림은 되돌릴 수 없어요.')
    })
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent('예약을 취소할까요?')
    expect(screen.getByText('보낸 알림은 되돌릴 수 없어요.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    await expect(p).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('[취소]·Esc 는 false, 처음 포커스는 [취소]', async () => {
    render(<ConfirmHost />)
    let p1!: Promise<boolean>
    act(() => {
      p1 = confirmAction('삭제할까요?')
    })
    await screen.findByRole('alertdialog')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' })))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    await expect(p1).resolves.toBe(false)

    let p2!: Promise<boolean>
    act(() => {
      p2 = confirmAction('정말요?')
    })
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')
    await expect(p2).resolves.toBe(false)
  })

  it('한꺼번에 여러 번 부르면 차례대로 하나씩 띄운다', async () => {
    render(<ConfirmHost />)
    let a!: Promise<boolean>
    let b!: Promise<boolean>
    act(() => {
      a = confirmAction('첫 번째?')
      b = confirmAction('두 번째?')
    })
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('첫 번째?')
    await userEvent.click(screen.getByRole('button', { name: '확인' }))
    await expect(a).resolves.toBe(true)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('두 번째?'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    await expect(b).resolves.toBe(false)
  })

  it('danger 면 실행 버튼을 위험 색으로, 버튼 문구를 바꿀 수 있다', async () => {
    render(<ConfirmHost />)
    let p!: Promise<boolean>
    act(() => {
      p = confirmAction('이 게시글을 삭제할까요?', { danger: true, confirmLabel: '삭제' })
    })
    const btn = await screen.findByRole('button', { name: '삭제' })
    expect(btn.className).toContain('bg-danger')
    await userEvent.click(btn)
    await expect(p).resolves.toBe(true)
  })
})
