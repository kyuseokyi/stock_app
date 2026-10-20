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
  it('current 로 받은 번호는 next 전까지 최신', () => {
    const gate = createLatest();
    gate.next();
    const c = gate.current();
    expect(gate.isLatest(c)).toBe(true);
    gate.next();
    expect(gate.isLatest(c)).toBe(false);
  });
});
