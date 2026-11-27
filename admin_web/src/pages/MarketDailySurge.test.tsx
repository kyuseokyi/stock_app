// @vitest-environment jsdom
// 관리자 급등락·테마 분석 — 날짜·목록 로딩·성공·빈·오류, 보기 전환, 쪽 넘김, 새로 고침, 상세(메모 저장·지우기 뒤 재조회), 수동 집계.
// 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다(쪽 넘김 중 '불러오는 중…' 여부는 단언하지 않는다 — 설계상 의도한 변화).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { deferred, refetchActiveFailing, renderWithClient } from '../test/query'
import type * as Api from '../api/dailySurge'
import { useMeStore } from '../store/me'
import type { UserOut } from '../types/api'

const api = {
  listDates: vi.fn<typeof Api.listDates>(),
  listStocks: vi.fn<typeof Api.listStocks>(),
  listGroups: vi.fn<typeof Api.listGroups>(),
  getStockDetail: vi.fn<typeof Api.getStockDetail>(),
  getThemeDetail: vi.fn<typeof Api.getThemeDetail>(),
  getNews: vi.fn<typeof Api.getNews>(),
  putNote: vi.fn<typeof Api.putNote>(),
  deleteNote: vi.fn<typeof Api.deleteNote>(),
  rebuild: vi.fn<typeof Api.rebuild>(),
}
vi.mock('../api/dailySurge', () => ({
  listDates: () => api.listDates(),
  listStocks: (p: Api.ListParams) => api.listStocks(p),
  listGroups: (d: string, p?: number, s?: number) => api.listGroups(d, p, s),
  getStockDetail: (d: string, t: string) => api.getStockDetail(d, t),
  getThemeDetail: (d: string, id: number, dir: Api.Direction) => api.getThemeDetail(d, id, dir),
  getNews: (k: 'stock' | 'theme', d: string, t: string) => api.getNews(k, d, t),
  putNote: (d: string, s: 'stock' | 'theme', t: string, n: string) => api.putNote(d, s, t, n),
  deleteNote: (d: string, s: 'stock' | 'theme', t: string) => api.deleteNote(d, s, t),
  rebuild: (d: string) => api.rebuild(d),
}))
const showToast = vi.fn()
vi.mock('../lib/toast', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))
vi.mock('../leaders/components/screener/StockDailyChart', () => ({ default: () => null }))

import MarketDailySurge from './MarketDailySurge'

const D1: Api.SurgeDate = { date: '2026-11-26', surge_count: 3, plunge_count: 1, value_count: 30, group_count: 2 }
const D0: Api.SurgeDate = { date: '2026-11-25', surge_count: 1, plunge_count: 0, value_count: 30, group_count: 1 }
const group = (id: number, name: string): Api.ThemeGroup => ({
  date: D1.date, theme_id: id, theme_name: name, direction: 'up', stock_count: 2, avg_change_rate: 12, value_sum: 1e10,
  leader_ticker: '000001', leader_name: `${name}대장`, members: [], theme_source: 'kiwoom', note: null, theme_size: 5,
})
const groupsPage = (names: string[], page = 1, pages = 1): Api.GroupPage => ({
  date: D1.date, theme_source: 'kiwoom', items: names.map((n, i) => group(i + 1, n)), total: names.length, page, page_size: 20, pages,
})
const stock = (ticker: string, name: string): Api.SurgeStock => ({
  date: D1.date, ticker, name, market: 'KOSPI', close: 1000, prev_close: 900, change_price: 100, change_rate: 11, volume: 1,
  volume_ratio: null, trading_value: 1e9, is_surge: true, is_plunge: false, is_top_value: false, surge_rank: 1, plunge_rank: null,
  value_rank: null, primary_theme_id: null, primary_theme_name: null, is_theme_leader: false, dart_items: [], dart_keywords: [],
  themes: [], sector_name: null,
})
const stocksPage = (rows: Api.SurgeStock[]): Api.ListResult => ({
  date: D1.date, theme_source: 'kiwoom', items: rows, total: rows.length, page: 1, page_size: 30, pages: 1,
})
const themeDetail = (note: string | null): Api.ThemeDetail => ({ group: group(1, '반도체'), note, board: [] })

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  showToast.mockReset()
  api.getNews.mockResolvedValue({ source: 'naver', query: '반도체', unavailable: true, items: [] })
  useMeStore.setState({ user: { is_super_admin: true } as UserOut })
})

