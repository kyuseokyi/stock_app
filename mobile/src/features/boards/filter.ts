import type { Board } from './types';

/** 커뮤니티 칩 선택값 — null 이면 '전체'(활성 게시판의 글 모두) */
export type BoardFilter = number | null;

export type BoardChip = { value: BoardFilter; label: string };

/** '전체' 다음에 게시판을 관리자가 정한 순서로 */
export function boardChips(boards: Board[]): BoardChip[] {
  const ordered = [...boards].sort((a, b) => a.orderIndex - b.orderIndex);
  return [{ value: null, label: '전체' }, ...ordered.map((b) => ({ value: b.id, label: b.name }))];
}

/** 새로고침 뒤 선택했던 게시판이 숨겨졌으면 '전체'로 돌아간다. 게시판 목록을 받기 전에는 그대로 둔다 */
export function resolveBoardFilter(selected: BoardFilter, boards: Board[], loaded: boolean): BoardFilter {
  if (selected === null || !loaded) return selected;
  return boards.some((b) => b.id === selected) ? selected : null;
}
