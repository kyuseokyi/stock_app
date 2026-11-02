import { boardChips, resolveBoardFilter } from './filter';
import type { Board } from './types';

const board = (id: number, orderIndex: number, name = `게시판${id}`): Board => ({
  id,
  name,
  orderIndex,
  isActive: true,
  commentsEnabled: true,
  minRoleRequired: 'FREE',
});

describe('boardChips', () => {
  it('전체가 맨 앞, 게시판은 정렬 순서대로', () => {
    expect(boardChips([board(2, 5, '자유'), board(1, 1, '공지')])).toEqual([
      { value: null, label: '전체' },
      { value: 1, label: '공지' },
      { value: 2, label: '자유' },
    ]);
  });

  it('게시판이 없거나 못 불러와도 전체는 남는다', () => {
    expect(boardChips([])).toEqual([{ value: null, label: '전체' }]);
  });
});

describe('resolveBoardFilter', () => {
  it('있는 게시판은 그대로', () => {
    expect(resolveBoardFilter(1, [board(1, 0)], true)).toBe(1);
  });

  it('숨겨진 게시판은 전체로', () => {
    expect(resolveBoardFilter(9, [board(1, 0)], true)).toBeNull();
  });

  it('목록을 받기 전에는 선택을 유지', () => {
    expect(resolveBoardFilter(9, [], false)).toBe(9);
  });

  it('전체는 그대로', () => {
    expect(resolveBoardFilter(null, [board(1, 0)], true)).toBeNull();
  });
});
