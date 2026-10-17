import { buildGameWsUrl, classifyWsClose, parseGameMessage, toMarketStatus } from './ws';

describe('parseGameMessage', () => {
  test('tick — Decimal 문자열 가격을 number 로', () => {
    expect(parseGameMessage('{"type":"tick","ticker":"005930","price":"71200"}')).toEqual({
      type: 'tick',
      ticker: '005930',
      price: 71200,
    });
  });
  test('position_pnl', () => {
    expect(
      parseGameMessage('{"type":"position_pnl","position_id":"p1","roi_pct":"1.5","pnl_amount":"15000.00"}'),
    ).toEqual({ type: 'position_pnl', position_id: 'p1', roi_pct: 1.5, pnl_amount: 15000 });
  });
  test('sentiment', () => {
    expect(parseGameMessage('{"type":"sentiment","long_pct":60,"short_pct":40}')).toEqual({
      type: 'sentiment',
      long_pct: 60,
      short_pct: 40,
    });
  });
  test('sentiment — total(보유 인원) 포함, 잘못된 total 은 생략', () => {
    expect(parseGameMessage('{"type":"sentiment","long_pct":70,"short_pct":30,"total":12}')).toEqual({
      type: 'sentiment',
      long_pct: 70,
      short_pct: 30,
      total: 12,
    });
    expect(parseGameMessage('{"type":"sentiment","long_pct":70,"short_pct":30,"total":"x"}')).toEqual({
      type: 'sentiment',
      long_pct: 70,
      short_pct: 30,
    });
  });
  test('nudge — 필드 누락이면 null', () => {
    expect(
      parseGameMessage('{"type":"nudge","position_id":"p1","nudge":{"type":"WARNING","code":"C","message":"m"}}'),
    ).toEqual({ type: 'nudge', position_id: 'p1', nudge: { type: 'WARNING', code: 'C', message: 'm' } });
    expect(parseGameMessage('{"type":"nudge","position_id":"p1","nudge":{"type":"WARNING"}}')).toBeNull();
  });
  test('coach — 본문 없음(content_md null), 가격 Decimal 변환', () => {
    expect(
      parseGameMessage(
        '{"type":"coach","season_id":1,"coach_type":"MORNING","title":"t","summary_nudge":"s","support_price":"70000","resistance_price":null}',
      ),
    ).toEqual({
      type: 'coach',
      coach: {
        season_id: 1,
        coach_type: 'MORNING',
        title: 't',
        summary_nudge: 's',
        content_md: null,
        support_price: 70000,
        resistance_price: null,
      },
    });
  });
  test('깨진 JSON·배열·모르는 type·필수값 누락 → null', () => {
    expect(parseGameMessage('pong')).toBeNull();
    expect(parseGameMessage('[]')).toBeNull();
    expect(parseGameMessage('{"type":"x"}')).toBeNull();
    expect(parseGameMessage('{"type":"tick","ticker":"","price":1}')).toBeNull();
    expect(parseGameMessage('{"type":"tick","ticker":"005930","price":"abc"}')).toBeNull();
  });
});

describe('buildGameWsUrl', () => {
  test('로그인 — token 쿼리 포함(인코딩)', () => {
    expect(buildGameWsUrl('https://game.example.com/', 'a b+c')).toBe(
      'wss://game.example.com/ws/game/stream?token=a%20b%2Bc',
    );
  });
  test('비로그인 — token 파라미터 자체를 생략(빈 ?token= 금지)', () => {
    expect(buildGameWsUrl('http://localhost:8003', null)).toBe('ws://localhost:8003/ws/game/stream');
    expect(buildGameWsUrl('http://localhost:8003', '')).toBe('ws://localhost:8003/ws/game/stream');
  });
});

describe('classifyWsClose', () => {
  test('4401 — 로그인 연결이면 만료 처리, 공개 연결이면 일반 재시도', () => {
    expect(classifyWsClose(4401, true)).toBe('auth-failed');
    expect(classifyWsClose(4401, false)).toBe('retry');
  });
  test('4429 — 상한 초과 백오프', () => {
    expect(classifyWsClose(4429, false)).toBe('capacity');
    expect(classifyWsClose(4429, true)).toBe('capacity');
  });
  test('그 외 — 일반 재시도', () => {
    expect(classifyWsClose(1006, true)).toBe('retry');
    expect(classifyWsClose(1000, false)).toBe('retry');
  });
});

describe('market_status', () => {
  const base = { type: 'market_status', ticker: '005930', state: 'VI', message: '변동성 완화장치(VI)가 발동됐어요.', blocking: true, since: '2026-10-16T10:00:00+09:00' };

  it('정상 형식은 그대로', () => {
    expect(parseGameMessage(JSON.stringify(base))).toEqual(base);
  });

  it('모르는 state·형식 오류는 무시(null)', () => {
    expect(parseGameMessage(JSON.stringify({ ...base, state: 'NEW_THING' }))).toBeNull();
    expect(parseGameMessage(JSON.stringify({ ...base, state: 1 }))).toBeNull();
  });

  it('blocking 은 true 일 때만, 빈 since·ticker 는 null', () => {
    expect(parseGameMessage(JSON.stringify({ ...base, blocking: 'yes', since: '', ticker: '' }))).toEqual({
      ...base, blocking: false, since: null, ticker: null,
    });
  });

  it('REST 응답도 같은 정규화', () => {
    const { type: _t, ...rest } = base;
    expect(toMarketStatus({ ...rest, state: 'SIDECAR', blocking: false })).toMatchObject({ state: 'SIDECAR', blocking: false });
    expect(toMarketStatus(null)).toBeNull();
  });
});
