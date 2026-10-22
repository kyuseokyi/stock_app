// http 클라이언트(인증 체인 포함)는 끌어오지 않고 blogApi.get 만 mock
jest.mock('@/lib/api', () => ({ blogApi: { get: jest.fn() } }));

import { blogApi } from '@/lib/api';

import { fetchVersionCheck } from './api';

const mockGet = blogApi.get as jest.Mock;

beforeEach(() => mockGet.mockReset());

describe('fetchVersionCheck', () => {
  it('공개 엔드포인트를 platform·current_version 으로 호출', async () => {
    mockGet.mockResolvedValue({ store: { update_type: 'RECOMMENDED' } });
    const r = await fetchVersionCheck('android', '1.0.0');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/app/version-check', { platform: 'android', current_version: '1.0.0' });
    expect(r?.store.updateType).toBe('RECOMMENDED');
  });

  it('네트워크·5xx(던짐) → null', async () => {
    mockGet.mockRejectedValue(new Error('HTTP 503'));
    await expect(fetchVersionCheck('ios', '1.0.0')).resolves.toBeNull();
  });

  it('형식 불량 본문 → null', async () => {
    mockGet.mockResolvedValue('<html>Not Found</html>');
    await expect(fetchVersionCheck('ios', '1.0.0')).resolves.toBeNull();
  });
});
