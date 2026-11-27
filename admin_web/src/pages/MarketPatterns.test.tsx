// @vitest-environment jsdom
// 관리자 차트 패턴 — 로딩·성공·준비 중·빈·오류(다시 시도)·조건 변경·더 보기(중복 제거·실패 안내)·선택 유지.
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, renderWithClient } from '../test/query'
import type { PatternItem, PatternQuery, PatternScreen } from '../leaders/types/patterns'

const getPatternScreen = vi.fn<(q: PatternQuery, offset?: number) => Promise<PatternScreen>>()
vi.mock('../leaders/api/patterns', () => ({ getPatternDataset: vi.fn(), getPatternScreen: (q: PatternQuery, o?: number) => getPatternScreen(q, o) }))
vi.mock('../components/market/ScreenDatasetStatus', () => ({ default: () => null }))
vi.mock('../components/patterns/PatternDetail', () => ({ default: ({ item }: { item: PatternItem }) => <div>상세 {item.ticker}</div> }))

import PatternsTab from './MarketPatterns'

const item = (t: string): PatternItem => ({
  ticker: t, name: `종목${t}`, market: 'KOSPI', sectorName: null, close: 1000, patternType: 'cup', label: '컵', stage: 1,
  pivot: 1100, pivotDistPct: 3, depth: 20, length: 30, isActive: true, breakoutDate: null, breakoutPricePct: null,
  breakoutVolPct: null, daysSinceBreakout: null,
})
const scr = (date: string | null, total: number, ts: string[]): PatternScreen => ({ date, total, items: ts.map(item) })

beforeEach(() => {
  getPatternScreen.mockReset()
})

describe('MarketPatterns', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getPatternScreen.mockReturnValue(deferred<PatternScreen>().promise)
    renderWithClient(<PatternsTab />)
    expect(await screen.findByText('목록을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 목록·개수', async () => {
    getPatternScreen.mockResolvedValue(scr('2026-11-26', 2, ['A', 'B']))
    renderWithClient(<PatternsTab />)
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.getByText('2개 종목')).toBeTruthy()
    expect(screen.getByText(/2026-11-26 종가 기준/)).toBeTruthy()
    expect(getPatternScreen.mock.calls[0][0]).toEqual({ report: 'forming', patternType: null, market: 'ALL', sort: 'pivot_dist' })
  })

  it('기준일이 없으면 준비 중, 비어 있으면 빈 안내', async () => {
    getPatternScreen.mockResolvedValueOnce(scr(null, 0, []))
    renderWithClient(<PatternsTab />)
    expect(await screen.findByText('패턴 데이터를 준비하고 있어요')).toBeTruthy()
    cleanup()
    getPatternScreen.mockResolvedValueOnce(scr('2026-11-26', 0, []))
    renderWithClient(<PatternsTab />)
    expect(await screen.findByText('조건에 맞는 종목이 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내, 다시 시도로 다시 불러온다', async () => {
    getPatternScreen.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(scr('2026-11-26', 1, ['A']))
    renderWithClient(<PatternsTab />)
    expect(await screen.findByText('목록을 불러오지 못했어요')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('종목A')).toBeTruthy()
    expect(screen.queryByText('목록을 불러오지 못했어요')).toBeNull()
    expect(getPatternScreen).toHaveBeenCalledTimes(2)
  })

  it('리포트를 바꾸면 그 리포트로 다시 불러온다', async () => {
    getPatternScreen.mockImplementation(async (q) => (q.report === 'near_pivot' ? scr('2026-11-26', 1, ['N']) : scr('2026-11-26', 1, ['A'])))
    renderWithClient(<PatternsTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '피벗 근접' }))
    expect(await screen.findByText('종목N')).toBeTruthy()
    expect(screen.queryByText('종목A')).toBeNull()
    expect(getPatternScreen.mock.lastCall?.[0].report).toBe('near_pivot')
  })

  it('더 보기는 이어 붙이며 겹치는 종목은 뺀다', async () => {
    getPatternScreen.mockImplementation(async (_q, offset) => (offset ? scr('2026-11-26', 3, ['B', 'C']) : scr('2026-11-26', 3, ['A', 'B'])))
    renderWithClient(<PatternsTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(getPatternScreen.mock.lastCall?.[1]).toBe(2)
    expect(screen.getAllByText('종목B')).toHaveLength(1)
  })

  it('더 보기가 실패하면 안내, 다시 누르면 지운다', async () => {
    let failMore = true
    getPatternScreen.mockImplementation(async (_q, offset) => {
      if (offset && failMore) throw new Error('x')
      return offset ? scr('2026-11-26', 3, ['C']) : scr('2026-11-26', 3, ['A', 'B'])
    })
    renderWithClient(<PatternsTab />)
    await screen.findByText('종목A')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('더 불러오지 못했어요. 다시 눌러 주세요.')).toBeTruthy()
    failMore = false
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText('더 불러오지 못했어요. 다시 눌러 주세요.')).toBeNull()
  })

  it('고른 종목은 새 목록에 있으면 유지, 없으면 닫는다', async () => {
    getPatternScreen.mockImplementation(async (q) => {
      if (q.sort === 'depth') return scr('2026-11-26', 2, ['B', 'A'])
      if (q.sort === 'length') return scr('2026-11-26', 1, ['C'])
      return scr('2026-11-26', 2, ['A', 'B'])
    })
    renderWithClient(<PatternsTab />)
    fireEvent.click(await screen.findByRole('button', { name: /종목A/ }))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '깊이' }))
    await waitFor(() => expect(getPatternScreen.mock.lastCall?.[0].sort).toBe('depth'))
    expect(await screen.findByText('상세 A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '길이' }))
    expect(await screen.findByText('종목C')).toBeTruthy()
    expect(screen.queryByText(/상세/)).toBeNull()
  })
})
