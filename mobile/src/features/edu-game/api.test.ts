import { ApiError } from '@/lib/api/http';

import { getEduFeatures } from './api';

const mockGet = jest.fn();
jest.mock('@/lib/env', () => ({ ENV: { gameApiUrl: 'http://game.test' } }));
jest.mock('@/lib/api/http', () => {
  const actual = jest.requireActual('@/lib/api/http');
  return { ...actual, createHttpClient: () => ({ get: (...args: unknown[]) => mockGet(...args) }) };
});

beforeEach(() => mockGet.mockReset());

describe('getEduFeatures (탭 노출 판단 — features, 옛 서버는 state 폴백)', () => {
  it('features 응답의 두 값을 그대로 쓰고 state 는 부르지 않는다', async () => {
    mockGet.mockResolvedValueOnce({ enabled: true, real_market_switch: false });
    await expect(getEduFeatures()).resolves.toEqual({ enabled: true, real_market_switch: false });
    expect(mockGet.mock.calls.map((c) => c[0])).toEqual(['/api/game/edu/features']);
  });

  it('404(features 없는 옛 서버)면 state 로 한 번 폴백한다', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(404, 'HTTP 404'));
    mockGet.mockResolvedValueOnce({ enabled: true, real_market_switch: true, season: null, candles: [] });
    await expect(getEduFeatures()).resolves.toEqual({ enabled: true, real_market_switch: true });
    expect(mockGet.mock.calls.map((c) => c[0])).toEqual(['/api/game/edu/features', '/api/game/edu/state']);
  });

  it('404 가 아닌 오류는 폴백하지 않고 그대로 던진다(호출부가 닫힘 처리)', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(500, 'HTTP 500'));
    await expect(getEduFeatures()).rejects.toBeInstanceOf(ApiError);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
