import { createSignalController, parseFundSignal } from './fund-signal-core';

describe('parseFundSignal', () => {
  it('fund_report_updated 만 날짜를 돌려준다', () => {
    expect(parseFundSignal('{"type":"fund_report_updated","date":"2026-10-21"}')).toBe('2026-10-21');
    expect(parseFundSignal('{"type":"new_post","post_id":1}')).toBeNull();
    expect(parseFundSignal('깨진 json')).toBeNull();
  });
});

describe('createSignalController', () => {
  const mk = (fundCount = 1) => {
    const close = jest.fn();
    const deps = {
      open: jest.fn(() => close),
      countFunds: jest.fn(async () => fundCount),
    };
    return { c: createSignalController(deps), deps, close };
  };

  it('로그인 + 앞 화면 + 펀드 있음이면 연결한다', async () => {
    const { c, deps } = mk();
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(1);
  });

  it('펀드가 없거나 로그아웃·백그라운드면 연결하지 않는다', async () => {
    const a = mk(0);
    await a.c.update({ loggedIn: true, active: true });
    expect(a.deps.open).not.toHaveBeenCalled();
    const b = mk();
    await b.c.update({ loggedIn: false, active: true });
    await b.c.update({ loggedIn: true, active: false });
    expect(b.deps.open).not.toHaveBeenCalled();
  });

  it('백그라운드로 가면 닫고, 돌아오면 다시 연다(중복 연결 없음)', async () => {
    const { c, deps, close } = mk();
    await c.update({ loggedIn: true, active: true });
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(1);
    await c.update({ loggedIn: true, active: false });
    expect(close).toHaveBeenCalledTimes(1);
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(2);
  });

  it('dispose 는 연결을 닫는다', async () => {
    const { c, close } = mk();
    await c.update({ loggedIn: true, active: true });
    c.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
