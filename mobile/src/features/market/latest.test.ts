import { createLatest } from './latest';

describe('요청 번호', () => {
  it('마지막으로 시작한 요청만 최신', () => {
    const gate = createLatest();
    const a = gate.next();
    const b = gate.next();
    expect(gate.isLatest(a)).toBe(false);
    expect(gate.isLatest(b)).toBe(true);
  });
  it('current 는 지금 최신 번호(더 불러오기처럼 번호를 올리지 않는 요청용)', () => {
    const gate = createLatest();
    const a = gate.next();
    expect(gate.current()).toBe(a);
    gate.next();
    expect(gate.isLatest(a)).toBe(false);
  });
});
