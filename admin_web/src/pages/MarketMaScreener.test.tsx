// @vitest-environment jsdom
// 관리자 5·20 정배열 스크리너 — 로딩·성공·준비 중·빈·오류·모드 변경·더 보기·선택 유지.
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, renderWithClient } from '../test/query'
import type { MaScreenerFilterInput, MaScreenerItem, MaScreenerResult, MaSort } from '../api/maScreener'

const getMaScreener = vi.fn<(f: MaScreenerFilterInput, sort: MaSort, offset?: number) => Promise<MaScreenerResult>>()
vi.mock('../api/maScreener', () => ({
  MA_PAGE_SIZE: 50,
  getMaScreener: (f: MaScreenerFilterInput, s: MaSort, o?: number) => getMaScreener(f, s, o),
  getScreenerDataset: () => Promise.resolve({ date: null, total: 0 }),
}))
vi.mock('../api/marketAdmin', () => ({ getMarketStatus: () => Promise.resolve({ ref_date: null, datasets: [] }) }))
vi.mock('../components/maScreener/MaScreenerDetail', () => ({ default: ({ item }: { item: MaScreenerItem }) => <div>상세 {item.ticker}</div> }))

import MarketMaScreener from './MarketMaScreener'

const item = (t: string): MaScreenerItem => ({
  ticker: t, name: `종목${t}`, market: 'KOSPI', sectorName: null, close: 1000, chg1d: 1, value: 1e9, mcap: null,
  volRatio20: null, rsi14: null, maOrder: 1, vpAbovePct: null, per: null, pbr: null, roe: null, volume: null,
  ma5: null, ma20: null, ma50: null, ma5Ma20SpreadPct: null,
} as MaScreenerItem)
const res = (date: string | null, total: number, ts: string[]): MaScreenerResult => ({ date, total, items: ts.map(item) })

beforeEach(() => {
  getMaScreener.mockReset()
})

describe('MarketMaScreener', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getMaScreener.mockReturnValue(deferred<MaScreenerResult>().promise)
    renderWithClient(<MarketMaScreener />)
    expect(await screen.findByText('목록을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 목록·기준일·개수', async () => {
    getMaScreener.mockResolvedValue(res('2026-11-26', 2, ['A', 'B']))
    renderWithClient(<MarketMaScreener />)
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.getByText('2026-11-26 종가 기준 · 2개 종목')).toBeTruthy()
    expect(getMaScreener.mock.calls[0][2]).toBeUndefined()
    expect(getMaScreener.mock.calls[0][0].maOrder).toBe('MA5_20')
  })

  it('기준일이 없으면 준비 중, 비어 있으면 빈 안내', async () => {
    getMaScreener.mockResolvedValueOnce(res(null, 0, []))
    const v = renderWithClient(<MarketMaScreener />)
    expect(await screen.findByText('조건검색 데이터를 준비하고 있어요')).toBeTruthy()
    v.unmount()
    getMaScreener.mockResolvedValueOnce(res('2026-11-26', 0, []))
    renderWithClient(<MarketMaScreener />)
    expect(await screen.findByText('조건에 맞는 종목이 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내', async () => {
    getMaScreener.mockRejectedValue(new Error('x'))
    renderWithClient(<MarketMaScreener />)
    expect(await screen.findByText('목록을 불러오지 못했어요')).toBeTruthy()
  })

  it('모드를 바꾸면 그 모드로 다시 불러온다', async () => {
    getMaScreener.mockImplementation(async (f) => (f.maOrder === 'CLOSE_MA5_20' ? res('2026-11-26', 1, ['S']) : res('2026-11-26', 1, ['A'])))
    renderWithClient(<MarketMaScreener />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: /5일선 위 강세/ }))
    expect(await screen.findByText('종목S')).toBeTruthy()
    expect(screen.queryByText('종목A')).toBeNull()
  })

  it('더 보기는 이어 붙인다', async () => {
    getMaScreener.mockImplementation(async (_f, _s, offset) => (offset ? res('2026-11-26', 3, ['C']) : res('2026-11-26', 3, ['A', 'B'])))
    renderWithClient(<MarketMaScreener />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(getMaScreener.mock.lastCall?.[2]).toBe(2)
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
  })

  it('고른 종목은 새 목록에 있으면 유지, 없으면 닫는다', async () => {
    getMaScreener.mockImplementation(async (f) => {
      if (f.maOrder === 'CLOSE_MA5_20') return res('2026-11-26', 2, ['B', 'A'])
      if (f.maOrder === 'PULLBACK_MA5_20') return res('2026-11-26', 1, ['C'])
      return res('2026-11-26', 2, ['A', 'B'])
    })
    renderWithClient(<MarketMaScreener />)
    fireEvent.click(await screen.findByRole('button', { name: /종목A/ }))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /5일선 위 강세/ }))
    await waitFor(() => expect(getMaScreener).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /5·20 눌림목/ }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText(/상세/)).toBeNull()
  })
})
