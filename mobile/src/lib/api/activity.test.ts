import { beginRequest, isApiBusy, subscribeApiBusy, trackRequest } from './activity';

describe('API 진행 중 카운터', () => {
  it('겹친 요청은 마지막이 끝날 때 한 번만 busy=false', async () => {
    const seen: boolean[] = [];
    const unsub = subscribeApiBusy((b) => seen.push(b));
    let resolveA!: () => void;
    const a = trackRequest(() => new Promise<void>((r) => (resolveA = r)));
    const b = trackRequest(async () => 'ok');
    await b;
    expect(isApiBusy()).toBe(true); // a 가 아직 진행 중
    resolveA();
    await a;
    expect(isApiBusy()).toBe(false);
    expect(seen).toEqual([true, false]);
    unsub();
  });

  it('실패해도 진행 중이 해제된다', async () => {
    await expect(trackRequest(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(isApiBusy()).toBe(false);
  });

  it('끝내기 함수를 여러 번 불러도 한 번만 반영', () => {
    const end = beginRequest();
    const other = beginRequest();
    end();
    end();
    expect(isApiBusy()).toBe(true); // other 남아 있음
    other();
    expect(isApiBusy()).toBe(false);
  });
});
