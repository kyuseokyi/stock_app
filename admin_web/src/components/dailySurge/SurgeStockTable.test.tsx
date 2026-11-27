import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SurgeStock } from '../../api/dailySurge'
import SurgeStockTable from './SurgeStockTable'

function stock(over: Partial<SurgeStock> = {}): SurgeStock {
  return {
    date: '2026-11-27', ticker: '005930', name: '삼성전자', market: 'KOSPI',
    close: 60000, prev_close: 54000, change_price: 6000, change_rate: 11.11,
    volume: 1_000_000, volume_ratio: 250, trading_value: 60_000_000_000,
    is_surge: true, is_plunge: false, is_top_value: false,
    surge_rank: 1, plunge_rank: null, value_rank: null,
    primary_theme_id: null, primary_theme_name: '반도체', is_theme_leader: true,
    dart_items: [], dart_keywords: [], themes: [], sector_name: '전기전자', rank: 1,
    ...over,
  }
}

describe('SurgeStockTable', () => {
  it('좁은 화면용 카드 목록은 표 없이 종목을 보여 주고 누르면 선택된다', () => {
    const onSelect = vi.fn()
    const items = [stock(), stock({ ticker: '000660', name: 'SK하이닉스', rank: 2 })]
    const { container } = render(<SurgeStockTable items={items} selected="000660" onSelect={onSelect} />)

    const list = container.querySelector('ul')!
    expect(list.className).toContain('md:hidden')
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getAllByText(/대장 · 반도체 \(동반 묶음\) · 업종 전기전자/)).toHaveLength(2)

    fireEvent.click(buttons[0])
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it('표는 넓은 화면(md 이상)에서만 보인다', () => {
    render(<SurgeStockTable items={[stock()]} selected={null} onSelect={() => {}} />)
    const wrap = screen.getByRole('table').parentElement!
    expect(wrap.className).toContain('hidden')
    expect(wrap.className).toContain('md:block')
  })
})
