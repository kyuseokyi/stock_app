import { createSignalController, createSignalScheduler, parseFundSignal } from './fund-signal-core';

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

describe('createSignalController 경합', () => {
  const mkDeferred = () => {
    let resolve!: (n: number) => void;
    const p = new Promise<number>((r) => (resolve = r));
    const close = jest.fn();
    const open = jest.fn(() => close);
    const c = createSignalController({ open, countFunds: () => p });
    return { c, open, resolve };
  };

  it('update 대기 중 dispose 하면 open 하지 않는다', async () => {
    const { c, open, resolve } = mkDeferred();
    const u = c.update({ loggedIn: true, active: true });
    c.dispose();
    resolve(1);
    await u;
    expect(open).not.toHaveBeenCalled();
  });

  it('active update 대기 중 inactive update 가 오면 open 하지 않는다', async () => {
    const { c, open, resolve } = mkDeferred();
    const u = c.update({ loggedIn: true, active: true });
    await c.update({ loggedIn: true, active: false });
    resolve(1);
    await u;
    expect(open).not.toHaveBeenCalled();
  });

  it('active update 를 연달아 두 번 해도 open 은 1번', async () => {
    const { c, open, resolve } = mkDeferred();
    const a = c.update({ loggedIn: true, active: true });
    const b = c.update({ loggedIn: true, active: true });
    resolve(1);
    await Promise.all([a, b]);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('createSignalScheduler', () => {
  const mk = () => {
    const pending: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    const run = jest.fn();
    const s = createSignalScheduler({
      run,
      random: () => 0.5,
      schedule: (fn, ms) => {
        const t = { fn, ms, cancelled: false };
        pending.push(t);
        return () => {
          t.cancelled = true;
        };
      },
    });
    return { s, run, pending };
  };

  it('0~30초 지연 후 실행하고, 대기 중 신호는 무시한다', () => {
    const { s, run, pending } = mk();
    s.signal();
    s.signal();
    expect(pending).toHaveLength(1);
    expect(pending[0].ms).toBe(15_000);
    pending[0].fn();
    expect(run).toHaveBeenCalledTimes(1);
    s.signal();
    expect(pending).toHaveLength(2);
  });

  it('대기 중 닫히면 놓친 신호를 다음 연결 때 즉시 실행한다(한 번만)', () => {
    const { s, run, pending } = mk();
    s.signal();
    s.stop();
    expect(pending[0].cancelled).toBe(true);
    expect(run).not.toHaveBeenCalled();
    s.start();
    expect(run).toHaveBeenCalledTimes(1);
    s.start();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('대기 중이 아니었으면 닫아도 놓친 신호가 없다', () => {
    const { s, run } = mk();
    s.stop();
    s.start();
    expect(run).not.toHaveBeenCalled();
  });
});
