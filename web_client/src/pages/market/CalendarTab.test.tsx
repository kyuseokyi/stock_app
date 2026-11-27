// @vitest-environment jsdom
// 일정 탭 — 로딩·성공·오류·분류 바꾸기·탭 복귀 재조회. 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, refetchActiveFailing, renderWithClient, returnToTabAfterIdle } from '../../test/query'
import type { CalendarEvent } from '../../types/market'

const getMarketCalendar = vi.fn<(start: string, end: string, category?: string) => Promise<CalendarEvent[]>>()
vi.mock('../../api/market', () => ({ getMarketCalendar: (...a: [string, string, string?]) => getMarketCalendar(...a) }))

import CalendarTab from './CalendarTab'

const ev = (title: string, category = '공모주'): CalendarEvent => ({
  date: '2099-01-02', title, category, ticker: null, name: null, detail: '',
})

beforeEach(() => {
  getMarketCalendar.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CalendarTab', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getMarketCalendar.mockReturnValue(deferred<CalendarEvent[]>().promise)
    renderWithClient(<CalendarTab />)
    expect(await screen.findByText('일정을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 일정 목록', async () => {
    getMarketCalendar.mockResolvedValue([ev('삼성 청약')])
    renderWithClient(<CalendarTab />)
    expect(await screen.findByText('삼성 청약')).toBeTruthy()
    expect(screen.queryByText('일정을 불러오고 있어요')).toBeNull()
    expect(getMarketCalendar).toHaveBeenCalledTimes(1)
    expect(getMarketCalendar.mock.calls[0][2]).toBeUndefined()
  })

  it('비어 있으면 빈 안내', async () => {
    getMarketCalendar.mockResolvedValue([])
    renderWithClient(<CalendarTab />)
    expect(await screen.findByText('앞으로 60일 안에 잡힌 일정이 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내', async () => {
    getMarketCalendar.mockRejectedValue(new Error('x'))
    renderWithClient(<CalendarTab />)
    expect(await screen.findByText('일정을 불러오지 못했어요')).toBeTruthy()
  })

  it('분류를 바꾸면 그 분류로 다시 불러온다', async () => {
    getMarketCalendar.mockResolvedValueOnce([ev('삼성 청약')]).mockResolvedValueOnce([ev('CPI 발표', '경제지표')])
    renderWithClient(<CalendarTab />)
    await screen.findByText('삼성 청약')
    fireEvent.click(screen.getByRole('button', { name: '경제지표' }))
    expect(await screen.findByText('CPI 발표')).toBeTruthy()
    expect(getMarketCalendar.mock.calls[1][2]).toBe('경제지표')
    expect(screen.queryByText('삼성 청약')).toBeNull()
  })

  it('탭 복귀(10분 뒤)에 조용히 다시 받아 바꾸고, 실패하면 보이던 목록 유지', async () => {
    getMarketCalendar.mockResolvedValueOnce([ev('삼성 청약')]).mockResolvedValueOnce([ev('LG 청약')])
    renderWithClient(<CalendarTab />)
    await screen.findByText('삼성 청약')
    await returnToTabAfterIdle()
    expect(await screen.findByText('LG 청약')).toBeTruthy()
    expect(screen.queryByText('일정을 불러오고 있어요')).toBeNull()
    getMarketCalendar.mockRejectedValueOnce(new Error('x'))
    await returnToTabAfterIdle()
    await waitFor(() => expect(getMarketCalendar).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('LG 청약')).toBeTruthy()
    expect(screen.queryByText('일정을 불러오지 못했어요')).toBeNull()
  })

  it('캐시된 데이터가 있을 때 재조회가 실패해도 목록이 그대로', async () => {
    getMarketCalendar.mockResolvedValue([ev('삼성 청약')])
    const { client } = renderWithClient(<CalendarTab />)
    await screen.findByText('삼성 청약')
    await refetchActiveFailing(client, () => getMarketCalendar.mockRejectedValue(new Error('x')))
    expect(getMarketCalendar).toHaveBeenCalledTimes(2)
    expect(screen.getByText('삼성 청약')).toBeTruthy()
    expect(screen.queryByText('일정을 불러오지 못했어요')).toBeNull()
  })
})
