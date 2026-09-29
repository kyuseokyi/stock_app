import { blogApi } from '@/lib/api';

import type { Board } from './types';

// 서버(FastAPI) 원응답 형태(snake_case) — backend/apps/blog/schemas.py BoardOut
type RawBoard = {
  id: number;
  name: string;
  order_index: number;
  is_active: boolean;
  comments_enabled: boolean;
  min_role_required: string;
};

function toBoard(r: RawBoard): Board {
  return {
    id: r.id,
    name: r.name,
    orderIndex: r.order_index,
    isActive: r.is_active,
    commentsEnabled: r.comments_enabled,
    minRoleRequired: r.min_role_required,
  };
}

/** 활성 게시판 목록 조회. GET /api/v1/boards?only_active=true (blog 서비스, 포트 8000) */
export async function fetchBoards(): Promise<Board[]> {
  const raw = await blogApi.get<RawBoard[]>('/api/v1/boards', { only_active: true });
  return raw.map(toBoard);
}
