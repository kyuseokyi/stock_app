import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button'

describe('Button', () => {
  it('기본 변형은 primary 색과 btn 모서리', () => {
    render(<Button>저장</Button>)
    const b = screen.getByRole('button', { name: '저장' })
    expect(b.className).toContain('bg-primary')
    expect(b.className).toContain('rounded-btn')
    expect(b).toHaveAttribute('type', 'button')
  })
  it('variant·size 를 바꾼다', () => {
    render(<Button variant="outline" size="sm">취소</Button>)
    const b = screen.getByRole('button', { name: '취소' })
    expect(b.className).toContain('border-line')
    expect(b.className).toContain('h-8')
  })
  it('asChild 면 자식 요소로 그린다', () => {
    render(<Button asChild><a href="/x">이동</a></Button>)
    expect(screen.getByRole('link', { name: '이동' }).className).toContain('bg-primary')
  })
  it('비활성일 때 누를 수 없다', async () => {
    const fn = vi.fn()
    render(<Button disabled onClick={fn}>보내기</Button>)
    await userEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(fn).not.toHaveBeenCalled()
  })
})
