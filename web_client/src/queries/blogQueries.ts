import { queryOptions } from '@tanstack/react-query'
import { listBlogs } from '../api/blog'

// 게시판 조회 정의 — 기존 api 함수를 그대로 감싼다(API 계약 변경 없음). 키: ['blog', 종류, ...파라미터]
export const blogQueries = {
  /** 게시판 글 목록 한 쪽 — 같은 게시판에서 쪽만 바뀔 때는 새 쪽이 올 때까지 이전 쪽을 보여 준다(깜빡임 없음).
   *  게시판이 바뀌면 이전 게시판 글을 비추지 않는다 */
  posts: (boardId: number, page: number, size: number) =>
    queryOptions({
      queryKey: ['blog', 'posts', boardId, page, size] as const,
      queryFn: () => listBlogs({ boardId, page, size }),
      placeholderData: (prev, prevQuery) =>
        prevQuery?.queryKey[2] === boardId && prevQuery.queryKey[4] === size ? prev : undefined,
    }),
}
