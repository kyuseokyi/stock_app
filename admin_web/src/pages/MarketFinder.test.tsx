// @vitest-environment jsdom
// 관리자 조건검색 — 로딩·성공·준비 중·빈·오류(다시 시도)·정렬 변경·더 보기(중복 제거·실패 안내)·선택 유지.
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, renderWithClient } from '../test/query'
import type { FinderItem, FinderQuery, FinderScreen } from '../types/finder'

const getFinderScreen = vi.fn<(q: FinderQuery, offset?: number) => Promise<FinderScreen>>()
vi.mock('../api/finder', () => ({ getFinderScreen: (q: FinderQuery, o?: number) => getFinderScreen(q, o) }))
vi.mock('../api/maScreener', () => ({ getScreenerDataset: vi.fn() }))
vi.mock('../components/market/ScreenDatasetStatus', () => ({ default: () => null }))
vi.mock('../components/finder/FinderDetail', () => ({ default: ({ item }: { item: FinderItem }) => <div>상세 {item.ticker}</div> }))

import FinderTab from './MarketFinder'

const item = (t: string): FinderItem => ({
  ticker: t, name: `종목${t}`, market: 'KOSPI', sectorName: null, close: 1000, chg1d: 1, value: 1e9, mcap: null,
  volRatio20: null, rsi14: null, maOrder: 0, isNewHigh: false, gcDays: null, vpAbovePct: null, per: null, pbr: null,
  roe: null, bbPosition: null, bbWidthPct: null,
})
const scr = (date: string | null, total: number, ts: string[]): FinderScreen => ({ date, total, bbSigma: 2, items: ts.map(item) })

beforeEach(() => {
  getFinderScreen.mockReset()
})

describe('MarketFinder', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getFinderScreen.mockReturnValue(deferred<FinderScreen>().promise)
    renderWithClient(<FinderTab />)
    expect(await screen.findByText('목록을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 목록·개수', async () => {
    getFinderScreen.mockResolvedValue(scr('2026-11-26', 2, ['A', 'B']))
    renderWithClient(<FinderTab />)
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.getByText('2개 종목')).toBeTruthy()
    expect(screen.getByText(/2026-11-26 종가 기준/)).toBeTruthy()
    expect(getFinderScreen.mock.calls[0][1]).toBeUndefined()
  })

  it('기준일이 없으면 준비 중, 비어 있으면 빈 안내', async () => {
    getFinderScreen.mockResolvedValueOnce(scr(null, 0, []))
    renderWithClient(<FinderTab />)
    expect(await screen.findByText('조건검색 데이터를 준비하고 있어요')).toBeTruthy()
    cleanup()
    getFinderScreen.mockResolvedValueOnce(scr('2026-11-26', 0, []))
    renderWithClient(<FinderTab />)
    expect(await screen.findByText('조건에 맞는 종목이 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내, 다시 시도로 다시 불러온다', async () => {
    getFinderScreen.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(scr('2026-11-26', 1, ['A']))
    renderWithClient(<FinderTab />)
    expect(await screen.findByText('목록을 불러오지 못했어요')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.queryByText('목록을 불러오지 못했어요')).toBeNull()
    expect(getFinderScreen).toHaveBeenCalledTimes(2)
  })

  it('정렬을 바꾸면 그 정렬로 다시 불러온다', async () => {
    getFinderScreen.mockImplementation(async (q) => (q.sort === 'chg' ? scr('2026-11-26', 1, ['C']) : scr('2026-11-26', 1, ['A'])))
    renderWithClient(<FinderTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '등락률' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText('종목A')).toBeNull()
    expect(getFinderScreen.mock.lastCall?.[0].sort).toBe('chg')
  })

  it('더 보기는 이어 붙이며 겹치는 종목은 뺀다', async () => {
    getFinderScreen.mockImplementation(async (_q, offset) => (offset ? scr('2026-11-26', 3, ['B', 'C']) : scr('2026-11-26', 3, ['A', 'B'])))
    renderWithClient(<FinderTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(getFinderScreen.mock.lastCall?.[1]).toBe(2)
    expect(screen.getAllByText('종목B')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
  })

  it('더 보기가 실패하면 안내, 다시 누르면 지운다', async () => {
    let failMore = true
    getFinderScreen.mockImplementation(async (_q, offset) => {
      if (offset && failMore) throw new Error('x')
      return offset ? scr('2026-11-26', 3, ['C']) : scr('2026-11-26', 3, ['A', 'B'])
    })
    renderWithClient(<FinderTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('더 불러오지 못했어요. 다시 눌러 주세요.')).toBeTruthy()
    failMore = false
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText('더 불러오지 못했어요. 다시 눌러 주세요.')).toBeNull()
  })

  it('고른 종목은 새 목록에 있으면 유지, 없으면 닫는다', async () => {
    getFinderScreen.mockImplementation(async (q) => {
      if (q.sort === 'chg') return scr('2026-11-26', 2, ['B', 'A'])
      if (q.sort === 'rsi') return scr('2026-11-26', 1, ['C'])
      return scr('2026-11-26', 2, ['A', 'B'])
    })
    renderWithClient(<FinderTab />)
    fireEvent.click(await screen.findByRole('button', { name: /종목A/ }))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '등락률' }))
    await waitFor(() => expect(getFinderScreen.mock.lastCall?.[0].sort).toBe('chg'))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'RSI' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText(/상세/)).toBeNull()
  })
})
