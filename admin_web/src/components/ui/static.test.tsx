import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'
import { Card, CardHeader, CardTitle, CardContent } from './card'
import { Chip } from './chip'
import { Skeleton } from './skeleton'
import { EmptyState } from './empty-state'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'

describe('정적 부품', () => {
  it('Badge 상승·하락 변형', () => {
    render(<><Badge variant="up">+3.2%</Badge><Badge variant="down">-1.0%</Badge></>)
    expect(screen.getByText('+3.2%').className).toContain('bg-up-soft')
    expect(screen.getByText('-1.0%').className).toContain('bg-down-soft')
  })
  it('Card 는 surface 바탕과 card 모서리', () => {
    render(<Card data-testid="c"><CardHeader><CardTitle>제목</CardTitle></CardHeader><CardContent>본문</CardContent></Card>)
    expect(screen.getByTestId('c').className).toContain('bg-surface')
    expect(screen.getByTestId('c').className).toContain('rounded-card')
    expect(screen.getByText('제목')).toBeInTheDocument()
  })
  it('Chip 선택 상태는 aria-pressed 와 brand-soft', () => {
    render(<Chip selected>전체</Chip>)
    const c = screen.getByRole('button', { name: '전체' })
    expect(c).toHaveAttribute('aria-pressed', 'true')
    expect(c.className).toContain('bg-brand-soft')
  })
  it('Skeleton 은 스크린리더에서 숨긴다', () => {
    render(<Skeleton data-testid="s" />)
    expect(screen.getByTestId('s')).toHaveAttribute('aria-hidden', 'true')
  })
  it('EmptyState 제목·설명', () => {
    render(<EmptyState title="결과 없음" description="조건을 바꿔 보세요" />)
    expect(screen.getByText('결과 없음')).toBeInTheDocument()
    expect(screen.getByText('조건을 바꿔 보세요')).toBeInTheDocument()
  })
  it('Table 숫자 칸은 tabular-nums', () => {
    render(<Table><TableHeader><TableRow><TableHead>종목</TableHead></TableRow></TableHeader>
      <TableBody><TableRow><TableCell numeric>1,234</TableCell></TableRow></TableBody></Table>)
    expect(screen.getByText('1,234').className).toContain('tabular-nums')
  })
})
