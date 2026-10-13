import { parseGameMessage } from './ws';

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
