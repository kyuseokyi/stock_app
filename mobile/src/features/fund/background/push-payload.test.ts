import { pushTypeOf } from './push-payload';

describe('pushTypeOf — 태스크 payload 모양이 문서에 없어 여러 모양을 받는다', () => {
  it('data 가 바로 type 을 가진 객체', () => {
    expect(
      pushTypeOf({ data: { type: 'fund_refresh', date: '2026-10-21' } }),
    ).toBe('fund_refresh');
  });
  it('data.data.body 가 JSON 문자열', () => {
    expect(pushTypeOf({ data: { body: '{"type":"fund_refresh"}' } })).toBe(
      'fund_refresh',
    );
  });
  it('data.body 가 JSON 문자열', () => {
    expect(pushTypeOf({ body: '{"type":"fund_refresh"}' })).toBe(
      'fund_refresh',
    );
  });
  it('data.dataString (Android)', () => {
    expect(
      pushTypeOf({ data: { dataString: '{"type":"fund_refresh"}' } }),
    ).toBe('fund_refresh');
  });
  it('data.data 가 객체', () => {
    expect(pushTypeOf({ data: { data: { type: 'fund_refresh' } } })).toBe(
      'fund_refresh',
    );
  });
  it('data.data 가 JSON 문자열', () => {
    expect(pushTypeOf({ data: { data: '{"type":"fund_refresh"}' } })).toBe(
      'fund_refresh',
    );
  });
  it('data.notification.data', () => {
    expect(
      pushTypeOf({
        data: { notification: { data: { type: 'fund_refresh' } } },
      }),
    ).toBe('fund_refresh');
  });
  it('notification.request.content.data', () => {
    expect(
      pushTypeOf({
        notification: {
          request: { content: { data: { type: 'fund_refresh' } } },
        },
      }),
    ).toBe('fund_refresh');
  });
  it('최상위에 type', () => {
    expect(pushTypeOf({ type: 'fund_report' })).toBe('fund_report');
  });
  it('모르는 모양·깨진 JSON·비객체는 null', () => {
    expect(pushTypeOf(null)).toBeNull();
    expect(pushTypeOf('x')).toBeNull();
    expect(pushTypeOf({ body: '{깨짐' })).toBeNull();
    expect(pushTypeOf({ data: { other: 1 } })).toBeNull();
    expect(pushTypeOf(undefined)).toBeNull();
    expect(pushTypeOf({ data: null, notification: 3, body: 5 })).toBeNull();
    expect(pushTypeOf({ data: { data: '[1]', notification: 'x' } })).toBeNull();
  });
});
