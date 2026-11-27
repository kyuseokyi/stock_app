// @vitest-environment jsdom
// 관리자 주도주 — 로딩·성공·준비 중·빈·오류·필터 변경·더 보기·선택 유지·시장 띠(불러오는 동안 직전 값).
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, renderWithClient } from '../test/query'
import type { CanslimItem, CanslimMarket, CanslimScreen, ScreenFilters } from '../leaders/types/screener'

type R = { markets: CanslimMarket[]; screen: CanslimScreen }
const getCanslimScreen = vi.fn<(f: ScreenFilters, offset?: number) => Promise<R>>()
vi.mock('../leaders/api/screener', () => ({ PAGE_SIZE: 50, getCanslimScreen: (f: ScreenFilters, o?: number) => getCanslimScreen(f, o) }))
vi.mock('../api/marketAdmin', () => ({ getMarketStatus: () => Promise.resolve({ datasets: [] }) }))
vi.mock('../leaders/components/screener/TodayPicks', () => ({ default: () => null }))
vi.mock('../leaders/components/screener/CanslimDetail', () => ({ default: ({ ticker }: { ticker: string }) => <div>상세 {ticker}</div> }))
vi.mock('../leaders/components/screener/MarketStrip', () => ({
  default: ({ markets, date, loading }: { markets: CanslimMarket[]; date: string | null; loading: boolean }) => (
    <div>띠 {markets.map((m) => m.market).join(',')} {date ?? '-'} {loading ? '로딩' : '끝'}</div>
  ),
}))
vi.mock('../leaders/components/screener/CanslimFilters', () => ({
  default: ({ value, onChange }: { value: ScreenFilters; onChange: (v: ScreenFilters) => void }) => (
    <button type="button" onClick={() => onChange({ ...value, minPass: 7 })}>필터 바꾸기</button>
  ),
}))

import MarketLeaders from './MarketLeaders'

const item = (t: string): CanslimItem => ({
  ticker: t, name: `종목${t}`, market: 'KOSPI', sectorName: null, close: 1000, score: 80, passCount: 6, liquid: true,
  letters: {} as CanslimItem['letters'], rs: null, pctFromHigh: null,
})
const mk = (m: string): CanslimMarket => ({ market: m, date: '2026-11-26', status: '상승 추세', close: 1, ma50: 1, ma200: 1, distributionDays: 0 })
const res = (date: string | null, total: number, ts: string[], markets = [mk('KOSPI')]): R => ({ markets, screen: { date, total, items: ts.map(item) } })

beforeEach(() => {
  getCanslimScreen.mockReset()
})

describe('MarketLeaders', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getCanslimScreen.mockReturnValue(deferred<R>().promise)
    renderWithClient(<MarketLeaders />)
    expect(await screen.findByText('목록을 불러오고 있어요')).toBeTruthy()
    expect(screen.getByText('띠 - 로딩')).toBeTruthy()
  })

  it('성공하면 목록·개수·시장 띠', async () => {
    getCanslimScreen.mockResolvedValue(res('2026-11-26', 2, ['A', 'B']))
    renderWithClient(<MarketLeaders />)
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.getByText('2개 종목')).toBeTruthy()
    expect(screen.getByText('띠 KOSPI 2026-11-26 끝')).toBeTruthy()
    expect(getCanslimScreen.mock.calls[0][1]).toBeUndefined()
  })

  it('기준일이 없으면 준비 중, 비어 있으면 빈 안내', async () => {
    getCanslimScreen.mockResolvedValueOnce(res(null, 0, []))
    const v = renderWithClient(<MarketLeaders />)
    expect(await screen.findByText('분석 데이터를 준비하고 있어요')).toBeTruthy()
    v.unmount()
    getCanslimScreen.mockResolvedValueOnce(res('2026-11-26', 0, []))
    renderWithClient(<MarketLeaders />)
    expect(await screen.findByText('조건에 맞는 종목이 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내', async () => {
    getCanslimScreen.mockRejectedValue(new Error('x'))
    renderWithClient(<MarketLeaders />)
    expect(await screen.findByText('목록을 불러오지 못했어요')).toBeTruthy()
  })

  it('필터를 바꾸면 다시 불러오고, 그동안 시장 띠는 직전 값을 보인다', async () => {
    const next = deferred<R>()
    getCanslimScreen.mockResolvedValueOnce(res('2026-11-26', 1, ['A'])).mockReturnValueOnce(next.promise)
    renderWithClient(<MarketLeaders />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '필터 바꾸기' }))
    expect(await screen.findByText('띠 KOSPI 2026-11-26 로딩')).toBeTruthy()
    expect(getCanslimScreen.mock.lastCall?.[0].minPass).toBe(7)
    next.resolve(res('2026-11-27', 1, ['Z'], [mk('KOSDAQ')]))
    expect(await screen.findByText('종목Z')).toBeTruthy()
    expect(screen.getByText('띠 KOSDAQ 2026-11-27 끝')).toBeTruthy()
  })

  it('더 보기는 이어 붙인다', async () => {
    getCanslimScreen.mockImplementation(async (_f, offset) => (offset ? res('2026-11-26', 3, ['C']) : res('2026-11-26', 3, ['A', 'B'])))
    renderWithClient(<MarketLeaders />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(getCanslimScreen.mock.lastCall?.[1]).toBe(2)
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
  })

  it('고른 종목은 새 목록에 있으면 유지, 없으면 닫는다', async () => {
    getCanslimScreen
      .mockResolvedValueOnce(res('2026-11-26', 2, ['A', 'B']))
      .mockResolvedValueOnce(res('2026-11-26', 2, ['B', 'A']))
    renderWithClient(<MarketLeaders />)
    fireEvent.click(await screen.findByRole('button', { name: /종목A/ }))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '필터 바꾸기' }))
    await waitFor(() => expect(getCanslimScreen).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('상세 A')).toBeTruthy()
  })
})
