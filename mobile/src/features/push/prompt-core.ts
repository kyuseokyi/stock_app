/** 펀드 첫 등록(0→1) 직후, 푸시가 설정돼 있고 아직 물어본 적 없을 때만 안내 시트를 띄운다 */
export function shouldOfferPrompt(s: {
  prevCount: number;
  nextCount: number;
  configured: boolean;
  prompted: boolean;
}): boolean {
  return s.configured && !s.prompted && s.prevCount === 0 && s.nextCount > 0;
}
