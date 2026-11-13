/** 인증 사용자 도메인 타입(camelCase). 서버 snake_case는 api.ts에서 변환한다. */
export type User = {
  id: number;
  email: string | null;
  nickname: string | null;
  role: string;
  /** 현재 약관 동의가 필요한지(서버 UserOut.terms_required). 옛 저장값·구 서버는 없음 → 동의 불필요로 본다 */
  termsRequired?: boolean;
};
