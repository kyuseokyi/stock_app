import { shouldOfferPrompt } from './prompt-core';

describe('shouldOfferPrompt', () => {
  it('설정됨 + 아직 안 물어봄 + 첫 펀드(0→1)일 때만', () => {
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: false })).toBe(true);
    expect(shouldOfferPrompt({ prevCount: 1, nextCount: 2, configured: true, prompted: false })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: true })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: false, prompted: false })).toBe(false);
  });
});
