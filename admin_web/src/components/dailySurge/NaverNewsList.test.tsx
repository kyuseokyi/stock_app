// @vitest-environment jsdom
// 네이버 뉴스 목록 — 로딩·성공·없음·실패, 대상이 바뀌면 다시 받는 동안 머리글 검색어는 직전 값. 조회 방식을 바꿔도 그대로 통과해야 한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { deferred, refetchActiveFailing, renderWithClient } from '../../test/query'
import type { NewsResult } from '../../api/dailySurge'

const getNews = vi.fn<(k: 'stock' | 'theme', d: string, t: string) => Promise<NewsResult>>()
vi.mock('../../api/dailySurge', () => ({ getNews: (k: 'stock' | 'theme', d: string, t: string) => getNews(k, d, t) }))

import NaverNewsList from './NaverNewsList'

const news = (query: string, titles: string[]): NewsResult => ({
  source: 'naver', query, unavailable: false,
  items: titles.map((title, i) => ({ title, url: `https://n.example/${i}`, press_domain: 'n.example', published_at: null, time_slot: 'other' })),
})

beforeEach(() => {
  getNews.mockReset()
})

describe('NaverNewsList', () => {
  it('불러오는 동안 안내', async () => {
    getNews.mockReturnValue(deferred<NewsResult>().promise)
    renderWithClient(<NaverNewsList kind="stock" date="2026-11-26" target="005930" />)
    expect(await screen.findByText('뉴스를 불러오는 중…')).toBeTruthy()
  })

  it('성공하면 기사 목록과 검색어', async () => {
    getNews.mockResolvedValue(news('삼성전자', ['기사 하나']))
    renderWithClient(<NaverNewsList kind="stock" date="2026-11-26" target="005930" />)
    expect(await screen.findByText('기사 하나')).toBeTruthy()
    expect(screen.getByText("'삼성전자' · 최신순")).toBeTruthy()
    expect(getNews).toHaveBeenCalledWith('stock', '2026-11-26', '005930')
  })

  it('없음·실패는 같은 안내', async () => {
    getNews.mockResolvedValueOnce({ ...news('x', []), unavailable: true })
    const v = renderWithClient(<NaverNewsList kind="theme" date="2026-11-26" target="1" />)
    expect(await screen.findByText('뉴스가 없거나 불러오지 못했습니다.')).toBeTruthy()
    v.unmount()
    getNews.mockRejectedValueOnce(new Error('x'))
    renderWithClient(<NaverNewsList kind="theme" date="2026-11-26" target="2" />)
    expect(await screen.findByText('뉴스가 없거나 불러오지 못했습니다.')).toBeTruthy()
  })

  it('대상이 바뀌면 다시 받는 동안 머리글 검색어는 직전 값', async () => {
    const next = deferred<NewsResult>()
    getNews.mockResolvedValueOnce(news('삼성전자', ['기사 하나'])).mockReturnValueOnce(next.promise)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = (t: string) => (
      <QueryClientProvider client={client}><NaverNewsList kind="stock" date="2026-11-26" target={t} /></QueryClientProvider>
    )
    const v = render(ui('005930'))
    await screen.findByText('기사 하나')
    v.rerender(ui('000660'))
    expect(await screen.findByText('뉴스를 불러오는 중…')).toBeTruthy()
    expect(screen.getByText("'삼성전자' · 최신순")).toBeTruthy()
    next.resolve(news('SK하이닉스', ['기사 둘']))
    expect(await screen.findByText('기사 둘')).toBeTruthy()
    expect(screen.getByText("'SK하이닉스' · 최신순")).toBeTruthy()
  })

  it('캐시된 데이터가 있을 때 재조회가 실패해도 목록이 그대로', async () => {
    getNews.mockResolvedValue(news('삼성전자', ['기사 하나']))
    const { client } = renderWithClient(<NaverNewsList kind="stock" date="2026-11-26" target="005930" />)
    await screen.findByText('기사 하나')
    await refetchActiveFailing(client, () => getNews.mockRejectedValue(new Error('x')))
    expect(getNews).toHaveBeenCalledTimes(2)
    expect(screen.getByText('기사 하나')).toBeTruthy()
    expect(screen.queryByText('뉴스가 없거나 불러오지 못했습니다.')).toBeNull()
  })
})
