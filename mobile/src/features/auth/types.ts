/** 인증 사용자 도메인 타입(camelCase). 서버 snake_case는 api.ts에서 변환한다. */
export type User = {
  id: number;
  email: string | null;
  nickname: string | null;
  role: string;
};
