// @vitest-environment jsdom
// 테마·업종 탭 — 로딩·성공·준비 중·오류·조건 변경·더 보기·탭 복귀 재조회(기준일이 같으면 그대로).
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, refetchActiveFailing, renderWithClient, returnToTabAfterIdle } from '../../test/query'
import type { GroupItem, GroupRanking } from '../../types/market'

type Args = [string, string, string, number?, number?]
const getMarketGroups = vi.fn<(...a: Args) => Promise<GroupRanking>>()
vi.mock('../../api/market', () => ({ GROUP_PAGE: 30, getMarketGroups: (...a: Args) => getMarketGroups(...a) }))
vi.mock('../../components/market/GroupDetailView', () => ({ default: () => <div>상세</div> }))

import GroupTab from './GroupTab'

const item = (id: string): GroupItem => ({
  id, name: `테마${id}`, members: 5, chg: 1.2, value: 1e9, up: 3, down: 1, flat: 1, leader: null, rank: 1, streak: 0,
})
const ranking = (date: string | null, total: number, ids: string[]): GroupRanking => ({ date, total, items: ids.map(item) })

beforeEach(() => {
  getMarketGroups.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GroupTab', () => {
  it('불러오는 동안 스켈레톤', async () => {
    getMarketGroups.mockReturnValue(deferred<GroupRanking>().promise)
    renderWithClient(<GroupTab kind="theme" />)
    expect(await screen.findByText('목록을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 목록·개수', async () => {
    getMarketGroups.mockResolvedValue(ranking('2026-11-26', 2, ['a', 'b']))
    renderWithClient(<GroupTab kind="theme" />)
    expect(await screen.findByText('테마a')).toBeTruthy()
    expect(screen.getByText('테마b')).toBeTruthy()
    expect(screen.getByText(/2개 테마/)).toBeTruthy()
    expect(getMarketGroups).toHaveBeenCalledWith('theme', '1d', 'chg')
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
  })

  it('기준일이 없으면 준비 중 안내', async () => {
    getMarketGroups.mockResolvedValue(ranking(null, 0, []))
    renderWithClient(<GroupTab kind="theme" />)
    expect(await screen.findByText('시장 데이터를 준비하고 있어요')).toBeTruthy()
  })

  it('비어 있으면 빈 안내', async () => {
    getMarketGroups.mockResolvedValue(ranking('2026-11-26', 0, []))
    renderWithClient(<GroupTab kind="sector" />)
    expect(await screen.findByText('업종 데이터가 없어요')).toBeTruthy()
  })

  it('실패하면 오류 안내', async () => {
    getMarketGroups.mockRejectedValue(new Error('x'))
    renderWithClient(<GroupTab kind="theme" />)
    expect(await screen.findByText('불러오지 못했어요')).toBeTruthy()
  })

  it('기간을 바꾸면 그 기간으로 다시 불러온다', async () => {
    getMarketGroups.mockImplementation(async (_k, period) =>
      period === '5d' ? ranking('2026-11-26', 1, ['five']) : ranking('2026-11-26', 1, ['one']))
    renderWithClient(<GroupTab kind="theme" />)
    await screen.findByText('테마one')
    fireEvent.click(screen.getByRole('button', { name: '5일' }))
    expect(await screen.findByText('테마five')).toBeTruthy()
    expect(screen.queryByText('테마one')).toBeNull()
    expect(getMarketGroups).toHaveBeenLastCalledWith('theme', '5d', 'chg')
  })

  it('더 보기는 이어서 붙이고, 탭 복귀 때 기준일이 같으면 붙인 목록을 그대로 둔다', async () => {
    getMarketGroups.mockImplementation(async (_k, _p, _s, offset) =>
      offset ? ranking('2026-11-26', 3, ['c']) : ranking('2026-11-26', 3, ['a', 'b']))
    renderWithClient(<GroupTab kind="theme" />)
    await screen.findByText('테마a')
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (1개)' }))
    expect(await screen.findByText('테마c')).toBeTruthy()
    expect(getMarketGroups).toHaveBeenLastCalledWith('theme', '1d', 'chg', 2)
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull()
    const calls = getMarketGroups.mock.calls.length
    await returnToTabAfterIdle()
    await waitFor(() => expect(getMarketGroups.mock.calls.length).toBe(calls + 1))
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.getByText('테마a')).toBeTruthy()
    expect(screen.getByText('테마c')).toBeTruthy()
  })

  it('탭 복귀 때 기준일이 바뀌었으면 새 목록으로 바꾼다', async () => {
    getMarketGroups.mockResolvedValueOnce(ranking('2026-11-26', 1, ['old'])).mockResolvedValueOnce(ranking('2026-11-27', 1, ['new']))
    renderWithClient(<GroupTab kind="theme" />)
    await screen.findByText('테마old')
    await returnToTabAfterIdle()
    expect(await screen.findByText('테마new')).toBeTruthy()
    expect(screen.queryByText('테마old')).toBeNull()
  })

  it('실패 뒤 탭 복귀 재조회가 성공하면 목록을 보여 준다', async () => {
    getMarketGroups.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(ranking('2026-11-26', 1, ['back']))
    renderWithClient(<GroupTab kind="theme" />)
    await screen.findByText('불러오지 못했어요')
    await returnToTabAfterIdle()
    expect(await screen.findByText('테마back')).toBeTruthy()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  })

  it('캐시된 데이터가 있을 때 재조회가 실패해도 목록이 그대로', async () => {
    getMarketGroups.mockResolvedValue(ranking('2026-11-26', 1, ['a']))
    const { client } = renderWithClient(<GroupTab kind="theme" />)
    await screen.findByText('테마a')
    await refetchActiveFailing(client, () => getMarketGroups.mockRejectedValue(new Error('x')))
    expect(getMarketGroups).toHaveBeenCalledTimes(2)
    expect(screen.getByText('테마a')).toBeTruthy()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  })
})
