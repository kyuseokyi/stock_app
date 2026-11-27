import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from './sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
import { Select, SelectTrigger, SelectValue } from './select'
import { Switch } from './switch'

describe('Radix 부품', () => {
  it('Dialog: 열고 ESC 로 닫으면 포커스가 버튼으로 돌아온다', async () => {
    const user = userEvent.setup()
    render(<Dialog><DialogTrigger>열기</DialogTrigger><DialogContent><DialogTitle>확인</DialogTitle><DialogDescription>설명</DialogDescription></DialogContent></Dialog>)
    const trigger = screen.getByRole('button', { name: '열기' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '확인' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('Sheet: 아래에서 열리는 변형', async () => {
    const user = userEvent.setup()
    render(<Sheet><SheetTrigger>필터</SheetTrigger><SheetContent side="bottom"><SheetTitle>필터 설정</SheetTitle></SheetContent></Sheet>)
    await user.click(screen.getByRole('button', { name: '필터' }))
    expect(screen.getByRole('dialog', { name: '필터 설정' }).className).toContain('bottom-0')
  })
  it('Tabs: 화살표 키로 다음 탭', async () => {
    const user = userEvent.setup()
    render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">급등</TabsTrigger><TabsTrigger value="b">급락</TabsTrigger></TabsList>
      <TabsContent value="a">급등 목록</TabsContent><TabsContent value="b">급락 목록</TabsContent></Tabs>)
    await user.click(screen.getByRole('tab', { name: '급등' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '급락' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('급락 목록')).toBeInTheDocument()
  })
  it('Select: 자리표시 문구를 보여 준다', () => {
    render(<Select><SelectTrigger aria-label="정렬"><SelectValue placeholder="정렬 선택" /></SelectTrigger></Select>)
    expect(screen.getByRole('combobox', { name: '정렬' })).toHaveTextContent('정렬 선택')
  })
  it('Switch: 누르면 켜진다', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="노출" />)
    const s = screen.getByRole('switch', { name: '노출' })
    expect(s).toHaveAttribute('aria-checked', 'false')
    await user.click(s)
    expect(s).toHaveAttribute('aria-checked', 'true')
  })
})