describe('MarketDailySurge', () => {
  it('날짜를 받고 첫 날짜의 테마 묶음을 보여 준다', async () => {
    api.listDates.mockResolvedValue([D1, D0])
    api.listGroups.mockResolvedValue(groupsPage(['반도체', '2차전지']))
    renderWithClient(<MarketDailySurge />)
    expect(await screen.findByText('반도체')).toBeTruthy()
    expect(screen.getByText('2차전지')).toBeTruthy()
    expect(api.listGroups).toHaveBeenLastCalledWith('2026-11-26', 1, 20)
    expect((screen.getByLabelText('거래일') as HTMLSelectElement).value).toBe('2026-11-26')
    expect(screen.getByText(/테마 출처:/).textContent).not.toContain('-')
  })

  it('목록을 불러오는 동안 안내', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockReturnValue(deferred<Api.GroupPage>().promise)
    renderWithClient(<MarketDailySurge />)
    expect(await screen.findByText('불러오는 중…')).toBeTruthy()
  })

  it('집계된 날짜가 없으면 안내', async () => {
    api.listDates.mockResolvedValue([])
    renderWithClient(<MarketDailySurge />)
    expect(await screen.findByText(/아직 집계된 날짜가 없습니다/)).toBeTruthy()
    expect(api.listGroups).not.toHaveBeenCalled()
  })

  it('날짜를 못 받으면 오류 안내', async () => {
    api.listDates.mockRejectedValue(new Error('x'))
    renderWithClient(<MarketDailySurge />)
    expect(await screen.findByText('자료를 불러오지 못했습니다.')).toBeTruthy()
  })

  it('목록을 못 받으면 오류 안내', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockRejectedValue(new Error('x'))
    renderWithClient(<MarketDailySurge />)
    expect(await screen.findByText('자료를 불러오지 못했습니다.')).toBeTruthy()
  })

  it('보기를 급등주로 바꾸면 종목 표', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValue(groupsPage(['반도체']))
    api.listStocks.mockResolvedValue(stocksPage([stock('005930', '삼성전자')]))
    renderWithClient(<MarketDailySurge />)
    await screen.findByText('반도체')
    fireEvent.click(screen.getByRole('tab', { name: /급등주/ }))
    expect(await screen.findByText(/삼성전자/)).toBeTruthy()
    expect(api.listStocks).toHaveBeenLastCalledWith({
      date: '2026-11-26', mode: 'surge', band: 'all', dart_only: false, sort: undefined, page: 1, page_size: 30,
    })
  })

  it('다음 쪽을 누르면 2쪽을 불러온다', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockImplementation(async (_d, p) => (p === 2 ? groupsPage(['2쪽 테마'], 2, 2) : groupsPage(['1쪽 테마'], 1, 2)))
    renderWithClient(<MarketDailySurge />)
    await screen.findByText('1쪽 테마')
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    fireEvent.click(screen.getByRole('button', { name: '다음 쪽' }))
    expect(await screen.findByText('2쪽 테마')).toBeTruthy()
    expect(api.listGroups).toHaveBeenLastCalledWith('2026-11-26', 2, 20)
    expect(screen.getByText('2 / 2')).toBeTruthy()
  })

  it('새로 고침은 날짜와 목록을 다시 받는다', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValueOnce(groupsPage(['반도체'])).mockResolvedValueOnce(groupsPage(['조선']))
    renderWithClient(<MarketDailySurge />)
    await screen.findByText('반도체')
    fireEvent.click(screen.getByRole('button', { name: '새로 고침' }))
    expect(await screen.findByText('조선')).toBeTruthy()
    expect(api.listDates).toHaveBeenCalledTimes(2)
  })

  it('상세에서 메모를 저장하면 상세와 목록을 다시 받는다', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValue(groupsPage(['반도체']))
    api.getThemeDetail.mockResolvedValueOnce(themeDetail(null)).mockResolvedValue(themeDetail('수출 호조'))
    api.putNote.mockResolvedValue(undefined)
    renderWithClient(<MarketDailySurge />)
    fireEvent.click(await screen.findByRole('button', { name: /반도체/ }))
    const sheet = await screen.findByRole('dialog', { name: '상세' })
    fireEvent.click(await within(sheet).findByRole('button', { name: '작성' }))
    fireEvent.change(within(sheet).getByRole('textbox', { name: '이유 메모' }), { target: { value: '수출 호조' } })
    const groupsBefore = api.listGroups.mock.calls.length
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(api.putNote).toHaveBeenCalledWith('2026-11-26', 'theme', '1', '수출 호조'))
    expect(await within(sheet).findByText('수출 호조')).toBeTruthy()
    await waitFor(() => expect(api.listGroups.mock.calls.length).toBe(groupsBefore + 1))
    expect(api.getThemeDetail).toHaveBeenCalledTimes(2)
  })

  it('메모 지우기 뒤에도 다시 받고, 저장 실패면 안내 토스트', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValue(groupsPage(['반도체']))
    api.getThemeDetail.mockResolvedValueOnce(themeDetail('옛 메모')).mockResolvedValue(themeDetail(null))
    api.deleteNote.mockResolvedValue(undefined)
    api.putNote.mockRejectedValue(new Error('x'))
    renderWithClient(<MarketDailySurge />)
    fireEvent.click(await screen.findByRole('button', { name: /반도체/ }))
    const sheet = await screen.findByRole('dialog', { name: '상세' })
    fireEvent.click(await within(sheet).findByRole('button', { name: '수정' }))
    const groupsBefore = api.listGroups.mock.calls.length
    fireEvent.click(within(sheet).getByRole('button', { name: '지우기' }))
    await waitFor(() => expect(api.deleteNote).toHaveBeenCalledWith('2026-11-26', 'theme', '1'))
    await waitFor(() => expect(api.listGroups.mock.calls.length).toBe(groupsBefore + 1))
    fireEvent.click(await within(sheet).findByRole('button', { name: '작성' }))
    fireEvent.change(within(sheet).getByRole('textbox', { name: '이유 메모' }), { target: { value: '새 메모' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), { icon: '⚠️' }))
    expect(within(sheet).getByRole('textbox', { name: '이유 메모' })).toBeTruthy()
  })

  it('수동 집계 — 성공·이미 집계 중 안내', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValue(groupsPage(['반도체']))
    api.rebuild.mockResolvedValueOnce({ task_id: 't', date: D1.date })
    api.rebuild.mockRejectedValueOnce(Object.assign(new Error('409'), {
      isAxiosError: true, response: { status: 409, data: { detail: { code: 'ALREADY_RUNNING' } } },
    }))
    renderWithClient(<MarketDailySurge />)
    await screen.findByText('반도체')
    const groupsBefore = api.listGroups.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '집계 실행' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      "2026-11-26 집계를 시작했습니다. 1~2분 뒤 '새로 고침'을 누르세요.", { icon: '🔄' }))
    expect(api.rebuild).toHaveBeenCalledWith('2026-11-26')
    await waitFor(() => expect((screen.getByRole('button', { name: '집계 실행' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '집계 실행' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(2))
    expect(api.listGroups.mock.calls.length).toBe(groupsBefore)
  })

  it('캐시된 데이터가 있을 때 재조회가 실패해도 목록이 그대로', async () => {
    api.listDates.mockResolvedValue([D1])
    api.listGroups.mockResolvedValue(groupsPage(['반도체']))
    api.getThemeDetail.mockResolvedValue(themeDetail('수출 호조'))
    const { client } = renderWithClient(<MarketDailySurge />)
    fireEvent.click(await screen.findByRole('button', { name: /반도체/ }))
    const sheet = await screen.findByRole('dialog', { name: '상세' })
    await within(sheet).findByText('수출 호조')
    await refetchActiveFailing(client, () => {
      api.listDates.mockRejectedValue(new Error('x'))
      api.listGroups.mockRejectedValue(new Error('x'))
      api.getThemeDetail.mockRejectedValue(new Error('x'))
      api.getNews.mockRejectedValue(new Error('x'))
    })
    expect(api.listGroups).toHaveBeenCalledTimes(2)
    expect(api.getThemeDetail).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('반도체').length).toBeGreaterThan(0)
    expect(within(sheet).getByText('수출 호조')).toBeTruthy()
    expect(screen.queryByText('자료를 불러오지 못했습니다.')).toBeNull()
    expect(within(sheet).queryByText('상세를 불러오지 못했습니다.')).toBeNull()
  })
})
