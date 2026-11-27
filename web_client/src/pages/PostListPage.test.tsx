// @vitest-environment jsdom
// 게시판 글 목록 — 로딩·성공·빈·오류·쪽 넘김. 데이터 조회 방식을 바꿔도 이 테스트는 그대로 통과해야 한다.
// 쪽 넘김 중 스켈레톤 여부는 단언하지 않는다(설계상 Query 전환 뒤 이전 쪽을 보여 주며 넘긴다 — 의도한 변화).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { deferred, renderWithClient } from '../test/query'
import type { BlogListOut } from '../types/api'

const listBlogs = vi.fn<(p: { boardId?: number; page?: number; size?: number }) => Promise<BlogListOut>>()
vi.mock('../api/blog', () => ({ listBlogs: (p: { boardId?: number; page?: number; size?: number }) => listBlogs(p) }))
vi.mock('../hooks/useAdConfig', () => ({ useAdConfig: () => null }))

import PostListPage from './PostListPage'

function page(n: number, total: number, titles: string[]): BlogListOut {
  return {
    total,
    page: n,
    size: 10,
    items: titles.map((title, i) => ({
      id: n * 100 + i, title, content: '<p>본문</p>', created_at: '2026-11-01T00:00:00Z', view_count: 1,
    })),
  } as unknown as BlogListOut
}

const ui = (
  <Routes>
    <Route path="/boards/:boardId" element={<PostListPage />} />
  </Routes>
)

beforeEach(() => {
  listBlogs.mockReset()
})
afterEach(() => cleanup())

describe('PostListPage', () => {
  it('불러오는 동안 스켈레톤', async () => {
    listBlogs.mockReturnValue(deferred<BlogListOut>().promise)
    renderWithClient(ui, { route: '/boards/3' })
    expect(await screen.findByText('게시글을 불러오고 있어요')).toBeTruthy()
  })

  it('성공하면 글 목록', async () => {
    listBlogs.mockResolvedValue(page(1, 1, ['첫 글']))
    renderWithClient(ui, { route: '/boards/3' })
    expect(await screen.findByText('첫 글')).toBeTruthy()
    expect(listBlogs).toHaveBeenLastCalledWith({ boardId: 3, page: 1, size: 10 })
    expect(screen.queryByText('게시글을 불러오고 있어요')).toBeNull()
  })

  it('비어 있으면 빈 안내', async () => {
    listBlogs.mockResolvedValue(page(1, 0, []))
    renderWithClient(ui, { route: '/boards/3' })
    expect(await screen.findByText('아직 게시글이 없어요.')).toBeTruthy()
  })

  it('실패하면 오류 안내', async () => {
    listBlogs.mockRejectedValue(new Error('x'))
    renderWithClient(ui, { route: '/boards/3' })
    expect(await screen.findByText(/게시글을 불러오지 못했어요\./)).toBeTruthy()
  })

  it('다음 쪽으로 넘기면 2쪽을 불러온다', async () => {
    listBlogs.mockImplementation(async (arg) => (arg?.page === 2 ? page(2, 25, ['2쪽 글']) : page(1, 25, ['1쪽 글'])))
    renderWithClient(ui, { route: '/boards/3' })
    await screen.findByText('1쪽 글')
    expect(screen.getByText('1 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('2쪽 글')).toBeTruthy()
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(listBlogs).toHaveBeenLastCalledWith({ boardId: 3, page: 2, size: 10 })
  })

  it('2쪽이 실패하면 오류 안내와 함께 보이던 목록·쪽 이동은 남고, 다시 성공해도 안내는 남는다(지금 동작)', async () => {
    listBlogs.mockImplementation(async (arg) => {
      if (arg?.page === 2) throw new Error('x')
      return page(1, 25, ['1쪽 글'])
    })
    renderWithClient(ui, { route: '/boards/3' })
    await screen.findByText('1쪽 글')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText(/게시글을 불러오지 못했어요\./)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('1쪽 글')).toBeTruthy())
    expect(screen.getByText('2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeTruthy())
    expect(screen.getByText('1쪽 글')).toBeTruthy()
    expect(screen.getByText(/게시글을 불러오지 못했어요\./)).toBeTruthy()
  })
})
