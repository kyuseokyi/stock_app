/** 게시판 도메인 타입(camelCase). 서버 snake_case는 api.ts에서 변환한다. */
export type Board = {
  id: number;
  name: string;
  orderIndex: number;
  isActive: boolean;
  commentsEnabled: boolean;
  minRoleRequired: string;
};
